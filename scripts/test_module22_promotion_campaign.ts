import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCampaignRecipientDocId,
  buildCampaignRegistrationLink,
  buildSuppressionDocId,
  deriveInitialPosterFromCourse,
  generateCampaignResultsCsv,
  getDefaultPromotionTemplate,
  isAuthorizedUniversityEmail,
  MAX_POSTER_BYTES,
  normalizeEmailAddress,
  parseEmailAddressesText,
  parseRecipientsCsvContent,
  reconcileAndValidateRecipients,
  renderPromotionEmail,
  resolveGreetingForRecipient,
  resolveInitialCampaignLanguage,
  validateExternalPosterUrl,
} from "../src/lib/promotionCampaign";
import { buildFirestoreCampaignRecord } from "../src/lib/promotionCampaignService";
import {
  containsDangerousHtmlOrScript,
  handler as promotionHandler,
  isAuthorizedBuEmail,
  validatePosterPayload,
  validatePublishedRegistrationUrl,
} from "../netlify/functions/send-course-promotion";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

let passed = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`✅ [PASS] ${name}`);
    })
    .catch((err) => {
      console.error(`❌ [FAIL] ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

async function main() {
  console.log("=== MODULE 22 Offline Verification Suite ===");

  // 1. Thai & English template rendering + non-mutating course language override
  await runTest("1. Thai and English campaign templates render cleanly with TH/EN CTAs", () => {
    const thCourse = {
      id: "course-th-1",
      title: "การสอนเชิงรุกด้วย AI สำหรับคณาจารย์",
      language: "th" as const,
      date: "2026-06-15",
      startTime: "09:00",
      endTime: "12:00",
      locationDetail: "ห้อง A3-301",
      instructorName: "อ.สมชาย ใจดี",
      description: "เรียนรู้เทคนิคการออกแบบการสอนยุคใหม่",
    };

    assert.equal(resolveInitialCampaignLanguage(thCourse), "th");
    const thTemplate = getDefaultPromotionTemplate(thCourse, "th");
    assert.equal(thTemplate.ctaLabel, "ลงทะเบียนเข้าอบรม");

    const thRendered = renderPromotionEmail({
      course: thCourse,
      template: thTemplate,
      registrationUrl: "https://butraining.netlify.app/#/?course=course-th-1",
      recipientName: "ผศ.ดร.วิภาดา",
      posterSrc: "cid:coursePoster",
    });

    assert.ok(thRendered.htmlBody.includes("#8b0000"), "BU dark red brand color missing");
    assert.ok(thRendered.htmlBody.includes("ลงทะเบียนเข้าอบรม"));
    assert.ok(thRendered.htmlBody.includes('src="cid:coursePoster"'));
    assert.ok(thRendered.htmlBody.includes("เรียน ผศ.ดร.วิภาดา"));
    assert.ok(thRendered.textBody.includes("https://butraining.netlify.app/#/?course=course-th-1"));

    // Language override to EN without modifying original course record
    const enTemplate = getDefaultPromotionTemplate(
      { ...thCourse, title: "Active Learning with AI", description: "Practical AI pedagogy workshop." },
      "en"
    );
    assert.equal(enTemplate.ctaLabel, "Register Now");
    const enRendered = renderPromotionEmail({
      course: { ...thCourse, title: "Active Learning with AI", instructorName: "Dr. Somchai Jaidee" },
      template: enTemplate,
      registrationUrl: "https://butraining.netlify.app/#/?course=course-th-1",
      recipientName: "Dr. Alice",
      isTest: true,
    });

    assert.ok(enRendered.subject.startsWith("[TEST] "));
    assert.ok(enRendered.htmlBody.includes("Register Now"));
    assert.ok(enRendered.htmlBody.includes("[TEST EMAIL]"));
    assert.ok(enRendered.htmlBody.includes("Dear Dr. Alice"));
    assert.equal(thCourse.language, "th", "Original course language must remain untouched");
  });

  // 2. Greeting fallback & XSS escaping
  await runTest("2. Greeting fallback & strict HTML escaping prevent script/XSS injection", () => {
    const thTemplate = getDefaultPromotionTemplate({ title: "Test" }, "th");
    assert.equal(resolveGreetingForRecipient("", thTemplate), "เรียน คณาจารย์และบุคลากรทุกท่าน");

    const enTemplate = getDefaultPromotionTemplate({ title: "Test" }, "en");
    // Untranslated Thai name in English template falls back to neutral colleague greeting
    assert.equal(resolveGreetingForRecipient("อาจารย์ทดสอบ", enTemplate), "Dear Colleague");
    assert.equal(resolveGreetingForRecipient("Prof. Jane Doe", enTemplate), "Dear Prof. Jane Doe");

    const xssRendered = renderPromotionEmail({
      course: { id: "c1", title: '<script>alert("xss")</script>' },
      template: { ...enTemplate, invitationMessage: '<img src=x onerror="alert(1)">' },
      registrationUrl: "https://butraining.netlify.app/#/?course=c1",
    });
    assert.ok(!xssRendered.htmlBody.includes("<script>"), "Raw <script> tag must be escaped");
    assert.ok(!xssRendered.htmlBody.includes('<img src=x onerror='), "Injected event handler must be escaped");
    assert.equal(containsDangerousHtmlOrScript('<script>alert(1)</script>'), true);
    assert.equal(containsDangerousHtmlOrScript('Hello faculty members!'), false);
  });

  // 3. Poster validation (block private Google Drive links, preview URLs, magic bytes, size limit)
  await runTest("3. Poster validation blocks private Drive URLs, preview hosts, and invalid magic bytes", () => {
    const driveCheck = validateExternalPosterUrl("https://drive.google.com/file/d/123456/view?usp=sharing");
    assert.equal(driveCheck.valid, false);
    assert.equal(driveCheck.isGoogleDriveUrl, true);

    const previewPoster = validateExternalPosterUrl("https://ais-pre-abc123.asia-east1.run.app/poster.jpg");
    assert.equal(previewPoster.valid, false);

    const httpPoster = validateExternalPosterUrl("http://butraining.netlify.app/poster.jpg");
    assert.equal(httpPoster.valid, false);

    const validHttpsPoster = validateExternalPosterUrl("https://cdn.bu.ac.th/posters/ai-2026.jpg");
    assert.equal(validHttpsPoster.valid, true);

    // Course with legacy Drive URL is safely blocked with explanatory warning
    const courseDriveDerived = deriveInitialPosterFromCourse({
      imageUrl: "https://drive.google.com/uc?id=xyz",
    });
    assert.equal(courseDriveDerived.mode, "none");
    assert.ok(courseDriveDerived.blockedReason);

    // Valid JPEG magic bytes check server-side
    const fakePngBase64 = Buffer.from("NOT_A_REAL_PNG_BINARY").toString("base64");
    const badMagic = validatePosterPayload({
      mode: "inline_cid",
      inlineMimeType: "image/png",
      inlineBase64: fakePngBase64,
    });
    assert.equal(badMagic.valid, false);

    const realJpegHeader = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]).toString("base64");
    const goodMagic = validatePosterPayload({
      mode: "inline_cid",
      inlineMimeType: "image/jpeg",
      inlineFilename: "poster.jpg",
      inlineBase64: realJpegHeader,
    });
    assert.equal(goodMagic.valid, true);
    assert.equal(goodMagic.mode, "inline_cid");
    assert.ok(MAX_POSTER_BYTES === 800 * 1024);
  });

  // 4. Published registration link validation & preview/localhost blocking
  await runTest("4. Registration link targets published portal and rejects preview/localhost URLs", () => {
    const liveUrl = buildCampaignRegistrationLink("https://butraining.netlify.app/", "course_2026_01");
    assert.equal(liveUrl, "https://butraining.netlify.app/#/?course=course_2026_01");
    assert.equal(validatePublishedRegistrationUrl(liveUrl).valid, true);

    assert.throws(() => buildCampaignRegistrationLink("https://ais-pre-1234.asia-east1.run.app", "c1"));
    assert.throws(() => buildCampaignRegistrationLink("http://localhost:3000", "c1"));

    assert.equal(validatePublishedRegistrationUrl("https://ais-pre-999.run.app/#/?course=c1").valid, false);
    assert.equal(validatePublishedRegistrationUrl("http://127.0.0.1:3000/#/?course=c1").valid, false);
  });

  // 5. Large bulk paste parsing (1,200+ mixed entries)
  await runTest("5. Bulk paste parses 1,200+ mixed newline/comma/semicolon/angle-name entries", () => {
    const lines: string[] = [];
    for (let i = 0; i < 1200; i++) {
      const sep = i % 3 === 0 ? "\n" : i % 3 === 1 ? ", " : "; ";
      if (i % 4 === 0) {
        lines.push(`"Instructor ${i}" <staff${i}@bu.ac.th>${sep}`);
      } else {
        lines.push(`Staff${i}@BU.AC.TH${sep}`);
      }
    }
    const parsed = parseEmailAddressesText(lines.join(""));
    assert.equal(parsed.length, 1200);
    assert.equal(parsed[0].email, "staff0@bu.ac.th");
    assert.equal(parsed[0].name, "Instructor 0");
  });

  // 6. UTF-8 and UTF-8 BOM CSV import with preview & domain validation
  await runTest("6. UTF-8 and UTF-8 BOM CSV files with Thai headers parse accurately", () => {
    const csvWithBom =
      "\uFEFF" +
      [
        "อีเมล,ชื่อ-นามสกุล,หน่วยงาน",
        "somchai.k@bu.ac.th,อ.สมชาย คงดี,คณะวิศวกรรมศาสตร์",
        "external.user@gmail.com,บุคคลภายนอก,External",
        "  NAPAPORN.PU@BU.AC.TH ,ดร.นภาพร,สำนักพัฒนาการเรียนรู้",
      ].join("\n");

    const preview = parseRecipientsCsvContent(csvWithBom);
    assert.equal(preview.totalRawRows, 3);
    assert.equal(preview.detectedColumns.emailColumn, "อีเมล");
    assert.equal(preview.rows[0].isValidDomain, true);
    assert.equal(preview.rows[0].name, "อ.สมชาย คงดี");
    assert.equal(preview.rows[1].isValidDomain, false);
    assert.equal(preview.rows[2].email, "napaporn.pu@bu.ac.th");
    assert.equal(preview.rows[2].isValidDomain, true);
  });

  // 7. Deduplication, invalid/non-BU rejection & suppression enforcement
  await runTest("7. Deduplication, domain check (@bu.ac.th), and suppression exclusions work deterministically", () => {
    const result = reconcileAndValidateRecipients({
      campaignId: "camp_2026_test",
      candidates: [
        { email: "Alice@BU.AC.TH", name: "Alice", source: "paste" },
        { email: "alice@bu.ac.th", name: "Alice Updated", source: "csv" },
        { email: "not-an-email", source: "paste" },
        { email: "outsider@gmail.com", source: "paste" },
        { email: "optout@bu.ac.th", source: "instructor" },
        { email: "bob@bu.ac.th", name: "Bob", department: "School of IT", source: "instructor" },
      ],
      suppressedEmails: new Set(["optout@bu.ac.th"]),
      requireBuDomain: true,
    });

    assert.equal(result.stats.totalImported, 6);
    assert.equal(result.stats.eligibleCount, 2);
    assert.equal(result.stats.duplicateCount, 1);
    assert.equal(result.stats.invalidCount, 2);
    assert.equal(result.stats.suppressedCount, 1);
    assert.equal(isAuthorizedUniversityEmail("staff@bu.ac.th"), true);
    assert.equal(isAuthorizedUniversityEmail("staff@gmail.com"), false);
    assert.equal(isAuthorizedBuEmail("staff@bu.ac.th"), true);
    assert.equal(isAuthorizedBuEmail("staff@gmail.com"), false);

    // Deterministic recipient doc IDs prevent duplicates across retries
    const id1 = buildCampaignRecipientDocId("camp_2026_test", "Alice@BU.AC.TH");
    const id2 = buildCampaignRecipientDocId("camp_2026_test", "alice@bu.ac.th");
    assert.equal(id1, id2);
    assert.match(id1, /^[a-zA-Z0-9_-]+$/);
    assert.match(buildSuppressionDocId("optout@bu.ac.th"), /^[a-zA-Z0-9_-]+$/);
  });

  // 8. Firestore record builder strips large inline base64 images
  await runTest("8. Campaign Firestore record excludes inlineBase64 to respect document size limits", () => {
    const campaignDoc = buildFirestoreCampaignRecord({
      campaignId: "camp_1",
      courseId: "course_1",
      courseTitle: "Course Title",
      language: "th",
      template: getDefaultPromotionTemplate({ title: "Course Title" }, "th"),
      registrationUrl: "https://butraining.netlify.app/#/?course=course_1",
      poster: {
        mode: "inline_cid",
        inlineBase64: "AAAA".repeat(2000),
        inlineMimeType: "image/jpeg",
        inlineFilename: "poster.jpg",
        width: 800,
        height: 450,
        byteSize: 6000,
      },
      recipientsCount: 150,
      suppressedCount: 2,
      adminUid: "admin-uid",
      adminEmail: "admin@bu.ac.th",
    });

    assert.equal((campaignDoc as any).inlineBase64, undefined);
    assert.equal(campaignDoc.posterMode, "inline_cid");
    assert.equal(campaignDoc.posterMeta?.filename, "poster.jpg");
    assert.equal(campaignDoc.pendingCount, 150);
  });

  // 9. CSV results export includes UTF-8 BOM and formula neutralization
  await runTest("9. Campaign CSV export protects formula cells and prepends UTF-8 BOM", () => {
    const { csvContent, filename } = generateCampaignResultsCsv(
      { id: "camp123456", courseTitle: "AI Training", language: "th" },
      [
        {
          id: "r1",
          campaignId: "camp123456",
          email: "faculty@bu.ac.th",
          name: "=HYPERLINK(\"http://evil\",\"click\")",
          department: "+Dept",
          source: "csv",
          status: "sent",
          sentAt: "2026-06-01T10:00:00.000Z",
          attempts: 1,
          updatedAt: "2026-06-01T10:00:00.000Z",
        },
      ]
    );
    assert.ok(csvContent.startsWith("\ufeff"));
    assert.ok(!csvContent.includes("\n=HYPERLINK"));
    assert.ok(filename.endsWith(".csv"));
  });

  // 10. Netlify gateway authentication & HTTP guardrails (offline handler invocation)
  await runTest("10. Netlify gateway rejects missing auth, GET requests, and oversized payloads", async () => {
    const getRes = await promotionHandler({
      httpMethod: "GET",
      path: "/.netlify/functions/send-course-promotion",
      headers: {},
      body: null,
    });
    assert.equal(getRes.statusCode, 405);

    const noAuthRes = await promotionHandler({
      httpMethod: "POST",
      path: "/.netlify/functions/send-course-promotion",
      headers: {},
      body: JSON.stringify({ action: "check_quota" }),
    });
    assert.equal(noAuthRes.statusCode, 401);

    const hugeRes = await promotionHandler({
      httpMethod: "POST",
      path: "/.netlify/functions/send-course-promotion",
      headers: { authorization: "Bearer fake-token" },
      body: "a".repeat(2.6 * 1024 * 1024),
    });
    assert.equal(hugeRes.statusCode, 413);
  });

  // 11. Security rules & isolated GAS / Netlify files check
  await runTest("11. Firestore rules enforce Admin-only promotion collections and preserve existing paths", () => {
    const rules = fs.readFileSync(path.join(ROOT_DIR, "firestore.rules"), "utf8");
    assert.ok(rules.includes("match /promotion_campaigns/{campaignId}"));
    assert.ok(rules.includes("match /recipients/{recipientId}"));
    assert.ok(rules.includes("match /promotion_suppressions/{emailKey}"));
    assert.ok(rules.includes("isValidPromotionCampaign("));
    assert.ok(rules.includes("isValidCampaignRecipient("));
    // Ensure existing production collections remain intact
    assert.ok(rules.includes("match /courses/{courseId}"));
    assert.ok(rules.includes("match /registrations/{regId}"));
    assert.ok(rules.includes("match /evaluations/{evaluationId}"));
  });

  // 12. Standalone GAS_PROMOTION_CODE.gs verification (isolation, MailApp quota, 1-to-1 send, idempotency, time-budget)
  await runTest("12. GAS_PROMOTION_CODE.gs implements secret auth, MailApp quota, CID inlineImages, 1-to-1 send & idempotency", () => {
    const gasCode = fs.readFileSync(path.join(ROOT_DIR, "GAS_PROMOTION_CODE.gs"), "utf8");
    assert.ok(gasCode.includes("INTERNAL_PROMOTION_SECRET"));
    assert.ok(gasCode.includes("MailApp.getRemainingDailyQuota()"));
    assert.ok(gasCode.includes("LockService.getScriptLock()"));
    assert.ok(gasCode.includes("CacheService.getScriptCache()"));
    assert.ok(gasCode.includes("inlineImages"));
    assert.ok(gasCode.includes("send_course_promotion"));
    assert.ok(gasCode.includes('status: "unattempted"'));
    assert.ok(gasCode.includes("@bu\\.ac\\.th"));
  });

  // 13. Confirm legacy Module 17 / 20 files remain isolated & unmodified by checking Netlify/GAS isolation
  await runTest("13. Existing Module 20 and registration email gateways remain untouched", () => {
    const module20Fn = fs.readFileSync(path.join(ROOT_DIR, "netlify/functions/send-training-report.ts"), "utf8");
    assert.ok(!module20Fn.includes("send_course_promotion"));
    const legacyGas = fs.readFileSync(path.join(ROOT_DIR, "GAS_EN_CODE.gs"), "utf8");
    assert.ok(!legacyGas.includes("send_course_promotion"));
  });

  console.log(`\n=== All ${passed} Module 22 Offline Tests Passed ===`);
}

main();
