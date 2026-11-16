import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validatePublicAppUrl,
  resolveInitialPublicAppUrl,
  buildEvaluationEmailUrl,
  isDisallowedPreviewOrLocalHostname,
} from "../src/lib/appUrl";
import {
  buildEvaluationEmailPayload,
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

console.log("\n=== MODULE 16: Evaluation Email Link Repair Test Suite ===\n");

test("1. Rejects temporary AI Studio Preview, Deploy Preview, and localhost hostnames", () => {
  const disallowedHosts = [
    "ais-pre-sly2upsojdu5nc47xldytg-166049909817.asia-east1.run.app",
    "ais-dev-xyz123.asia-east1.run.app",
    "custom-preview.run.app",
    "deploy-preview-42--bu-portal.netlify.app",
    "localhost",
    "127.0.0.1",
    "bu-portal.local",
  ];
  for (const host of disallowedHosts) {
    assert.equal(isDisallowedPreviewOrLocalHostname(host), true, `Expected ${host} to be disallowed`);
  }
  assert.equal(isDisallowedPreviewOrLocalHostname("bu-training-portal.netlify.app"), false);
  assert.equal(isDisallowedPreviewOrLocalHostname("training.bu.ac.th"), false);
});

test("2. validatePublicAppUrl rejects empty, placeholders, non-HTTPS, credentials, and preview URLs", () => {
  const badInputs = [
    "",
    "   ",
    "https://...",
    "http://training.bu.ac.th",
    "not-a-url",
    "https://ais-pre-sly2upsojdu5nc47xldytg-166049909817.asia-east1.run.app",
    "https://ais-dev-12345.asia-east1.run.app",
    "https://localhost:3000",
    "https://user:secret@training.bu.ac.th",
    "https://intranet",
  ];

  for (const bad of badInputs) {
    const res = validatePublicAppUrl(bad);
    assert.equal(res.valid, false, `Expected '${bad}' to be rejected`);
  }

  const good = validatePublicAppUrl("https://bu-training-2026.netlify.app/");
  assert.equal(good.valid, true);
  if (good.valid) {
    assert.equal(good.normalizedBaseUrl, "https://bu-training-2026.netlify.app");
  }
});

test("3. resolveInitialPublicAppUrl never falls back to AI Studio Preview origin", () => {
  const previewOrigin = "https://ais-pre-sly2upsojdu5nc47xldytg-166049909817.asia-east1.run.app";

  const withoutEnv = resolveInitialPublicAppUrl(previewOrigin, "");
  assert.equal(withoutEnv.isConfigured, false);
  assert.equal(withoutEnv.url, "");
  assert.equal(withoutEnv.source, "unconfigured");
  assert.ok(withoutEnv.errorReason && withoutEnv.errorReason.length > 0);

  const withValidEnv = resolveInitialPublicAppUrl(previewOrigin, "https://ldo-portal.bu.ac.th/");
  assert.equal(withValidEnv.isConfigured, true);
  assert.equal(withValidEnv.url, "https://ldo-portal.bu.ac.th");
  assert.equal(withValidEnv.source, "env");

  const withInvalidEnv = resolveInitialPublicAppUrl("https://ldo-portal.bu.ac.th", previewOrigin);
  assert.equal(withInvalidEnv.isConfigured, false);
  assert.equal(withInvalidEnv.url, "");
  assert.equal(withInvalidEnv.source, "invalid_env");

  const publishedRuntimeOrigin = resolveInitialPublicAppUrl("https://bu-training.netlify.app", "");
  assert.equal(publishedRuntimeOrigin.isConfigured, true);
  assert.equal(publishedRuntimeOrigin.url, "https://bu-training.netlify.app");
  assert.equal(publishedRuntimeOrigin.source, "runtime_origin");
});

test("4. buildEvaluationEmailUrl preserves #/evaluate/{courseId}, encodes query safely, and handles edge-case IDs", () => {
  const url = buildEvaluationEmailUrl(
    "https://bu-training.netlify.app/",
    "course_2026-01",
    "AI & Assessment: Part #1? Yes"
  );
  assert.ok(url.startsWith("https://bu-training.netlify.app/#/evaluate/course_2026-01?title="));
  assert.equal(url.includes("ais-pre-"), false);
  assert.equal(url.includes(".run.app"), false);

  const parsed = new URL(url);
  assert.ok(parsed.hash.startsWith("#/evaluate/course_2026-01?"));
  const hashQuery = parsed.hash.split("?")[1] || "";
  const decodedTitle = new URLSearchParams(hashQuery).get("title");
  assert.equal(decodedTitle, "AI & Assessment: Part #1? Yes");

  assert.throws(() => buildEvaluationEmailUrl("https://...", "course-1", "Title"));
  assert.throws(() => buildEvaluationEmailUrl("https://bu-training.netlify.app", "bad/id", "Title"));
  assert.throws(() => buildEvaluationEmailUrl("https://bu-training.netlify.app", "", "Title"));
});

test("5. buildEvaluationEmailPayload blocks sending when published URL is missing or preview", () => {
  assert.throws(() =>
    buildEvaluationEmailPayload({
      baseUrl: "https://ais-pre-sly2upsojdu5nc47xldytg-166049909817.asia-east1.run.app",
      course: { id: "c1", title: "Test", language: "th" },
      recipients: [{ email: "faculty@bu.ac.th", name: "อ.ทดสอบ" }],
    })
  );

  assert.throws(() =>
    buildEvaluationEmailPayload({
      baseUrl: "",
      course: { id: "c1", title: "Test", language: "en" },
      recipients: [{ email: "faculty@bu.ac.th", name: "Dr. Test" }],
    })
  );

  assert.throws(() =>
    buildEvaluationEmailPayload({
      baseUrl: "https://bu-training.netlify.app",
      course: { id: "c1", title: "Test", language: "en" },
      recipients: [],
    })
  );
});

test("6. Thai & English evaluation email payloads contain exact localized instructions, same app target, and escaped HTML", () => {
  const baseUrl = "https://bu-training.netlify.app";
  const courseId = "course_2026_ai";

  const thPayload = buildEvaluationEmailPayload({
    baseUrl,
    course: { id: courseId, title: "การสอนยุค <AI> & Learning", language: "th" },
    recipients: [{ email: "somchai@bu.ac.th", name: "ผศ.สมชาย ใจดี" }],
  });

  assert.equal(thPayload.action, "send_evaluations");
  assert.equal(thPayload.language, "th");
  assert.equal(thPayload.evalLink, thPayload.evaluationUrl);
  assert.ok(thPayload.evalLink.startsWith("https://bu-training.netlify.app/#/evaluate/course_2026_ai?title="));
  assert.ok(thPayload.emailBody.includes(EVALUATION_PROMPT_TH));
  assert.ok(thPayload.emailHtmlBody.includes(EVALUATION_PROMPT_TH));
  assert.ok(thPayload.emailBody.includes(thPayload.evalLink));
  assert.ok(!thPayload.emailHtmlBody.includes("<AI>"), "Expected course title HTML tags to be escaped");
  assert.ok(thPayload.emailHtmlBody.includes("&lt;AI&gt;"));

  const enPayload = buildEvaluationEmailPayload({
    baseUrl,
    course: { id: courseId, title: "Active Learning Design", language: "en" },
    recipients: [{ email: "russell@bu.ac.th", name: "Dr. Russell" }],
  });

  assert.equal(enPayload.action, "send_evaluations");
  assert.equal(enPayload.language, "en");
  assert.equal(enPayload.evalLink, enPayload.evaluationUrl);
  assert.ok(enPayload.evalLink.startsWith("https://bu-training.netlify.app/#/evaluate/course_2026_ai?title="));
  assert.ok(enPayload.emailBody.includes(EVALUATION_PROMPT_EN));
  assert.ok(enPayload.emailHtmlBody.includes(EVALUATION_PROMPT_EN));
  assert.ok(enPayload.emailBody.includes(enPayload.evalLink));

  // Verify TH & EN resolve to the exact same origin and hash route prefix
  const thUrl = new URL(thPayload.evalLink);
  const enUrl = new URL(enPayload.evalLink);
  assert.equal(thUrl.origin, enUrl.origin);
  assert.equal(thUrl.hash.split("?")[0], "#/evaluate/course_2026_ai");
  assert.equal(enUrl.hash.split("?")[0], "#/evaluate/course_2026_ai");
});

test("7. Static source audit: no hardcoded preview fallback URLs remain in src/ and GAS templates include required wording & guards", () => {
  const root = path.resolve(import.meta.dirname || process.cwd(), "..");
  const registrantsSrc = fs.readFileSync(path.join(root, "src/components/RegistrantsList.tsx"), "utf8");
  assert.equal(registrantsSrc.includes("ais-pre-sly2upsojdu5nc47xldytg"), false);
  assert.equal(registrantsSrc.includes('evalBaseUrl === "https://..."'), false);

  const gasTh = fs.readFileSync(path.join(root, "GAS_CODE.md"), "utf8");
  assert.ok(gasTh.includes(EVALUATION_PROMPT_TH));
  assert.ok(gasTh.includes(EVALUATION_PROMPT_EN));
  assert.ok(gasTh.includes("isValidPublishedEvalUrl"));

  const gasEn = fs.readFileSync(path.join(root, "GAS_EN_CODE.gs"), "utf8");
  assert.ok(gasEn.includes(EVALUATION_PROMPT_EN));
  assert.ok(gasEn.includes("isValidPublishedEvalUrl"));
});

console.log(`\nSummary: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
