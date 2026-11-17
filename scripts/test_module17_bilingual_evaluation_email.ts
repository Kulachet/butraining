import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildEvaluationEmailPayload,
  renderEvaluationEmailContent,
  resolveEvaluationRecipientName,
  EVALUATION_PROMPT_TH,
  EVALUATION_PROMPT_EN,
} from "../src/lib/evaluationEmail";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  FAIL  ${name}\n        ${err?.message || err}`);
    failed++;
  }
}

const PUBLISHED_URL = "https://butraining.netlify.app";

console.log("\n=== MODULE 17: Bilingual Evaluation Invitation Email Test Suite ===\n");

test("1. Thai course (language='th') produces Thai email subject, body, and valid link", () => {
  const payload = buildEvaluationEmailPayload({
    baseUrl: PUBLISHED_URL,
    course: { id: "c_th_01", title: "การพัฒนาการสอนเชิงรุก", language: "th" },
    recipients: [{ email: "somchai@bu.ac.th", name: "อ.สมชาย ใจดี" }],
  });

  assert.equal(payload.action, "send_evaluations");
  assert.equal(payload.language, "th");
  assert.equal(payload.courseId, "c_th_01");
  assert.equal(payload.emailSubject, "[BU Training] ขอความอนุเคราะห์ทำแบบประเมิน: การพัฒนาการสอนเชิงรุก");
  assert.ok(payload.evalLink.startsWith("https://butraining.netlify.app/#/evaluate/c_th_01?title="));
  assert.ok(payload.emailBody.includes("เรียน อ.สมชาย ใจดี"));
  assert.ok(payload.emailBody.includes(EVALUATION_PROMPT_TH));
  assert.ok(payload.emailHtmlBody.includes("เริ่มทำแบบประเมินผล"));
  assert.equal(payload.senderName, "สำนักพัฒนาการเรียนรู้");
});

test("2. English course (language='en') produces exact Module 17 English template & fallback greeting", () => {
  const payload = buildEvaluationEmailPayload({
    baseUrl: PUBLISHED_URL,
    course: { id: "c_en_01", title: "AI-Assisted Assessment", language: "en" },
    recipients: [{ email: "russell@bu.ac.th", name: "Dr. Russell Tagalog Rodrigo" }],
  });

  assert.equal(payload.action, "send_evaluations");
  assert.equal(payload.language, "en");
  assert.equal(payload.courseId, "c_en_01");
  assert.equal(payload.emailSubject, "[BU Training] Training Evaluation Request: AI-Assisted Assessment");
  assert.ok(payload.evalLink.startsWith("https://butraining.netlify.app/#/evaluate/c_en_01?title="));
  assert.ok(payload.emailBody.includes("Dear Dr. Russell Tagalog Rodrigo,"));
  assert.ok(payload.emailBody.includes('Thank you for attending "AI-Assisted Assessment".'));
  assert.ok(payload.emailBody.includes("Your feedback is valuable in helping us improve the quality of our future training programs."));
  assert.ok(payload.emailBody.includes(EVALUATION_PROMPT_EN));
  assert.ok(payload.emailBody.includes("If the button does not work, please copy and paste the following link into your browser:"));
  assert.ok(payload.emailBody.includes("Thank you for your time and valuable feedback."));
  assert.ok(payload.emailBody.includes("Learning Development Office (LDO)"));
  assert.ok(payload.emailBody.includes("Bangkok University"));

  assert.ok(payload.emailHtmlBody.includes("Training Evaluation"));
  assert.ok(payload.emailHtmlBody.includes(">Complete Evaluation</a>"));
  assert.ok(payload.emailHtmlBody.includes(payload.evalLink));
  assert.equal(payload.senderName, "Learning Development Office");

  // Missing recipient name -> "Dear Participant,"
  const fallbackRendered = renderEvaluationEmailContent({
    language: "en",
    courseTitle: "AI-Assisted Assessment",
    evalLink: payload.evalLink,
    recipientName: "",
  });
  assert.ok(fallbackRendered.body.includes("Dear Participant,"));
  assert.ok(fallbackRendered.htmlBody.includes("Dear <b>Participant</b>,"));
});

test("3. Undefined or invalid course.language defaults safely to Thai email", () => {
  const missingLang = buildEvaluationEmailPayload({
    baseUrl: PUBLISHED_URL,
    course: { id: "c_legacy_01", title: "Legacy Workshop" },
    recipients: [{ email: "staff@bu.ac.th", name: "คุณวิชัย" }],
  });
  assert.equal(missingLang.language, "th");
  assert.ok(missingLang.emailSubject.startsWith("[BU Training] ขอความอนุเคราะห์ทำแบบประเมิน:"));

  const invalidLang = buildEvaluationEmailPayload({
    baseUrl: PUBLISHED_URL,
    course: { id: "c_legacy_02", title: "English Title But Invalid Lang", language: "fr" as any },
    recipients: [{ email: "staff@bu.ac.th", name: "คุณวิชัย" }],
  });
  assert.equal(invalidLang.language, "th");
});

test("4. Language follows course.language strictly (never course title or admin UI locale)", () => {
  // Thai course with English title -> still Thai
  const thaiCourseWithEnTitle = buildEvaluationEmailPayload({
    baseUrl: PUBLISHED_URL,
    course: { id: "c_mixed_1", title: "Design Thinking Masterclass", language: "th" },
    recipients: [{ email: "suda@bu.ac.th", name: "อ.สุดา" }],
  });
  assert.equal(thaiCourseWithEnTitle.language, "th");
  assert.ok(thaiCourseWithEnTitle.emailBody.includes(EVALUATION_PROMPT_TH));

  // English course with Thai title -> still English
  const enCourseWithThaiTitle = buildEvaluationEmailPayload({
    baseUrl: PUBLISHED_URL,
    course: { id: "c_mixed_2", title: "การอบรมพิเศษ", language: "en" },
    recipients: [{ email: "john@bu.ac.th", name: "Dr. John Smith" }],
  });
  assert.equal(enCourseWithThaiTitle.language, "en");
  assert.ok(enCourseWithThaiTitle.emailBody.includes(EVALUATION_PROMPT_EN));

  // Verify RegistrantsList does NOT import or useLanguage for email language selection
  const root = path.resolve(import.meta.dirname || process.cwd(), "..");
  const registrantsSrc = fs.readFileSync(path.join(root, "src/components/RegistrantsList.tsx"), "utf8");
  assert.equal(registrantsSrc.includes("useLanguage"), false);
  assert.ok(registrantsSrc.includes("resolveCourseLang(selectedCourse)"));
});

test("5. Evaluation links and Module 16 preview URL protection remain intact", () => {
  const th = buildEvaluationEmailPayload({
    baseUrl: PUBLISHED_URL,
    course: { id: "course_abc", title: "Workshop", language: "th" },
    recipients: [{ email: "a@bu.ac.th", name: "A" }],
  });
  const en = buildEvaluationEmailPayload({
    baseUrl: PUBLISHED_URL,
    course: { id: "course_abc", title: "Workshop", language: "en" },
    recipients: [{ email: "a@bu.ac.th", name: "A" }],
  });
  assert.equal(th.evalLink, "https://butraining.netlify.app/#/evaluate/course_abc?title=Workshop");
  assert.equal(en.evalLink, th.evalLink);

  assert.throws(() =>
    buildEvaluationEmailPayload({
      baseUrl: "https://ais-pre-sly2upsojdu5nc47xldytg-166049909817.asia-east1.run.app",
      course: { id: "course_abc", title: "Workshop", language: "en" },
      recipients: [{ email: "a@bu.ac.th", name: "A" }],
    })
  );
});

test("6. Participant names and course titles are HTML-escaped in both languages", () => {
  const xssTitle = `Workshop <script>alert("xss")</script> & "Quotes" 'Single'`;
  const xssName = `<b>Attacker</b> & "Team"`;

  const enRendered = renderEvaluationEmailContent({
    language: "en",
    courseTitle: xssTitle,
    evalLink: "https://butraining.netlify.app/#/evaluate/c1?title=test",
    recipientName: xssName,
  });
  assert.equal(enRendered.htmlBody.includes("<script>"), false);
  assert.equal(enRendered.htmlBody.includes("<b>Attacker</b>"), false);
  assert.ok(enRendered.htmlBody.includes("&lt;script&gt;"));
  assert.ok(enRendered.htmlBody.includes("&lt;b&gt;Attacker&lt;/b&gt;"));

  const thRendered = renderEvaluationEmailContent({
    language: "th",
    courseTitle: xssTitle,
    evalLink: "https://butraining.netlify.app/#/evaluate/c1?title=test",
    recipientName: xssName,
  });
  assert.equal(thRendered.htmlBody.includes("<script>"), false);
  assert.equal(thRendered.htmlBody.includes("<b>Attacker</b>"), false);
});

test("7. English recipient name resolution enforces verified English names / Latin fallback", () => {
  assert.equal(
    resolveEvaluationRecipientName({
      language: "en",
      userName: "สมชาย ใจดี",
      instructorId: "A67001",
      englishFullName: "Asst. Prof. Somchai Jaidee",
      englishNameVerified: true,
    }),
    "Asst. Prof. Somchai Jaidee"
  );

  // Unverified English name with Thai base name must NOT trust unverified English name or leak 'อ.'
  assert.equal(
    resolveEvaluationRecipientName({
      language: "en",
      userName: "สมชาย ใจดี",
      instructorId: "A67001",
      englishFullName: "Unverified Name",
      englishNameVerified: false,
    }),
    "Participant"
  );

  // Automatic Latin-script fallback (Phase 2B.1.5C)
  assert.equal(
    resolveEvaluationRecipientName({
      language: "en",
      userName: "Dr. Russell Tagalog Rodrigo",
      instructorId: "A67007",
      englishNameVerified: false,
    }),
    "Dr. Russell Tagalog Rodrigo"
  );

  // Thai course preserves Thai title formatting
  assert.equal(
    resolveEvaluationRecipientName({
      language: "th",
      userName: "สมชาย ใจดี",
      instructorId: "A67001",
    }),
    "อ.สมชาย ใจดี"
  );
});

test("8. GAS templates (GAS_CODE.md & GAS_EN_CODE.gs) implement Module 17 templates & URL guards", () => {
  const root = path.resolve(import.meta.dirname || process.cwd(), "..");
  const gasTh = fs.readFileSync(path.join(root, "GAS_CODE.md"), "utf8");
  const gasEn = fs.readFileSync(path.join(root, "GAS_EN_CODE.gs"), "utf8");

  for (const snippet of [
    "[BU Training] Training Evaluation Request:",
    "Training Evaluation",
    "Thank you for attending",
    "Your feedback is valuable in helping us improve the quality of our future training programs.",
    EVALUATION_PROMPT_EN,
    "Complete Evaluation",
    "If the button does not work, please copy and paste the following link into your browser:",
    "Thank you for your time and valuable feedback.",
    "Learning Development Office (LDO)",
    "isValidPublishedEvalUrl",
  ]) {
    assert.ok(gasTh.includes(snippet), `GAS_CODE.md missing: ${snippet}`);
    assert.ok(gasEn.includes(snippet), `GAS_EN_CODE.gs missing: ${snippet}`);
  }

  assert.ok(gasTh.includes(EVALUATION_PROMPT_TH));
  assert.ok(gasTh.includes("เริ่มทำแบบประเมินผล"));
});

console.log(`\nSummary: ${passed} passed, ${failed} failed\n`);

// Non-sending template previews for verification output
const sampleTh = renderEvaluationEmailContent({
  language: "th",
  courseTitle: "การออกแบบการเรียนรู้ยุค AI",
  evalLink: "https://butraining.netlify.app/#/evaluate/course_2026_01?title=%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%AD%E0%B8%AD%E0%B8%81%E0%B9%81%E0%B8%9A%E0%B8%9A%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B9%80%E0%B8%A3%E0%B8%B5%E0%B8%A2%E0%B8%99%E0%B8%A3%E0%B8%B9%E0%B9%89%E0%B8%A2%E0%B8%B8%E0%B8%84%20AI",
  recipientName: "อ.สมชาย ใจดี",
});
const sampleEn = renderEvaluationEmailContent({
  language: "en",
  courseTitle: "AI-Assisted Curriculum Design",
  evalLink: "https://butraining.netlify.app/#/evaluate/course_2026_02?title=AI-Assisted%20Curriculum%20Design",
  recipientName: "Dr. Russell Tagalog Rodrigo",
});

console.log("--- PREVIEW: THAI EVALUATION EMAIL ---");
console.log("Subject:", sampleTh.subject);
console.log(sampleTh.body);
console.log("\n--- PREVIEW: ENGLISH EVALUATION EMAIL ---");
console.log("Subject:", sampleEn.subject);
console.log(sampleEn.body);
console.log("");

if (failed > 0) {
  process.exit(1);
}
