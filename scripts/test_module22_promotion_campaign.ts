import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyAsyncTranslationResultIfEligible,
  buildCampaignRecipientDocId,
  buildCampaignRegistrationLink,
  buildSuppressionDocId,
  buildTranslationCacheKey,
  computeDescriptionHash,
  containsThaiCharacters,
  deletePromotionCampaign,
  deriveInitialPosterFromCourse,
  dispatchPromotionBatch,
  evaluateCampaignDeletionEligibility,
  evaluateEnglishAutoTranslation,
  fetchPromotionQuota,
  generateCampaignResultsCsv,
  getDefaultPromotionTemplate,
  isAuthorizedUniversityEmail,
  isCachedTranslationStale,
  MAX_POSTER_BYTES,
  normalizeEmailAddress,
  parseEmailAddressesText,
  parseRecipientsCsvContent,
  PROMOTION_GATEWAY_ENDPOINT,
  PROMOTION_GATEWAY_FALLBACK_ENDPOINT,
  reconcileAndValidateRecipients,
  renderPromotionEmail,
  resolveEnglishDescriptionGuard,
  resolveGreetingForRecipient,
  resolveInitialCampaignLanguage,
  sendPromotionTestEmail,
  translateCourseDescription,
  TRANSLATE_DESCRIPTION_ENDPOINT,
  validateExternalPosterUrl,
} from "../src/lib/promotionCampaign";
import { buildCourseRegistrationUrl } from "../src/lib/appUrl";
import { buildFirestoreCampaignRecord } from "../src/lib/promotionCampaignService";
import {
  containsDangerousHtmlOrScript,
  handler as promotionHandler,
  handlePromotionWithDeps,
  isAuthorizedBuEmail,
  validatePosterPayload,
  validatePublishedRegistrationUrl,
} from "../netlify/functions/send-course-promotion";
import {
  classifyGeminiApiError,
  computeDescriptionHashServer,
  DEFAULT_TRANSLATION_MODEL,
  handleTranslateWithDeps,
  resolveTranslationModel,
} from "../netlify/functions/translate-course-description";

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
      registrationUrl: "https://butraining.netlify.app/",
      recipientName: "ผศ.ดร.วิภาดา",
      posterSrc: "cid:coursePoster",
    });

    assert.ok(thRendered.htmlBody.includes('<tr><td align="left" style="text-align:left;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;margin:0;'), "Outer container must be left-aligned without auto-centering margins");
    assert.ok(thRendered.htmlBody.includes('<td align="center" style="padding:6px 0 18px 0;">'), "CTA button internal alignment must stay centered");
    assert.ok(thRendered.htmlBody.includes('text-align:center;background-color:#ffffff;"><img '), "Poster internal alignment must stay centered");
    assert.ok(thRendered.htmlBody.includes("#8b0000"), "BU dark red brand color missing");
    assert.ok(thRendered.htmlBody.includes("ลงทะเบียนเข้าอบรม"));
    assert.ok(thRendered.htmlBody.includes('src="cid:coursePoster"'));
    assert.ok(thRendered.htmlBody.includes("เรียน ผศ.ดร.วิภาดา"));
    assert.ok(thRendered.textBody.includes("https://butraining.netlify.app/"));
    assert.ok(!thRendered.htmlBody.includes("#/?course="), "Registration CTA and link must not include course-specific hash/query");

    // Language override to EN without modifying original course record
    const enTemplate = getDefaultPromotionTemplate(
      { ...thCourse, title: "Active Learning with AI", description: "Practical AI pedagogy workshop." },
      "en"
    );
    assert.equal(enTemplate.ctaLabel, "Register Now");
    const enRendered = renderPromotionEmail({
      course: { ...thCourse, title: "Active Learning with AI", instructorName: "Dr. Somchai Jaidee" },
      template: enTemplate,
      registrationUrl: "https://butraining.netlify.app/",
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
      registrationUrl: "https://butraining.netlify.app/",
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

  // 4. Published registration link validation, legacy draft normalization & preview/localhost blocking
  await runTest("4. Registration link targets exact homepage URL (even from legacy drafts) and rejects preview/localhost URLs", () => {
    const liveUrl = buildCampaignRegistrationLink("https://butraining.netlify.app/", "course_2026_01");
    assert.equal(liveUrl, "https://butraining.netlify.app/");
    assert.equal(buildCourseRegistrationUrl("https://butraining.netlify.app", "course_2026_01"), "https://butraining.netlify.app/");
    assert.equal(validatePublishedRegistrationUrl(liveUrl).valid, true);
    assert.equal(validatePublishedRegistrationUrl(liveUrl).normalizedUrl, "https://butraining.netlify.app/");

    // Existing legacy draft containing #/?course= must normalize to clean homepage URL everywhere
    const legacyDraftUrl = "https://butraining.netlify.app/#/?course=legacy_course_99";
    assert.equal(validatePublishedRegistrationUrl(legacyDraftUrl).normalizedUrl, "https://butraining.netlify.app/");

    const draftNormalizedRecord = buildFirestoreCampaignRecord({
      campaignId: "camp_legacy_fix",
      courseId: "legacy_course_99",
      courseTitle: "Legacy Draft Course",
      language: "en",
      template: getDefaultPromotionTemplate({ title: "Legacy Draft Course" }, "en"),
      registrationUrl: legacyDraftUrl,
      poster: { mode: "none" },
      recipientsCount: 5,
      suppressedCount: 0,
      adminUid: "admin-1",
      adminEmail: "admin@bu.ac.th",
    });
    assert.equal(draftNormalizedRecord.registrationUrl, "https://butraining.netlify.app/");

    const renderedLegacy = renderPromotionEmail({
      course: { id: "legacy_course_99", title: "Legacy Draft Course" },
      template: getDefaultPromotionTemplate({ title: "Legacy Draft Course" }, "en"),
      registrationUrl: legacyDraftUrl,
    });
    assert.ok(!renderedLegacy.htmlBody.includes("#/?course="));
    assert.ok(!renderedLegacy.textBody.includes("#/?course="));
    assert.ok(renderedLegacy.htmlBody.includes('href="https://butraining.netlify.app/"'));
    assert.ok(renderedLegacy.textBody.includes("https://butraining.netlify.app/"));

    assert.throws(() => buildCampaignRegistrationLink("https://ais-pre-1234.asia-east1.run.app", "c1"));
    assert.throws(() => buildCampaignRegistrationLink("http://localhost:3000", "c1"));

    assert.equal(validatePublishedRegistrationUrl("https://ais-pre-999.run.app/").valid, false);
    assert.equal(validatePublishedRegistrationUrl("http://127.0.0.1:3000/").valid, false);
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
      registrationUrl: "https://butraining.netlify.app/",
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

  // Helper: minimal stateful mock Firestore DB matching Admin SDK surface used by handlePromotionWithDeps
  function createMockAdminDb(seed: {
    courses?: Record<string, any>;
    campaigns?: Record<string, any>;
    recipientsByCampaign?: Record<string, Record<string, any>>;
    suppressions?: Record<string, any>;
    failOnBatchCommitNumber?: number;
  }) {
    let commitCallCount = 0;
    const store = {
      courses: structuredClone(seed.courses || {}),
      promotion_campaigns: structuredClone(seed.campaigns || {}),
      recipientsByCampaign: structuredClone(seed.recipientsByCampaign || {}),
      promotion_suppressions: structuredClone(seed.suppressions || {}),
      deleteOrder: [] as string[],
    };

    const makeDocRef = (colPath: string, docId: string, parentCampaignId?: string): any => ({
      id: docId,
      path: parentCampaignId ? `promotion_campaigns/${parentCampaignId}/recipients/${docId}` : `${colPath}/${docId}`,
      async get() {
        const map = parentCampaignId
          ? (store.recipientsByCampaign[parentCampaignId] ||= {})
          : (store as any)[colPath];
        const data = map?.[docId];
        return {
          id: docId,
          exists: Boolean(data),
          data: () => (data ? structuredClone(data) : undefined),
          ref: makeDocRef(colPath, docId, parentCampaignId),
        };
      },
      async update(patch: Record<string, any>) {
        const map = parentCampaignId
          ? (store.recipientsByCampaign[parentCampaignId] ||= {})
          : (store as any)[colPath];
        if (!map?.[docId]) throw new Error(`Doc not found: ${colPath}/${docId}`);
        map[docId] = { ...map[docId], ...structuredClone(patch) };
      },
      async delete() {
        const map = parentCampaignId
          ? (store.recipientsByCampaign[parentCampaignId] ||= {})
          : (store as any)[colPath];
        if (map && Object.prototype.hasOwnProperty.call(map, docId)) {
          delete map[docId];
          store.deleteOrder.push(
            parentCampaignId ? `recipients/${parentCampaignId}/${docId}` : `${colPath}/${docId}`
          );
        }
      },
    });

    const makeCollection = (colPath: string, parentCampaignId?: string): any => {
      const getMap = () =>
        parentCampaignId
          ? (store.recipientsByCampaign[parentCampaignId] ||= {})
          : ((store as any)[colPath] || {});

      return {
        doc: (docId: string) => makeDocRef(colPath, docId, parentCampaignId),
        limit(n: number) {
          return {
            async get() {
              const map = getMap();
              const docs = Object.entries(map)
                .slice(0, n)
                .map(([id, data]) => ({
                  id,
                  exists: true,
                  data: () => structuredClone(data),
                  ref: makeDocRef(colPath, id, parentCampaignId),
                }));
              return { empty: docs.length === 0, docs };
            },
          };
        },
        async get() {
          const map = getMap();
          const docs = Object.entries(map).map(([id, data]) => ({
            id,
            exists: true,
            data: () => structuredClone(data),
            ref: makeDocRef(colPath, id, parentCampaignId),
          }));
          return { empty: docs.length === 0, docs };
        },
        where(field: string, op: string, value: any) {
          assert.equal(op, "==");
          let max = Infinity;
          const queryObj = {
            limit(n: number) {
              max = n;
              return queryObj;
            },
            async get() {
              const map = getMap();
              const matched = Object.entries(map)
                .filter(([, data]: any) => data?.[field] === value)
                .slice(0, max)
                .map(([id, data]) => ({
                  id,
                  exists: true,
                  data: () => structuredClone(data),
                  ref: makeDocRef(colPath, id, parentCampaignId),
                }));
              return { empty: matched.length === 0, docs: matched };
            },
          };
          return queryObj;
        },
      };
    };

    return {
      store,
      collection(name: string) {
        if (name === "promotion_campaigns") {
          return {
            doc(campaignId: string) {
              const base = makeDocRef("promotion_campaigns", campaignId);
              base.collection = (subName: string) => {
                assert.equal(subName, "recipients");
                return makeCollection("recipients", campaignId);
              };
              return base;
            },
          };
        }
        return makeCollection(name);
      },
      batch() {
        const ops: Array<{ type: "update" | "delete"; ref: any; patch?: Record<string, any> }> = [];
        return {
          update(ref: any, patch: Record<string, any>) {
            ops.push({ type: "update", ref, patch });
          },
          delete(ref: any) {
            ops.push({ type: "delete", ref });
          },
          async commit() {
            commitCallCount++;
            if (seed.failOnBatchCommitNumber && commitCallCount === seed.failOnBatchCommitNumber) {
              throw new Error(`Simulated batch failure on commit #${commitCallCount}`);
            }
            for (const op of ops) {
              if (op.type === "delete") {
                await op.ref.delete();
              } else {
                await op.ref.update(op.patch);
              }
            }
          },
        };
      },
      async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        const tx = {
          async get(target: any) {
            return await target.get();
          },
          update(ref: any, patch: Record<string, any>) {
            opsQueue.push(() => ref.update(patch));
          },
        };
        const opsQueue: Array<() => Promise<void>> = [];
        const res = await fn(tx);
        for (const runOp of opsQueue) {
          await runOp();
        }
        return res;
      },
    };
  }

  // 14. Netlify redirects & client endpoint alignment + safe non-executing 404 fallback
  await runTest("14. Primary gateway uses /api/send-course-promotion with Netlify redirects and safe routing-404 fallback", async () => {
    assert.equal(PROMOTION_GATEWAY_ENDPOINT, "/api/send-course-promotion");
    assert.equal(PROMOTION_GATEWAY_FALLBACK_ENDPOINT, "/.netlify/functions/send-course-promotion");

    const netlifyToml = fs.readFileSync(path.join(ROOT_DIR, "netlify.toml"), "utf8");
    const redirects = fs.readFileSync(path.join(ROOT_DIR, "public/_redirects"), "utf8");
    assert.ok(netlifyToml.includes('from = "/api/*"') && netlifyToml.includes('to = "/.netlify/functions/:splat"'));
    assert.ok(redirects.includes("/api/* /.netlify/functions/:splat 200"));

    // Simulate /api/* returning non-JSON 404 -> falls back once to /.netlify/functions/send-course-promotion
    const calledUrls: string[] = [];
    const resFallback = await dispatchPromotionBatch({
      idToken: "mock-token",
      campaignId: "camp_1",
      fetchImpl: (async (url: RequestInfo | URL) => {
        calledUrls.push(String(url));
        if (String(url) === "/api/send-course-promotion") {
          return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
        }
        return new Response(
          JSON.stringify({ status: "success", processedCount: 1, sentCount: 1, remainingPending: 0 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch,
    });
    assert.deepEqual(calledUrls, ["/api/send-course-promotion", "/.netlify/functions/send-course-promotion"]);
    assert.equal(resFallback.ok, true);
    assert.equal(resFallback.sentCount, 1);

    // Simulate reached server returning JSON 404 (e.g. CAMPAIGN_NOT_FOUND): must NOT trigger blind fallback retry
    const calledJson404: string[] = [];
    const resCampaign404 = await dispatchPromotionBatch({
      idToken: "mock-token",
      campaignId: "missing_camp",
      fetchImpl: (async (url: RequestInfo | URL) => {
        calledJson404.push(String(url));
        return new Response(
          JSON.stringify({ status: "error", code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch,
    });
    assert.deepEqual(calledJson404, ["/api/send-course-promotion"]);
    assert.equal(resCampaign404.ok, false);
    assert.equal(resCampaign404.httpStatus, 404);
    assert.equal(resCampaign404.code, "CAMPAIGN_NOT_FOUND");
    assert.equal(resCampaign404.outcomeAmbiguous, false);

    // Simulate reached gateway returning incomplete non-JSON 502: marks outcomeAmbiguous=true and does NOT retry
    const called502: string[] = [];
    const resIncomplete502 = await dispatchPromotionBatch({
      idToken: "mock-token",
      campaignId: "camp_1",
      fetchImpl: (async (url: RequestInfo | URL) => {
        called502.push(String(url));
        return new Response("Bad Gateway truncated", { status: 502, headers: { "Content-Type": "text/plain" } });
      }) as typeof fetch,
    });
    assert.deepEqual(called502, ["/api/send-course-promotion"]);
    assert.equal(resIncomplete502.ok, false);
    assert.equal(resIncomplete502.httpStatus, 502);
    assert.equal(resIncomplete502.code, "UPSTREAM_ERROR");
    assert.equal(resIncomplete502.outcomeAmbiguous, true);
  });

  // 15. Exact Firestore campaignId matching (dots/mixed IDs) + CAMPAIGN_NOT_FOUND & COURSE_NOT_FOUND + GATEWAY_UNCONFIGURED
  await runTest("15. Dispatch finds exact campaignId (including dots) & returns structured CAMPAIGN_NOT_FOUND / COURSE_NOT_FOUND / GATEWAY_UNCONFIGURED", async () => {
    const db = createMockAdminDb({
      courses: {
        "course-existing": { title: "AI Training 2026", language: "en" },
      },
      campaigns: {
        "camp.2026.dotted_id": {
          id: "camp.2026.dotted_id",
          courseId: "course-existing",
          language: "en",
          registrationUrl: "https://butraining.netlify.app/",
          posterMode: "none",
          template: getDefaultPromotionTemplate({ title: "AI Training 2026" }, "en"),
        },
        "camp_orphaned_course": {
          id: "camp_orphaned_course",
          courseId: "missing-course-id",
          language: "th",
          registrationUrl: "https://butraining.netlify.app/",
          posterMode: "none",
          template: getDefaultPromotionTemplate({ title: "Missing" }, "th"),
        },
      },
      recipientsByCampaign: {
        "camp.2026.dotted_id": {},
      },
    });

    const baseDeps = {
      db,
      verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
      verifyAdmin: async () => true,
      gasUrl: "https://script.google.com/macros/s/mock/exec",
      gasSecret: "mock-secret-xyz",
      skipRateLimit: true,
    };

    const unconfiguredRes = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({ action: "dispatch_batch", campaignId: "camp.2026.dotted_id" }),
      },
      { ...baseDeps, gasUrl: "", gasSecret: "" }
    );
    assert.equal(unconfiguredRes.statusCode, 503);
    assert.equal(JSON.parse(unconfiguredRes.body).code, "GATEWAY_UNCONFIGURED");

    const missingCampRes = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({ action: "dispatch_batch", campaignId: "does_not_exist" }),
      },
      baseDeps
    );
    assert.equal(missingCampRes.statusCode, 404);
    assert.equal(JSON.parse(missingCampRes.body).code, "CAMPAIGN_NOT_FOUND");

    const missingCourseRes = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({ action: "dispatch_batch", campaignId: "camp_orphaned_course" }),
      },
      baseDeps
    );
    assert.equal(missingCourseRes.statusCode, 404);
    assert.equal(JSON.parse(missingCourseRes.body).code, "COURSE_NOT_FOUND");

    // Dotted ID must be found exact (0 pending -> succeeds cleanly without mutating ID to underscore)
    const exactMatchRes = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({ action: "dispatch_batch", campaignId: "camp.2026.dotted_id" }),
      },
      baseDeps
    );
    assert.equal(exactMatchRes.statusCode, 200);
    assert.equal(JSON.parse(exactMatchRes.body).processedCount, 0);
  });

  // 16. Safe error reporting helper preserves HTTP status + error code without leaking secrets/tokens
  await runTest("16. Client wrappers preserve HTTP status and safe codes without exposing tokens or secrets", async () => {
    const quotaErr = await fetchPromotionQuota("secret-jwt-should-not-leak", (async () => {
      return new Response(
        JSON.stringify({ status: "error", code: "GATEWAY_UNCONFIGURED", message: "Mail gateway not configured" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch);
    assert.equal(quotaErr.ok, false);
    assert.equal(quotaErr.httpStatus, 503);
    assert.equal(quotaErr.code, "GATEWAY_UNCONFIGURED");
    assert.ok(!JSON.stringify(quotaErr).includes("secret-jwt-should-not-leak"));

    const testErr = await sendPromotionTestEmail({
      idToken: "secret-jwt-should-not-leak",
      courseId: "c1",
      testEmail: "admin@bu.ac.th",
      language: "en",
      registrationUrl: "https://butraining.netlify.app/",
      template: getDefaultPromotionTemplate({ title: "Test" }, "en"),
      poster: { mode: "none" },
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ status: "error", code: "UNAUTHORIZED", message: "Missing Bearer token" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch,
    });
    assert.equal(testErr.ok, false);
    assert.equal(testErr.httpStatus, 401);
    assert.equal(testErr.code, "UNAUTHORIZED");
    assert.ok(!JSON.stringify(testErr).includes("secret-jwt-should-not-leak"));
  });

  // 17. Mocked send_test succeeds without touching campaign recipients
  await runTest("17. Mocked send_test dispatches [TEST] preview cleanly without modifying campaign recipients", async () => {
    const db = createMockAdminDb({
      courses: { "c-test": { title: "Bilingual Course", language: "th" } },
      campaigns: { "camp-test": { id: "camp-test", courseId: "c-test", sentCount: 0, pendingCount: 1 } },
      recipientsByCampaign: {
        "camp-test": {
          "rec-1": { email: "faculty@bu.ac.th", name: "Faculty 1", status: "pending", attempts: 0 },
        },
      },
    });

    let gasCaptured: any = null;
    const res = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({
          action: "send_test",
          courseId: "c-test",
          campaignId: "camp-test",
          testEmail: "kulachet.l@bu.ac.th",
          language: "th",
          registrationUrl: "https://butraining.netlify.app/",
          template: getDefaultPromotionTemplate({ title: "Bilingual Course" }, "th"),
          poster: { mode: "none" },
        }),
      },
      {
        db,
        verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
        verifyAdmin: async () => true,
        gasUrl: "https://script.google.com/macros/s/mock/exec",
        gasSecret: "mock-secret",
        skipRateLimit: true,
        fetchFn: (async (_url: RequestInfo | URL, init?: RequestInit) => {
          gasCaptured = JSON.parse(String(init?.body || "{}"));
          return new Response(
            JSON.stringify({
              status: "success",
              remainingDailyQuota: 99,
              results: [{ recipientId: gasCaptured.messages[0].recipientId, status: "sent" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }) as typeof fetch,
      }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(gasCaptured.isTest, true);
    assert.ok(gasCaptured.messages[0].subject.startsWith("[TEST] "));
    assert.equal(db.store.recipientsByCampaign["camp-test"]["rec-1"].status, "pending");
  });

  // 18. Mocked dispatch_batch processes pending -> sent & NEVER touches sent/unknown/processing rows
  await runTest("18. Dispatch batch sends 1 pending recipient and preserves existing sent, unknown, and processing rows", async () => {
    const db = createMockAdminDb({
      courses: { "c-live": { title: "Live Workshop", language: "th" } },
      campaigns: {
        "camp-live": {
          id: "camp-live",
          courseId: "c-live",
          language: "th",
          registrationUrl: "https://butraining.netlify.app/",
          posterMode: "none",
          template: getDefaultPromotionTemplate({ title: "Live Workshop" }, "th"),
          activeLockUntil: "",
        },
      },
      recipientsByCampaign: {
        "camp-live": {
          "rec-sent": { email: "already@bu.ac.th", name: "Already Sent", status: "sent", sentAt: "2026-06-01T00:00:00Z", attempts: 1 },
          "rec-unknown": { email: "unknown@bu.ac.th", name: "Unknown Row", status: "unknown", attempts: 1 },
          "rec-processing": { email: "inprogress@bu.ac.th", name: "Processing Row", status: "processing", attempts: 1 },
          "rec-pending": { email: "newfaculty@bu.ac.th", name: "New Faculty", status: "pending", attempts: 0 },
        },
      },
    });

    const sentTo: string[] = [];
    const res = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({
          action: "dispatch_batch",
          campaignId: "camp-live",
          batchSize: 10,
          poster: { mode: "none" },
        }),
      },
      {
        db,
        verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
        verifyAdmin: async () => true,
        gasUrl: "https://script.google.com/macros/s/mock/exec",
        gasSecret: "mock-secret",
        skipRateLimit: true,
        fetchFn: (async (_url: RequestInfo | URL, init?: RequestInit) => {
          const payload = JSON.parse(String(init?.body || "{}"));
          for (const msg of payload.messages) sentTo.push(msg.to);
          return new Response(
            JSON.stringify({
              status: "success",
              remainingDailyQuota: 95,
              results: payload.messages.map((m: any) => ({
                recipientId: m.recipientId,
                status: "sent",
                sentAt: "2026-06-02T09:00:00.000Z",
              })),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }) as typeof fetch,
      }
    );

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.processedCount, 1);
    assert.equal(body.sentCount, 1);
    assert.equal(body.remainingPending, 0);
    assert.deepEqual(sentTo, ["newfaculty@bu.ac.th"]);
    assert.equal(db.store.recipientsByCampaign["camp-live"]["rec-pending"].status, "sent");
    assert.equal(db.store.recipientsByCampaign["camp-live"]["rec-sent"].status, "sent");
    assert.equal(db.store.recipientsByCampaign["camp-live"]["rec-unknown"].status, "unknown");
    assert.equal(db.store.recipientsByCampaign["camp-live"]["rec-processing"].status, "processing");
    assert.equal(db.store.promotion_campaigns["camp-live"].activeLockUntil, "");
    assert.equal(db.store.promotion_campaigns["camp-live"].sentCount, 2);
  });

  // 19. Upstream GAS failure/timeout marks newly claimed recipients Unknown (NEVER Pending) and releases lock
  await runTest("19. Upstream timeout/failure marks claimed recipients unknown, never resets sent to pending, and releases lock", async () => {
    const db = createMockAdminDb({
      courses: { "c-fail": { title: "Timeout Course", language: "en" } },
      campaigns: {
        "camp-fail": {
          id: "camp-fail",
          courseId: "c-fail",
          language: "en",
          registrationUrl: "https://butraining.netlify.app/",
          posterMode: "none",
          template: getDefaultPromotionTemplate({ title: "Timeout Course" }, "en"),
          activeLockUntil: "",
        },
      },
      recipientsByCampaign: {
        "camp-fail": {
          "rec-already-sent": { email: "done@bu.ac.th", name: "Done", status: "sent", attempts: 1 },
          "rec-will-timeout": { email: "wait@bu.ac.th", name: "Wait", status: "pending", attempts: 0 },
        },
      },
    });

    const res = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({
          action: "dispatch_batch",
          campaignId: "camp-fail",
          batchSize: 5,
          poster: { mode: "none" },
        }),
      },
      {
        db,
        verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
        verifyAdmin: async () => true,
        gasUrl: "https://script.google.com/macros/s/mock/exec",
        gasSecret: "mock-secret",
        skipRateLimit: true,
        fetchFn: (async () => {
          throw new Error("ETIMEDOUT contacting GAS");
        }) as typeof fetch,
      }
    );

    assert.equal(res.statusCode, 502);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "UPSTREAM_ERROR");
    assert.equal(body.unknownCount, 1);
    assert.equal(db.store.recipientsByCampaign["camp-fail"]["rec-will-timeout"].status, "unknown");
    assert.equal(db.store.recipientsByCampaign["camp-fail"]["rec-already-sent"].status, "sent");
    assert.equal(db.store.promotion_campaigns["camp-fail"].activeLockUntil, "");
    assert.equal(db.store.promotion_campaigns["camp-fail"].unknownCount, 1);
  });

  // 20. Preserve left-aligned outer container and exact https://butraining.netlify.app/ URL across Netlify server renderer too
  await runTest("20. Server renderer preserves left alignment and exact homepage registration URL", async () => {
    const db = createMockAdminDb({
      courses: { "c-html": { title: "Left Align Check", language: "th" } },
      campaigns: {
        "camp-html": {
          id: "camp-html",
          courseId: "c-html",
          language: "th",
          registrationUrl: "https://butraining.netlify.app/#/?course=c-html",
          posterMode: "none",
          template: getDefaultPromotionTemplate({ title: "Left Align Check" }, "th"),
          activeLockUntil: "",
        },
      },
      recipientsByCampaign: {
        "camp-html": {
          "rec-1": { email: "check@bu.ac.th", name: "Dr. Check", status: "pending", attempts: 0 },
        },
      },
    });

    let capturedHtml = "";
    const res = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({ action: "dispatch_batch", campaignId: "camp-html" }),
      },
      {
        db,
        verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
        verifyAdmin: async () => true,
        gasUrl: "https://script.google.com/macros/s/mock/exec",
        gasSecret: "mock-secret",
        skipRateLimit: true,
        fetchFn: (async (_url: RequestInfo | URL, init?: RequestInit) => {
          const payload = JSON.parse(String(init?.body || "{}"));
          capturedHtml = payload.messages[0].htmlBody;
          return new Response(
            JSON.stringify({
              status: "success",
              remainingDailyQuota: 90,
              results: [{ recipientId: "rec-1", status: "sent" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }) as typeof fetch,
      }
    );

    assert.equal(res.statusCode, 200);
    assert.ok(capturedHtml.includes('<tr><td align="left" style="text-align:left;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;margin:0;'));
    assert.ok(capturedHtml.includes('href="https://butraining.netlify.app/"'));
    assert.ok(!capturedHtml.includes("#/?course="));
  });

  // 21. Client & shared deletion eligibility rules (draft/ready/clean paused allowed; completed/sending/sent/unknown/processing/locked blocked)
  await runTest("21. evaluateCampaignDeletionEligibility enforces exact allowed/blocked states", () => {
    assert.equal(evaluateCampaignDeletionEligibility({ status: "draft", sentCount: 0, unknownCount: 0 }).allowed, true);
    assert.equal(evaluateCampaignDeletionEligibility({ status: "ready", sentCount: 0, unknownCount: 0 }).allowed, true);
    assert.equal(
      evaluateCampaignDeletionEligibility(
        { status: "paused", sentCount: 0, unknownCount: 0, activeLockUntil: "" },
        [{ status: "pending" }, { status: "failed" }]
      ).allowed,
      true
    );

    assert.equal(evaluateCampaignDeletionEligibility({ status: "completed", sentCount: 10, unknownCount: 0 }).allowed, false);
    assert.equal(evaluateCampaignDeletionEligibility({ status: "completed_with_issues", sentCount: 10, unknownCount: 1 }).allowed, false);
    assert.equal(evaluateCampaignDeletionEligibility({ status: "sending", sentCount: 0, unknownCount: 0 }).allowed, false);
    assert.equal(evaluateCampaignDeletionEligibility({ status: "paused", sentCount: 1, unknownCount: 0 }).allowed, false);
    assert.equal(evaluateCampaignDeletionEligibility({ status: "paused", sentCount: 0, unknownCount: 1 }).allowed, false);
    assert.equal(
      evaluateCampaignDeletionEligibility({
        status: "paused",
        sentCount: 0,
        unknownCount: 0,
        activeLockUntil: new Date(Date.now() + 20_000).toISOString(),
      }).allowed,
      false
    );
    assert.equal(
      evaluateCampaignDeletionEligibility(
        { status: "paused", sentCount: 0, unknownCount: 0 },
        [{ status: "processing" }]
      ).allowed,
      false
    );
  });

  // 22. Server delete_campaign deletes draft campaigns and ready campaigns (including >380 recipients in chunked batches BEFORE parent delete) and leaves unrelated collections untouched
  await runTest("22. Safe delete removes draft and ready (>380 pending recipients) in batches before parent without touching courses, suppressions, or completed campaigns", async () => {
    const bulkRecipients: Record<string, any> = {};
    for (let i = 0; i < 410; i++) {
      bulkRecipients[`rec_${i}`] = { email: `staff${i}@bu.ac.th`, status: "pending", attempts: 0 };
    }

    const db = createMockAdminDb({
      courses: { "c-preserve": { title: "Important Course", language: "th" } },
      suppressions: { "sup-1": { email: "optout@bu.ac.th" } },
      campaigns: {
        "camp-draft": { id: "camp-draft", courseId: "c-preserve", status: "draft", sentCount: 0, unknownCount: 0, totalRecipients: 0 },
        "camp-ready-410": { id: "camp-ready-410", courseId: "c-preserve", status: "ready", sentCount: 0, unknownCount: 0, totalRecipients: 410 },
        "camp-completed-hist": { id: "camp-completed-hist", courseId: "c-preserve", status: "completed", sentCount: 5, unknownCount: 0, totalRecipients: 5 },
      },
      recipientsByCampaign: {
        "camp-draft": {},
        "camp-ready-410": bulkRecipients,
        "camp-completed-hist": { "rec-done": { email: "done@bu.ac.th", status: "sent" } },
      },
    });

    const deps = {
      db,
      verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
      verifyAdmin: async () => true,
      // Explicitly omit GAS env to confirm deletion does not require GAS configuration!
      gasUrl: "",
      gasSecret: "",
      skipRateLimit: true,
    };

    // Delete draft
    const draftRes = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-admin-token" },
        body: JSON.stringify({ action: "delete_campaign", campaignId: "camp-draft", adminConfirmed: true }),
      },
      deps
    );
    assert.equal(draftRes.statusCode, 200);
    assert.equal(db.store.promotion_campaigns["camp-draft"], undefined);

    // Delete ready with 410 pending recipients
    const readyRes = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-admin-token" },
        body: JSON.stringify({ action: "delete_campaign", campaignId: "camp-ready-410", adminConfirmed: true }),
      },
      deps
    );
    assert.equal(readyRes.statusCode, 200);
    const readyBody = JSON.parse(readyRes.body);
    assert.equal(readyBody.deletedRecipientsCount, 410);
    assert.equal(db.store.promotion_campaigns["camp-ready-410"], undefined);
    assert.equal(Object.keys(db.store.recipientsByCampaign["camp-ready-410"] || {}).length, 0);

    // Parent campaign doc MUST be deleted AFTER all recipient docs!
    const parentDeleteIdx = db.store.deleteOrder.indexOf("promotion_campaigns/camp-ready-410");
    const lastRecipientIdx = db.store.deleteOrder.reduce(
      (max, entry, idx) => (entry.startsWith("recipients/camp-ready-410/") ? idx : max),
      -1
    );
    assert.ok(parentDeleteIdx > lastRecipientIdx, "Parent campaign document must be deleted only after all recipient batches");

    // Verify preserved records untouched
    assert.ok(db.store.courses["c-preserve"]);
    assert.ok(db.store.promotion_suppressions["sup-1"]);
    assert.ok(db.store.promotion_campaigns["camp-completed-hist"]);
    assert.ok(db.store.recipientsByCampaign["camp-completed-hist"]["rec-done"]);
  });

  // 23. Blocked deletions: completed, unknown recipients, sending, stale-count paused with hidden sent/processing, and missing confirmation
  await runTest("23. Blocks deletion of completed, unknown-containing, sending, locked, and hidden-sent/processing campaigns", async () => {
    const db = createMockAdminDb({
      courses: { "c1": { title: "Course 1" } },
      campaigns: {
        "camp-completed": { id: "camp-completed", courseId: "c1", status: "completed", sentCount: 2, unknownCount: 0 },
        "camp-sending": { id: "camp-sending", courseId: "c1", status: "sending", sentCount: 0, unknownCount: 0 },
        "camp-paused-unknown": { id: "camp-paused-unknown", courseId: "c1", status: "paused", sentCount: 0, unknownCount: 1 },
        // Stale counters on parent doc (=0) while subcollection actually holds an unknown/sent/processing doc!
        "camp-stale-hidden-unknown": { id: "camp-stale-hidden-unknown", courseId: "c1", status: "paused", sentCount: 0, unknownCount: 0 },
        "camp-stale-hidden-processing": { id: "camp-stale-hidden-processing", courseId: "c1", status: "paused", sentCount: 0, unknownCount: 0 },
      },
      recipientsByCampaign: {
        "camp-completed": { "r1": { status: "sent" } },
        "camp-sending": { "r2": { status: "pending" } },
        "camp-paused-unknown": { "r3": { status: "unknown" }, "r4": { status: "pending" } },
        "camp-stale-hidden-unknown": { "r5": { status: "unknown" }, "r6": { status: "pending" } },
        "camp-stale-hidden-processing": { "r7": { status: "processing" }, "r8": { status: "pending" } },
      },
    });

    const deps = {
      db,
      verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
      verifyAdmin: async () => true,
      skipRateLimit: true,
    };

    // Missing adminConfirmed
    const noConfirmRes = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-admin" },
        body: JSON.stringify({ action: "delete_campaign", campaignId: "camp-completed", adminConfirmed: false }),
      },
      deps
    );
    assert.equal(noConfirmRes.statusCode, 400);
    assert.equal(JSON.parse(noConfirmRes.body).code, "CONFIRMATION_REQUIRED");

    for (const [cid, expectedCode] of [
      ["camp-completed", "CAMPAIGN_COMPLETED_PROTECTED"],
      ["camp-sending", "CAMPAIGN_SENDING"],
      ["camp-paused-unknown", "CAMPAIGN_HAS_UNKNOWN"],
      ["camp-stale-hidden-unknown", "CAMPAIGN_HAS_UNKNOWN"],
      ["camp-stale-hidden-processing", "CAMPAIGN_HAS_PROCESSING"],
    ] as const) {
      const blockedRes = await handlePromotionWithDeps(
        {
          httpMethod: "POST",
          path: "/api/send-course-promotion",
          headers: { authorization: "Bearer valid-admin" },
          body: JSON.stringify({ action: "delete_campaign", campaignId: cid, adminConfirmed: true }),
        },
        deps
      );
      assert.equal(blockedRes.statusCode, 409, `Expected 409 for ${cid}`);
      assert.equal(JSON.parse(blockedRes.body).code, expectedCode);
      assert.ok(db.store.promotion_campaigns[cid], `${cid} must remain intact`);
      // Lock must never remain stuck after blocking
      assert.equal(db.store.promotion_campaigns[cid].activeLockUntil || "", "");
    }
  });

  // 24. Non-admin / unauthenticated deletion attempts denied server-side
  await runTest("24. Non-admin and unauthenticated delete attempts are denied", async () => {
    const db = createMockAdminDb({
      campaigns: { "camp-draft": { id: "camp-draft", status: "draft", sentCount: 0, unknownCount: 0 } },
    });

    const noAuth = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: {},
        body: JSON.stringify({ action: "delete_campaign", campaignId: "camp-draft", adminConfirmed: true }),
      },
      { db, skipRateLimit: true }
    );
    assert.equal(noAuth.statusCode, 401);

    const nonAdmin = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer user-token" },
        body: JSON.stringify({ action: "delete_campaign", campaignId: "camp-draft", adminConfirmed: true }),
      },
      {
        db,
        verifyIdToken: async () => ({ uid: "user-99", email: "regular.user@bu.ac.th", email_verified: true }),
        verifyAdmin: async () => false,
        skipRateLimit: true,
      }
    );
    assert.equal(nonAdmin.statusCode, 403);
    assert.equal(JSON.parse(nonAdmin.body).code, "FORBIDDEN");
    assert.ok(db.store.promotion_campaigns["camp-draft"], "Campaign must not be deleted by non-admin");
  });

  // 25. Partial failure recovery: batch #2 fails after batch #1 deletes 380 recipients -> preserves parent, unlocks, recounts, allows retry
  await runTest("25. Partial batch delete failure preserves parent, releases lock, recalculates counts, and supports safe retry", async () => {
    const bulkRecipients: Record<string, any> = {};
    for (let i = 0; i < 410; i++) {
      bulkRecipients[`rec_${i}`] = { email: `staff${i}@bu.ac.th`, status: "pending", attempts: 0 };
    }

    const db = createMockAdminDb({
      campaigns: {
        "camp-partial": { id: "camp-partial", courseId: "c1", status: "ready", sentCount: 0, unknownCount: 0, totalRecipients: 410 },
      },
      recipientsByCampaign: { "camp-partial": bulkRecipients },
      failOnBatchCommitNumber: 2, // Commit #1 succeeds (380 deleted), Commit #2 fails (30 remain)
    });

    const deps = {
      db,
      verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
      verifyAdmin: async () => true,
      skipRateLimit: true,
    };

    const failRes = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer admin-token" },
        body: JSON.stringify({ action: "delete_campaign", campaignId: "camp-partial", adminConfirmed: true }),
      },
      deps
    );

    assert.equal(failRes.statusCode, 500);
    const failBody = JSON.parse(failRes.body);
    assert.equal(failBody.code, "DELETE_PARTIAL_FAILURE");
    assert.equal(failBody.partialFailure, true);
    assert.equal(failBody.deletedRecipientsCount, 380);
    assert.equal(failBody.remainingRecipientsCount, 30);
    assert.ok(db.store.promotion_campaigns["camp-partial"], "Parent doc must stay intact while remaining recipients exist");
    assert.equal(db.store.promotion_campaigns["camp-partial"].activeLockUntil, "");
    assert.equal(db.store.promotion_campaigns["camp-partial"].totalRecipients, 30);

    // Safe retry cleanup completes remaining 30 recipients + deletes parent doc
    const retryRes = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer admin-token" },
        body: JSON.stringify({ action: "delete_campaign", campaignId: "camp-partial", adminConfirmed: true }),
      },
      deps
    );
    assert.equal(retryRes.statusCode, 200);
    assert.equal(JSON.parse(retryRes.body).deletedRecipientsCount, 30);
    assert.equal(db.store.promotion_campaigns["camp-partial"], undefined);
  });

  // 26. Client deletePromotionCampaign wrapper surfaces partialFailure & blocked codes cleanly
  await runTest("26. Client deletePromotionCampaign wrapper enforces adminConfirmed and parses partial/blocked errors", async () => {
    const noConfirm = await deletePromotionCampaign({
      idToken: "token",
      campaignId: "c1",
      adminConfirmed: false,
    });
    assert.equal(noConfirm.ok, false);
    assert.equal(noConfirm.code, "CONFIRMATION_REQUIRED");

    const partialClientRes = await deletePromotionCampaign({
      idToken: "token",
      campaignId: "c1",
      adminConfirmed: true,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            status: "error",
            code: "DELETE_PARTIAL_FAILURE",
            partialFailure: true,
            deletedRecipientsCount: 380,
            remainingRecipientsCount: 30,
            message: "Partial delete error",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch,
    });
    assert.equal(partialClientRes.ok, false);
    assert.equal(partialClientRes.partialFailure, true);
    assert.equal(partialClientRes.deletedRecipientsCount, 380);
    assert.equal(partialClientRes.remainingRecipientsCount, 30);
  });

  // 27. Hardened firestore.rules guard delete operations on promotion_campaigns and recipients
  await runTest("27. firestore.rules restricts promotion campaign deletes to clean draft/ready/paused campaigns", () => {
    const rules = fs.readFileSync(path.join(ROOT_DIR, "firestore.rules"), "utf8");
    assert.ok(rules.includes("resource.data.status in ['draft', 'ready', 'paused']"));
    assert.ok(rules.includes("!(resource.data.status in ['sent', 'unknown', 'processing'])"));
  });

  // 28. Thai-to-English translation server happy path (mocked Gemini model — ZERO live API call)
  await runTest("28. Server translate endpoint translates Thai course description with mocked gemini-3.1-flash-lite & strips markdown fences", async () => {
    const mockDb = createMockAdminDb({});
    let capturedParams: any = null;
    const thaiSource = "อบรมเชิงปฏิบัติการเรื่อง Generative AI และ AI-Assisted Development สำหรับคณาจารย์\n\nเรียนรู้การสร้าง Functional Prototype โดยไม่ต้องเขียนโค้ด (No-Code/Low-Code) ด้วย AI API";
    const res = await handleTranslateWithDeps(
      {
        httpMethod: "POST",
        path: TRANSLATE_DESCRIPTION_ENDPOINT,
        headers: { authorization: "Bearer valid-admin-jwt" },
        body: JSON.stringify({
          courseId: "c-ai-2026",
          courseTitle: "Generative AI Workshop",
          sourceText: thaiSource,
          targetLanguage: "en",
        }),
      },
      {
        db: mockDb,
        verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
        verifyAdmin: async () => true,
        geminiApiKey: "mock-server-key-never-logged",
        skipRateLimit: true,
        generateContentFn: async (params) => {
          capturedParams = params;
          return {
            text: "```text\nThis hands-on workshop introduces faculty members to Generative AI and AI-Assisted Development.\n\nParticipants will learn to build a Functional Prototype using No-Code/Low-Code workflows and AI API integrations.\n```",
          };
        },
      }
    );

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, "success");
    assert.equal(body.model, DEFAULT_TRANSLATION_MODEL);
    assert.equal(DEFAULT_TRANSLATION_MODEL, "gemini-3.1-flash-lite");
    assert.equal(capturedParams.model, "gemini-3.1-flash-lite");
    assert.equal(body.sourceHash, computeDescriptionHash(thaiSource));
    assert.equal(body.sourceHash, computeDescriptionHashServer(thaiSource));
    assert.ok(!body.translatedText.includes("```"), "Markdown fences should be stripped cleanly");
    assert.ok(body.translatedText.includes("Generative AI"));
    assert.ok(body.translatedText.includes("No-Code/Low-Code"));
    assert.ok(body.translatedText.includes("\n\n"), "Paragraph structure should be preserved");
    assert.equal(containsThaiCharacters(body.translatedText), false);
    assert.ok(!res.body.includes("mock-server-key-never-logged"));
  });

  // 29. Translation endpoint security: unauthenticated (401), non-admin (403), invalid method (405), payload/markup guards
  await runTest("29. Translation endpoint blocks unauthenticated, non-admin, empty, oversized, and unsafe requests", async () => {
    const mockDb = createMockAdminDb({});

    const getRes = await handleTranslateWithDeps(
      { httpMethod: "GET", path: TRANSLATE_DESCRIPTION_ENDPOINT, headers: {}, body: null },
      { db: mockDb, skipRateLimit: true }
    );
    assert.equal(getRes.statusCode, 405);

    const noAuth = await handleTranslateWithDeps(
      {
        httpMethod: "POST",
        path: TRANSLATE_DESCRIPTION_ENDPOINT,
        headers: {},
        body: JSON.stringify({ sourceText: "รายละเอียดหลักสูตร", targetLanguage: "en" }),
      },
      { db: mockDb, skipRateLimit: true }
    );
    assert.equal(noAuth.statusCode, 401);

    const nonAdmin = await handleTranslateWithDeps(
      {
        httpMethod: "POST",
        path: TRANSLATE_DESCRIPTION_ENDPOINT,
        headers: { authorization: "Bearer regular-token" },
        body: JSON.stringify({ sourceText: "รายละเอียดหลักสูตร", targetLanguage: "en" }),
      },
      {
        db: mockDb,
        verifyIdToken: async () => ({ uid: "user-1", email: "teacher@bu.ac.th", email_verified: true }),
        verifyAdmin: async () => false,
        skipRateLimit: true,
      }
    );
    assert.equal(nonAdmin.statusCode, 403);
    assert.equal(JSON.parse(nonAdmin.body).code, "FORBIDDEN");

    const adminDeps = {
      db: mockDb,
      verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
      verifyAdmin: async () => true,
      geminiApiKey: "mock-key",
      skipRateLimit: true,
    };

    const emptyRes = await handleTranslateWithDeps(
      {
        httpMethod: "POST",
        path: TRANSLATE_DESCRIPTION_ENDPOINT,
        headers: { authorization: "Bearer admin-jwt" },
        body: JSON.stringify({ sourceText: "   \n  ", targetLanguage: "en" }),
      },
      adminDeps
    );
    assert.equal(emptyRes.statusCode, 400);
    assert.equal(JSON.parse(emptyRes.body).code, "EMPTY_SOURCE_TEXT");

    const oversizedRes = await handleTranslateWithDeps(
      {
        httpMethod: "POST",
        path: TRANSLATE_DESCRIPTION_ENDPOINT,
        headers: { authorization: "Bearer admin-jwt" },
        body: JSON.stringify({ sourceText: "ก".repeat(6500), targetLanguage: "en" }),
      },
      adminDeps
    );
    assert.equal(oversizedRes.statusCode, 400);
    assert.equal(JSON.parse(oversizedRes.body).code, "SOURCE_TEXT_TOO_LONG");

    const xssRes = await handleTranslateWithDeps(
      {
        httpMethod: "POST",
        path: TRANSLATE_DESCRIPTION_ENDPOINT,
        headers: { authorization: "Bearer admin-jwt" },
        body: JSON.stringify({ sourceText: "รายละเอียด <script>alert(1)</script>", targetLanguage: "en" }),
      },
      adminDeps
    );
    assert.equal(xssRes.statusCode, 400);
    assert.equal(JSON.parse(xssRes.body).code, "UNSAFE_CONTENT");
  });

  // 30. Already-English description skips AI calls cleanly on both client and server
  await runTest("30. Non-Thai/already-English course description skips unnecessary AI calls", async () => {
    const mockDb = createMockAdminDb({});
    let aiCalled = false;
    const enSource = "Hands-on workshop covering active learning and curriculum design.";

    const serverRes = await handleTranslateWithDeps(
      {
        httpMethod: "POST",
        path: TRANSLATE_DESCRIPTION_ENDPOINT,
        headers: { authorization: "Bearer admin-jwt" },
        body: JSON.stringify({ sourceText: enSource, targetLanguage: "en" }),
      },
      {
        db: mockDb,
        verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
        verifyAdmin: async () => true,
        skipRateLimit: true,
        generateContentFn: async () => {
          aiCalled = true;
          return { text: "Should not run" };
        },
      }
    );
    assert.equal(serverRes.statusCode, 200);
    assert.equal(aiCalled, false);
    assert.equal(JSON.parse(serverRes.body).model, "passthrough-non-thai");

    const clientDecision = evaluateEnglishAutoTranslation({
      language: "en",
      courseId: "c-en",
      courseDescription: enSource,
    });
    assert.equal(clientDecision.action, "noop");
    assert.equal(clientDecision.reason, "source_already_non_thai");
  });

  // 31. Cache hit, stale source detection, and no silent overwrite of manual English edits across TH <-> EN switches
  await runTest("31. Caching avoids repeat AI calls, flags source changes stale, and preserves manual EN & TH edits independently", () => {
    const thaiDescV1 = "อบรมพัฒนาทักษะการสอนสำหรับอาจารย์ใหม่";
    const thaiDescV2 = "อบรมพัฒนาทักษะการสอนและวิจัยสำหรับอาจารย์ใหม่ (ปรับปรุงเนื้อหา)";
    const hashV1 = computeDescriptionHash(thaiDescV1);

    // 1. Default EN template must NEVER silently copy raw Thai description
    const initialEn = getDefaultPromotionTemplate({ id: "c1", title: "Faculty Training", description: thaiDescV1 }, "en");
    assert.equal(initialEn.customDescription, "", "getDefaultPromotionTemplate('en') must not copy raw Thai course.description");
    const initialTh = getDefaultPromotionTemplate({ id: "c1", title: "อบรมอาจารย์ใหม่", description: thaiDescV1 }, "th");
    assert.equal(initialTh.customDescription, thaiDescV1);

    // 2. Cache miss -> needs translation
    const missDecision = evaluateEnglishAutoTranslation({
      language: "en",
      courseId: "c1",
      courseDescription: thaiDescV1,
    });
    assert.equal(missDecision.action, "translate");

    // 3. Cache hit -> reuse cached translation cleanly without calling AI again
    const cachedEntry = {
      courseId: "c1",
      sourceHash: hashV1,
      targetLanguage: "en" as const,
      translatedText: "Teaching skill development workshop for new faculty members.",
      editedByAdmin: true,
      translatedAt: "2026-06-10T00:00:00.000Z",
      model: "gemini-3.1-flash-lite",
    };
    const hitDecision = evaluateEnglishAutoTranslation({
      language: "en",
      courseId: "c1",
      courseDescription: thaiDescV1,
      cacheEntry: cachedEntry,
    });
    assert.equal(hitDecision.action, "reuse_cache");
    assert.equal(hitDecision.reuseText, cachedEntry.translatedText);
    assert.equal(isCachedTranslationStale(cachedEntry, thaiDescV1), false);

    // 4. Source Thai description changed later -> detects hash mismatch, marks stale, preserves manually edited EN text
    assert.equal(isCachedTranslationStale(cachedEntry, thaiDescV2), true);
    const staleDecision = evaluateEnglishAutoTranslation({
      language: "en",
      courseId: "c1",
      courseDescription: thaiDescV2,
      currentDraft: {
        ...initialEn,
        customDescription: "Custom Admin EN overview.",
        translationMeta: { sourceHash: hashV1, editedByAdmin: true },
      },
      cacheEntry: cachedEntry,
    });
    assert.equal(staleDecision.action, "stale_warning");
    assert.equal(staleDecision.isStale, true);
    assert.notEqual(buildTranslationCacheKey("c1", hashV1, "en"), buildTranslationCacheKey("c1", computeDescriptionHash(thaiDescV2), "en"));
  });

  // 32. Async race-condition protection: slow response ignored on course switch, language switch back to TH, or manual edit
  await runTest("32. Stale async translation responses are ignored if user changed language, course, source, or typed manually", () => {
    const baseEn = getDefaultPromotionTemplate({ id: "c1", title: "Course 1", description: "รายละเอียด A" }, "en");
    const hashA = computeDescriptionHash("รายละเอียด A");

    // Superseded request sequence
    assert.equal(
      applyAsyncTranslationResultIfEligible({
        requestSeq: 1,
        latestRequestSeq: 2,
        requestCourseId: "c1",
        activeCourseId: "c1",
        activeLanguage: "en",
        requestSourceHash: hashA,
        currentCourseDescription: "รายละเอียด A",
        currentTemplate: baseEn,
        manualEditEpochAtStart: 0,
        currentManualEditEpoch: 0,
        translatedText: "Old AI translation",
      }).applied,
      false
    );

    // Switched back to Thai while EN request was in flight
    assert.equal(
      applyAsyncTranslationResultIfEligible({
        requestSeq: 2,
        latestRequestSeq: 2,
        requestCourseId: "c1",
        activeCourseId: "c1",
        activeLanguage: "th",
        requestSourceHash: hashA,
        currentCourseDescription: "รายละเอียด A",
        currentTemplate: baseEn,
        manualEditEpochAtStart: 0,
        currentManualEditEpoch: 0,
        translatedText: "Should not overwrite TH",
      }).applied,
      false
    );

    // Admin started typing manually while AI request was in flight
    assert.equal(
      applyAsyncTranslationResultIfEligible({
        requestSeq: 2,
        latestRequestSeq: 2,
        requestCourseId: "c1",
        activeCourseId: "c1",
        activeLanguage: "en",
        requestSourceHash: hashA,
        currentCourseDescription: "รายละเอียด A",
        currentTemplate: baseEn,
        manualEditEpochAtStart: 0,
        currentManualEditEpoch: 1,
        translatedText: "AI overwriting manual edit",
      }).applied,
      false
    );

    // Current valid request applies cleanly
    const okMerge = applyAsyncTranslationResultIfEligible({
      requestSeq: 2,
      latestRequestSeq: 2,
      requestCourseId: "c1",
      activeCourseId: "c1",
      activeLanguage: "en",
      requestSourceHash: hashA,
      currentCourseDescription: "รายละเอียด A",
      currentTemplate: baseEn,
      manualEditEpochAtStart: 0,
      currentManualEditEpoch: 0,
      translatedText: "Fresh academic English translation.",
      model: "gemini-3.1-flash-lite",
    });
    assert.equal(okMerge.applied, true);
    assert.equal(okMerge.template?.customDescription, "Fresh academic English translation.");
    assert.equal(okMerge.template?.translationMeta?.editedByAdmin, false);
  });

  // 33. Graceful AI error handling: missing key (503), timeout (504), quota 429, residual Thai (502), client fallback
  await runTest("33. AI failure/timeout/quota/missing-key returns structured errors without fake translation or key leakage", async () => {
    const mockDb = createMockAdminDb({});
    const baseAdminDeps = {
      db: mockDb,
      verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
      verifyAdmin: async () => true,
      skipRateLimit: true,
    };
    const validEvent = {
      httpMethod: "POST",
      path: TRANSLATE_DESCRIPTION_ENDPOINT,
      headers: { authorization: "Bearer admin-jwt" },
      body: JSON.stringify({ sourceText: "รายละเอียดหลักสูตรภาษาไทย", targetLanguage: "en" }),
    };

    // Missing GEMINI_API_KEY
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const noKeyRes = await handleTranslateWithDeps(validEvent, { ...baseAdminDeps, geminiApiKey: "" });
      assert.equal(noKeyRes.statusCode, 503);
      assert.equal(JSON.parse(noKeyRes.body).code, "AI_TRANSLATION_UNCONFIGURED");
    } finally {
      if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    }

    // Timeout
    const timeoutRes = await handleTranslateWithDeps(validEvent, {
      ...baseAdminDeps,
      geminiApiKey: "secret-key",
      timeoutMs: 25,
      generateContentFn: async () => new Promise((resolve) => setTimeout(() => resolve({ text: "Too late" }), 120)),
    });
    assert.equal(timeoutRes.statusCode, 504);
    assert.equal(JSON.parse(timeoutRes.body).code, "AI_TIMEOUT");

    // 429 Quota exhausted
    const quotaRes = await handleTranslateWithDeps(validEvent, {
      ...baseAdminDeps,
      geminiApiKey: "secret-key",
      generateContentFn: async () => {
        const err: any = new Error("429 RESOURCE_EXHAUSTED quota exceeded");
        err.status = 429;
        throw err;
      },
    });
    assert.equal(quotaRes.statusCode, 429);
    assert.equal(JSON.parse(quotaRes.body).code, "AI_QUOTA_EXHAUSTED");

    // Incomplete translation (still contains Thai)
    const partialThaiRes = await handleTranslateWithDeps(validEvent, {
      ...baseAdminDeps,
      geminiApiKey: "secret-key",
      generateContentFn: async () => ({ text: "This workshop covers อบรมพัฒนาอาจารย์" }),
    });
    assert.equal(partialThaiRes.statusCode, 502);
    assert.equal(JSON.parse(partialThaiRes.body).code, "AI_INCOMPLETE_TRANSLATION");

    // Client wrapper handles server error cleanly without throwing
    const clientErr = await translateCourseDescription({
      idToken: "secret-jwt-token",
      courseId: "c1",
      sourceText: "รายละเอียด",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ status: "error", code: "AI_TRANSLATION_UNCONFIGURED", message: "Missing key" }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch,
    });
    assert.equal(clientErr.ok, false);
    assert.equal(clientErr.code, "AI_TRANSLATION_UNCONFIGURED");
    assert.ok(!JSON.stringify(clientErr).includes("secret-jwt-token"));
  });

  // 34. EN Preview HTML, Plain-Text fallback, send_test, and dispatch_batch use EN customDescription & never substitute Thai course.description
  await runTest("34. Client Preview, Plain-Text, send_test, and dispatch_batch render approved EN description cleanly", async () => {
    const thaiCourse = {
      id: "c-bilingual",
      title: "AI-Assisted Teaching Innovation",
      language: "th" as const,
      date: "2026-08-10",
      startTime: "09:00",
      endTime: "12:00",
      locationDetail: "Room A3-301",
      instructorName: "Dr. Somchai",
      description: "คำอธิบายภาษาไทยที่ไม่ควรโผล่ในอีเมลภาษาอังกฤษ",
    };

    const enTemplate = {
      ...getDefaultPromotionTemplate(thaiCourse, "en"),
      customDescription: "Translated academic English course overview covering AI-Assisted Teaching.",
    };

    const preview = renderPromotionEmail({
      course: thaiCourse,
      template: enTemplate,
      registrationUrl: "https://butraining.netlify.app/",
      recipientName: "Dr. Jane",
    });
    assert.ok(preview.htmlBody.includes("Translated academic English course overview"));
    assert.ok(preview.textBody.includes("Translated academic English course overview"));
    assert.ok(!preview.htmlBody.includes("คำอธิบายภาษาไทยที่ไม่ควรโผล่"));
    assert.ok(!preview.textBody.includes("คำอธิบายภาษาไทยที่ไม่ควรโผล่"));
    assert.ok(preview.htmlBody.includes('<tr><td align="left" style="text-align:left;">'), "Preserve left alignment");
    assert.ok(preview.htmlBody.includes('href="https://butraining.netlify.app/"'), "Preserve exact registration URL");

    // Verify omission of customDescription in EN NEVER falls back to Thai course.description
    const omittedCustomDescRendered = renderPromotionEmail({
      course: thaiCourse,
      template: { ...enTemplate, customDescription: undefined },
      registrationUrl: "https://butraining.netlify.app/",
    });
    assert.ok(!omittedCustomDescRendered.htmlBody.includes("คำอธิบายภาษาไทย"));
    assert.ok(!omittedCustomDescRendered.textBody.includes("คำอธิบายภาษาไทย"));

    // Verify send_test & dispatch_batch render EN customDescription identically
    const db = createMockAdminDb({
      courses: { "c-bilingual": thaiCourse },
      campaigns: {
        "camp-bilingual-en": {
          id: "camp-bilingual-en",
          courseId: "c-bilingual",
          language: "en",
          registrationUrl: "https://butraining.netlify.app/",
          posterMode: "none",
          template: enTemplate,
          activeLockUntil: "",
        },
      },
      recipientsByCampaign: {
        "camp-bilingual-en": {
          "rec-1": { email: "prof@bu.ac.th", name: "Dr. Jane", status: "pending", attempts: 0 },
        },
      },
    });

    const capturedEmails: Array<{ htmlBody: string; textBody: string }> = [];
    const deps = {
      db,
      verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
      verifyAdmin: async () => true,
      gasUrl: "https://script.google.com/macros/s/mock/exec",
      gasSecret: "mock-secret",
      skipRateLimit: true,
      fetchFn: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const p = JSON.parse(String(init?.body || "{}"));
        capturedEmails.push({ htmlBody: p.messages[0].htmlBody, textBody: p.messages[0].textBody });
        return new Response(
          JSON.stringify({
            status: "success",
            remainingDailyQuota: 90,
            results: [{ recipientId: p.messages[0].recipientId, status: "sent" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch,
    };

    const testRes = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({
          action: "send_test",
          courseId: "c-bilingual",
          testEmail: "kulachet.l@bu.ac.th",
          language: "en",
          registrationUrl: "https://butraining.netlify.app/",
          template: enTemplate,
          poster: { mode: "none" },
        }),
      },
      deps
    );
    assert.equal(testRes.statusCode, 200);

    const dispatchRes = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({ action: "dispatch_batch", campaignId: "camp-bilingual-en" }),
      },
      deps
    );
    assert.equal(dispatchRes.statusCode, 200);
    assert.equal(capturedEmails.length, 2);
    for (const em of capturedEmails) {
      assert.ok(em.htmlBody.includes("Translated academic English course overview"));
      assert.ok(em.textBody.includes("Translated academic English course overview"));
      assert.ok(!em.htmlBody.includes("คำอธิบายภาษาไทย"));
      assert.ok(!em.textBody.includes("คำอธิบายภาษาไทย"));
    }
  });

  // 35. Untranslated Thai text in EN mode blocks client guard, server send_test, and server dispatch_batch BEFORE claiming
  await runTest("35. Untranslated Thai text in EN Course Overview blocks Test Email and Real Dispatch cleanly", async () => {
    const thaiCourse = {
      id: "c-th-leak",
      title: "English Title",
      description: "รายละเอียดหลักสูตรภาษาไทย",
    };

    const untranslatedEnTemplate = {
      ...getDefaultPromotionTemplate(thaiCourse, "en"),
      customDescription: "รายละเอียดหลักสูตรภาษาไทยที่ยังไม่ได้แปล",
    };

    const guard = resolveEnglishDescriptionGuard({
      language: "en",
      includeDescription: true,
      customDescription: untranslatedEnTemplate.customDescription,
      courseDescription: thaiCourse.description,
    });
    assert.equal(guard.blocked, true);
    assert.equal(guard.code, "UNTRANSLATED_ENGLISH_DESCRIPTION");

    // Disabled includeDescription -> allowed cleanly
    assert.equal(
      resolveEnglishDescriptionGuard({
        language: "en",
        includeDescription: false,
        customDescription: untranslatedEnTemplate.customDescription,
        courseDescription: thaiCourse.description,
      }).blocked,
      false
    );

    const db = createMockAdminDb({
      courses: { "c-th-leak": thaiCourse },
      campaigns: {
        "camp-leak": {
          id: "camp-leak",
          courseId: "c-th-leak",
          language: "en",
          registrationUrl: "https://butraining.netlify.app/",
          posterMode: "none",
          template: untranslatedEnTemplate,
          activeLockUntil: "",
        },
      },
      recipientsByCampaign: {
        "camp-leak": {
          "rec-1": { email: "faculty@bu.ac.th", name: "Dr. Test", status: "pending", attempts: 0 },
        },
      },
    });

    let gasCalled = false;
    const deps = {
      db,
      verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
      verifyAdmin: async () => true,
      gasUrl: "https://script.google.com/macros/s/mock/exec",
      gasSecret: "mock-secret",
      skipRateLimit: true,
      fetchFn: (async () => {
        gasCalled = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    };

    const blockedTest = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({
          action: "send_test",
          courseId: "c-th-leak",
          testEmail: "kulachet.l@bu.ac.th",
          language: "en",
          registrationUrl: "https://butraining.netlify.app/",
          template: untranslatedEnTemplate,
          poster: { mode: "none" },
        }),
      },
      deps
    );
    assert.equal(blockedTest.statusCode, 400);
    assert.equal(JSON.parse(blockedTest.body).code, "UNTRANSLATED_ENGLISH_DESCRIPTION");

    const blockedDispatch = await handlePromotionWithDeps(
      {
        httpMethod: "POST",
        path: "/api/send-course-promotion",
        headers: { authorization: "Bearer valid-token" },
        body: JSON.stringify({ action: "dispatch_batch", campaignId: "camp-leak" }),
      },
      deps
    );
    assert.equal(blockedDispatch.statusCode, 400);
    assert.equal(JSON.parse(blockedDispatch.body).code, "UNTRANSLATED_ENGLISH_DESCRIPTION");
    assert.equal(gasCalled, false);
    assert.equal(db.store.recipientsByCampaign["camp-leak"]["rec-1"].status, "pending", "Recipient must remain pending when dispatch blocked pre-claim");
  });

  // 36. Security & architecture check: GEMINI_API_KEY and @google/genai stay strictly server-side, metadata capability configured
  await runTest("36. Client src/ never imports @google/genai or exposes GEMINI_API_KEY, and metadata.json declares capability", () => {
    const metadataRaw = fs.readFileSync(path.join(ROOT_DIR, "metadata.json"), "utf8");
    const metadataJson = JSON.parse(metadataRaw);
    assert.ok(
      Array.isArray(metadataJson.majorCapabilities) &&
        metadataJson.majorCapabilities.includes("MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"),
      "metadata.json must declare MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"
    );

    const walkFiles = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) files.push(...walkFiles(full));
        else if (/\.(ts|tsx|js|jsx)$/i.test(e.name)) files.push(full);
      }
      return files;
    };

    const srcFiles = walkFiles(path.join(ROOT_DIR, "src"));
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, "utf8");
      assert.ok(!content.includes("@google/genai"), `Frontend file must never import @google/genai: ${file}`);
      assert.ok(!content.includes("GEMINI_API_KEY"), `Frontend file must never reference GEMINI_API_KEY: ${file}`);
      assert.ok(!content.includes("VITE_GEMINI"), `Frontend file must never use VITE_GEMINI*: ${file}`);
    }

    const fnCode = fs.readFileSync(path.join(ROOT_DIR, "netlify/functions/translate-course-description.ts"), "utf8");
    assert.ok(fnCode.includes("gemini-3.1-flash-lite"), "Server translation must default to gemini-3.1-flash-lite");
    assert.ok(fnCode.includes("GEMINI_TRANSLATION_MODEL"), "Server translation must support GEMINI_TRANSLATION_MODEL env var");
    assert.ok(!fnCode.includes("gemini-1.5"), "Server must not use deprecated gemini-1.5 models");
    assert.ok(!fnCode.includes("gemini-2.0"), "Server must not use deprecated gemini-2.0 models");
  });

  // 37. Error classification distinguishes HTTP 403 permissions vs HTTP 401/API_KEY_INVALID vs 404 model-not-found vs 429 quota
  await runTest("37. Distinguishes 403 project permission & key restrictions from actual API key invalid, model not found, and quota errors", async () => {
    const mockDb = createMockAdminDb({});
    const loggedEntries: Array<{ prefix: string; payload: any }> = [];
    const baseDeps = {
      db: mockDb,
      verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
      verifyAdmin: async () => true,
      geminiApiKey: "AIzaSySecretKeyNeverAppearInLogs12345",
      skipRateLimit: true,
      logErrorFn: (prefix: string, jsonStr: string) => {
        loggedEntries.push({ prefix, payload: JSON.parse(jsonStr) });
      },
    };
    const validEvent = {
      httpMethod: "POST",
      path: TRANSLATE_DESCRIPTION_ENDPOINT,
      headers: { authorization: "Bearer firebase-secret-jwt-token" },
      body: JSON.stringify({ sourceText: "รายละเอียดหลักสูตรสำหรับทดสอบข้อผิดพลาด", targetLanguage: "en" }),
    };

    // Case A: HTTP 403 Generative Language API disabled / project permission -> MUST NOT return AI_KEY_INVALID!
    const permErrRes = await handleTranslateWithDeps(validEvent, {
      ...baseDeps,
      generateContentFn: async () => {
        const err: any = new Error(
          JSON.stringify({
            error: {
              code: 403,
              message: "Generative Language API has not been used in project 12345 or it is disabled.",
              status: "PERMISSION_DENIED",
              details: [{ reason: "SERVICE_DISABLED" }],
            },
          })
        );
        err.status = 403;
        throw err;
      },
    });
    assert.equal(permErrRes.statusCode, 503);
    const permBody = JSON.parse(permErrRes.body);
    assert.equal(permBody.code, "AI_PERMISSION_DENIED", "HTTP 403 SERVICE_DISABLED must NOT claim AI_KEY_INVALID");
    assert.equal(permBody.category, "project_permission_error");

    // Case B: HTTP 403 HTTP referrer restriction -> MUST NOT return AI_KEY_INVALID!
    const refErrRes = await handleTranslateWithDeps(validEvent, {
      ...baseDeps,
      generateContentFn: async () => {
        const err: any = new Error(
          JSON.stringify({
            error: {
              code: 403,
              message: "Requests from referer <empty> are blocked.",
              status: "PERMISSION_DENIED",
              details: [{ reason: "API_KEY_HTTP_REFERRER_BLOCKED" }],
            },
          })
        );
        err.status = 403;
        throw err;
      },
    });
    assert.equal(refErrRes.statusCode, 503);
    assert.equal(JSON.parse(refErrRes.body).code, "AI_PERMISSION_DENIED");
    assert.equal(JSON.parse(refErrRes.body).category, "api_restriction_error");

    // Case C: Bare HTTP 403 without API_KEY_INVALID reason -> still AI_PERMISSION_DENIED
    const bare403 = classifyGeminiApiError({ status: 403, message: "Forbidden" }, "gemini-3.1-flash-lite");
    assert.equal(bare403.responseCode, "AI_PERMISSION_DENIED");
    assert.equal(bare403.category, "project_permission_error");

    // Case D: HTTP 400/401 explicit API_KEY_INVALID -> AI_KEY_INVALID
    const badKeyRes = await handleTranslateWithDeps(validEvent, {
      ...baseDeps,
      generateContentFn: async () => {
        const err: any = new Error(
          JSON.stringify({
            error: {
              code: 400,
              message: "API key not valid. Please pass a valid API key. ?key=AIzaSySecretKeyNeverAppearInLogs12345",
              status: "INVALID_ARGUMENT",
              details: [{ reason: "API_KEY_INVALID" }],
            },
          })
        );
        err.status = 400;
        throw err;
      },
    });
    assert.equal(badKeyRes.statusCode, 503);
    assert.equal(JSON.parse(badKeyRes.body).code, "AI_KEY_INVALID");
    assert.equal(JSON.parse(badKeyRes.body).category, "api_key_authentication");

    // Case E: HTTP 404 model not found -> AI_MODEL_NOT_FOUND
    const modelMissingRes = await handleTranslateWithDeps(validEvent, {
      ...baseDeps,
      translationModel: "gemini-nonexistent-test",
      generateContentFn: async () => {
        const err: any = new Error(
          JSON.stringify({
            error: {
              code: 404,
              message: "models/gemini-nonexistent-test is not found for API version v1beta",
              status: "NOT_FOUND",
            },
          })
        );
        err.status = 404;
        throw err;
      },
    });
    assert.equal(modelMissingRes.statusCode, 502);
    const modelMissingBody = JSON.parse(modelMissingRes.body);
    assert.equal(modelMissingBody.code, "AI_MODEL_NOT_FOUND");
    assert.equal(modelMissingBody.category, "model_not_found");
    assert.equal(modelMissingBody.model, "gemini-nonexistent-test");

    // Verify safe diagnostics logs recorded upstreamHttpStatus, errorCategory, modelId and NEVER exposed keys/tokens
    assert.equal(loggedEntries.length, 4);
    assert.equal(loggedEntries[0].payload.upstreamHttpStatus, 403);
    assert.equal(loggedEntries[0].payload.errorCategory, "project_permission_error");
    assert.equal(loggedEntries[0].payload.modelId, "gemini-3.1-flash-lite");
    assert.equal(loggedEntries[3].payload.upstreamHttpStatus, 404);
    assert.equal(loggedEntries[3].payload.modelId, "gemini-nonexistent-test");
    const serializedLogs = JSON.stringify(loggedEntries);
    assert.ok(!serializedLogs.includes("AIzaSySecretKeyNeverAppearInLogs12345"), "API key must never appear in logs");
    assert.ok(!serializedLogs.includes("firebase-secret-jwt-token"), "Firebase token must never appear in logs");
  });

  // 38. Server-side GEMINI_TRANSLATION_MODEL env var configuration & validation
  await runTest("38. Reads server-side GEMINI_TRANSLATION_MODEL env var, strips models/ prefix, and rejects invalid model strings", async () => {
    const prevModelEnv = process.env.GEMINI_TRANSLATION_MODEL;
    try {
      delete process.env.GEMINI_TRANSLATION_MODEL;
      assert.deepEqual(resolveTranslationModel(), {
        valid: true,
        model: "gemini-3.1-flash-lite",
        source: "default",
      });

      process.env.GEMINI_TRANSLATION_MODEL = "models/gemini-2.5-flash-lite";
      assert.deepEqual(resolveTranslationModel(), {
        valid: true,
        model: "gemini-2.5-flash-lite",
        source: "env",
      });

      let usedModel = "";
      const mockDb = createMockAdminDb({});
      const okRes = await handleTranslateWithDeps(
        {
          httpMethod: "POST",
          path: TRANSLATE_DESCRIPTION_ENDPOINT,
          headers: { authorization: "Bearer valid-admin-jwt" },
          body: JSON.stringify({ sourceText: "รายละเอียดหลักสูตร", targetLanguage: "en" }),
        },
        {
          db: mockDb,
          verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
          verifyAdmin: async () => true,
          geminiApiKey: "mock-key",
          skipRateLimit: true,
          generateContentFn: async (p) => {
            usedModel = p.model;
            return { text: "Course overview in English." };
          },
        }
      );
      assert.equal(okRes.statusCode, 200);
      assert.equal(usedModel, "gemini-2.5-flash-lite");
      assert.equal(JSON.parse(okRes.body).model, "gemini-2.5-flash-lite");

      process.env.GEMINI_TRANSLATION_MODEL = "bad model/with spaces";
      const badModelRes = await handleTranslateWithDeps(
        {
          httpMethod: "POST",
          path: TRANSLATE_DESCRIPTION_ENDPOINT,
          headers: { authorization: "Bearer valid-admin-jwt" },
          body: JSON.stringify({ sourceText: "รายละเอียดหลักสูตร", targetLanguage: "en" }),
        },
        {
          db: mockDb,
          verifyIdToken: async () => ({ uid: "admin-1", email: "kulachet.l@bu.ac.th", email_verified: true }),
          verifyAdmin: async () => true,
          geminiApiKey: "mock-key",
          skipRateLimit: true,
          logErrorFn: () => {},
        }
      );
      assert.equal(badModelRes.statusCode, 503);
      assert.equal(JSON.parse(badModelRes.body).code, "AI_MODEL_CONFIG_INVALID");
    } finally {
      if (prevModelEnv !== undefined) process.env.GEMINI_TRANSLATION_MODEL = prevModelEnv;
      else delete process.env.GEMINI_TRANSLATION_MODEL;
    }
  });

  console.log(`\n=== All ${passed} Module 22 Offline Tests Passed ===`);
}

main();
