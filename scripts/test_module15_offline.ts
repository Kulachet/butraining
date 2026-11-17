/**
 * MODULE 15 — Runnable Offline Verification Suite
 *
 * Tests deterministic ID parity, Firestore rules static structure,
 * historical evaluation audit logic (zero-PII), analytics/KPI backward compatibility,
 * and Thai/English UI + error-classification state behavior.
 *
 * Note: Does NOT claim live Firestore Emulator or browser DOM verification.
 */
import fs from "fs";
import path from "path";
import { buildEvaluationDocId } from "../src/lib/evaluationId";
import {
  DEFAULT_QUESTIONS_EN,
  DEFAULT_QUESTIONS_TH,
  EVALUATION_COUNT,
  evaluationUi,
  getEvaluationQuestions,
  validQuestions,
} from "../src/lib/evaluationI18n";
import { resolveCourseLang } from "../src/contexts/LanguageContext";
import {
  analyzeEvaluations,
  calculateCourseOperationalStats,
  getRatingsArray,
} from "../src/lib/evaluationAnalytics";
import { auditEvaluationDataset } from "../src/lib/evaluationAudit";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`[PASS] ${name}`);
  } else {
    failed++;
    console.error(`[FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function assertThrows(fn: () => unknown, name: string) {
  try {
    fn();
    failed++;
    console.error(`[FAIL] ${name} — Expected function to throw`);
  } catch {
    passed++;
    console.log(`[PASS] ${name}`);
  }
}

/**
 * Exact simulation of Firestore Rules CEL `expectedEvaluationId(courseId, uid)`:
 * 'eval_' + string(courseId.size()) + '_' + courseId + '_' + uid
 * where CEL string.size() equals Unicode code-point count.
 */
function rulesExpectedEvaluationId(courseId: string, uid: string): string {
  const celSize = Array.from(courseId).length;
  return `eval_${celSize}_${courseId}_${uid}`;
}

console.log("=== MODULE 15 OFFLINE VERIFICATION SUITE ===\n");

// 1. Deterministic ID & Firestore Rules Parity
console.log("--- 1. Deterministic ID & Unicode Parity ---");
{
  const pairs: Array<[string, string, string]> = [
    ["ASCII", "course2026", "uid123"],
    ["Underscores", "course_2026_en", "user_uid_abc_1"],
    ["Thai", "อบรม_2569_วิชาการ", "อาจารย์_001"],
    ["Mixed Unicode + Emoji", "AI_อบรม_🎓_1", "uid_🧑‍🏫_99"],
    ["Min length 1", "a", "u"],
    ["Max length 128 ASCII", "c".repeat(128), "u".repeat(128)],
    ["Max length 128 Emoji (surrogate pairs)", "🎓".repeat(128), "🧑".repeat(128)],
  ];

  for (const [label, courseId, uid] of pairs) {
    const built = buildEvaluationDocId(courseId, uid);
    const rulesId = rulesExpectedEvaluationId(courseId, uid);
    const utf8Bytes = Buffer.byteLength(built, "utf8");
    assert(built === rulesId, `ID parity (${label})`, `built=${built}, rules=${rulesId}`);
    assert(utf8Bytes <= 1500, `UTF-8 doc ID <= 1500 bytes (${label}: ${utf8Bytes}B)`);
    assert(
      built !== "." && built !== ".." && !/^__.*__$/.test(built),
      `Firestore reserved doc ID guard (${label})`
    );
  }

  // Collision / injectivity checks for underscore ambiguity
  const idA = buildEvaluationDocId("a_b", "c");
  const idB = buildEvaluationDocId("a", "b_c");
  assert(idA !== idB, `Injectivity with underscores: "${idA}" !== "${idB}"`);

  // Boundary rejections matching firestore.rules size() > 0 && size() <= 128 and !matches('.*/.*')
  assertThrows(() => buildEvaluationDocId("", "uid1"), "Rejects empty courseId");
  assertThrows(() => buildEvaluationDocId("course1", ""), "Rejects empty uid");
  assertThrows(() => buildEvaluationDocId("c".repeat(129), "uid1"), "Rejects 129-char ASCII courseId");
  assertThrows(() => buildEvaluationDocId("🎓".repeat(129), "uid1"), "Rejects 129-code-point emoji courseId");
  assertThrows(() => buildEvaluationDocId("course1", "u".repeat(129)), "Rejects 129-char uid");
  assertThrows(() => buildEvaluationDocId("course/1", "uid1"), "Rejects '/' in courseId");
  assertThrows(() => buildEvaluationDocId("course1", "uid/1"), "Rejects '/' in uid");
}

// 2. Static Firestore Rules & Client Payload Parity Check
console.log("\n--- 2. Firestore Rules Static Contract Inspection ---");
{
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
  const evalPageText = fs.readFileSync(path.resolve(process.cwd(), "src/pages/EvaluatePage.tsx"), "utf8");

  assert(
    rulesText.includes("allow get: if (isAuthenticated() && resource.data.userId == request.auth.uid) || isAdmin();") &&
      rulesText.includes("allow list: if (isAuthenticated() && resource.data.userId == request.auth.uid) || isAdmin();"),
    "Rules restrict evaluation get and list reads to document owner (resource.data.userId == auth.uid) or admin"
  );
  assert(
    rulesText.includes("evaluationId == expectedEvaluationId(request.resource.data.courseId, request.auth.uid)") &&
      rulesText.includes("exists(/databases/$(database)/documents/courses/$(request.resource.data.courseId))"),
    "Rules enforce deterministic ID and existing courseId on evaluation create"
  );
  assert(
    rulesText.includes("allow update, delete: if isAdmin();"),
    "Rules deny update and delete for non-admin participants"
  );
  assert(
    rulesText.includes("ratings.keys().hasOnly(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])") &&
      rulesText.includes("ratings.keys().hasAll(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])"),
    "Rules require exact 10 rating keys '0'..'9'"
  );
  assert(
    evalPageText.includes('where("courseId", "==", targetCourseId)') &&
      evalPageText.includes('where("userId", "==", targetUid)') &&
      evalPageText.includes("limit(1)"),
    "EvaluatePage pre-check queries with courseId + userId + limit(1) matching security rules"
  );
  assert(
    evalPageText.includes("setDoc(doc(db, \"evaluations\", deterministicId)"),
    "EvaluatePage writes via deterministic setDoc (no addDoc)"
  );
}

// 3. Read-Only Audit Utility Verification (Zero PII & Mixed Dataset)
console.log("\n--- 3. Read-Only Audit Utility Verification ---");
{
  const det1 = buildEvaluationDocId("course-th-1", "uid-alice");
  const det2 = buildEvaluationDocId("course-en-1", "uid-bob");
  const sampleDataset = [
    // Deterministic valid doc
    {
      id: det1,
      courseId: "course-th-1",
      userId: "uid-alice",
      userName: "Alice Secret",
      userEmail: "alice@bu.ac.th",
      ratings: { "0": 5, "1": 5, "2": 4, "3": 5, "4": 5, "5": 5, "6": 5, "7": 5, "8": 4, "9": 5 },
    },
    // Legacy random-ID valid doc for same (course-th-1, uid-alice) -> duplicate pair!
    {
      id: "legacyRandomId123",
      courseId: "course-th-1",
      userId: "uid-alice",
      userName: "Alice Secret",
      userEmail: "alice@bu.ac.th",
      ratings: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
    },
    // Deterministic valid doc (uid-bob)
    {
      id: det2,
      courseId: "course-en-1",
      userId: "uid-bob",
      ratings: { "0": 5, "1": 4, "2": 5, "3": 4, "4": 5, "5": 5, "6": 4, "7": 5, "8": 5, "9": 5 },
    },
    // Corrupted ratings doc + orphaned course + unmatched user
    {
      id: "legacyBadRatings",
      courseId: "missing-course-999",
      userId: "unknown-uid-999",
      ratings: { "0": 6, "1": 4.5, "2": 3 },
    },
    // Missing ratings field & missing courseId/userId
    {
      id: "legacyMissingFields",
      ratings: null,
    },
  ];

  const report = auditEvaluationDataset(sampleDataset, {
    knownCourseIds: new Set(["course-th-1", "course-en-1"]),
    knownUserIds: new Set(["uid-alice", "uid-bob"]),
  });

  assert(report.readOnly === true && report.piiRedacted === true, "Audit marks readOnly & piiRedacted");
  assert(report.totals.totalEvaluationDocs === 5, `Total docs === 5 (got ${report.totals.totalEvaluationDocs})`);
  assert(report.totals.uniqueCourseUserPairs === 3, `Unique valid pairs === 3 (got ${report.totals.uniqueCourseUserPairs})`);
  assert(report.totals.duplicateCourseUserPairs === 1, `Duplicate pairs === 1 (got ${report.totals.duplicateCourseUserPairs})`);
  assert(report.totals.excessDuplicateDocs === 1, `Excess duplicate docs === 1 (got ${report.totals.excessDuplicateDocs})`);
  assert(report.totals.deterministicIdDocs === 2, `Deterministic ID docs === 2 (got ${report.totals.deterministicIdDocs})`);
  assert(report.totals.legacyRandomIdDocs === 2, `Legacy random ID docs === 2 (got ${report.totals.legacyRandomIdDocs})`);
  assert(report.totals.unverifiableIdDocs === 1, `Unverifiable ID docs === 1 (got ${report.totals.unverifiableIdDocs})`);
  assert(report.dataIntegrity.missingOrInvalidRatingFieldsCount === 1, "Detects 1 missing ratings field");
  assert(report.dataIntegrity.invalidRatingValuesCount === 1, "Detects 1 invalid rating values doc");
  assert(report.dataIntegrity.missingCourseIdFieldCount === 1, "Detects 1 missing courseId field");
  assert(report.dataIntegrity.missingUserIdFieldCount === 1, "Detects 1 missing userId field");
  assert(report.dataIntegrity.orphanedCourseReferencesCount === 1, "Detects 1 orphaned courseId reference");
  assert(report.dataIntegrity.unmatchedUserReferencesCount === 1, "Detects 1 unmatched userId reference");

  const serialized = JSON.stringify(report);
  assert(
    !serialized.includes("Alice Secret") &&
      !serialized.includes("alice@bu.ac.th") &&
      !serialized.includes('"userId"'),
    "Audit JSON contains ZERO PII (no userName, userEmail, or raw userId field)"
  );
}

// 4. Analytics & KPI Backward Compatibility
console.log("\n--- 4. Analytics & KPI Mixed Legacy + Deterministic Compatibility ---");
{
  const legacyEval = {
    id: "randLegacyDoc1",
    courseId: "c1",
    userId: "u1",
    ratings: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
    suggestion: "ดีมากครับ",
  };
  const detEval = {
    id: buildEvaluationDocId("c1", "u2"),
    courseId: "c1",
    userId: "u2",
    ratings: { "0": 3, "1": 3, "2": 3, "3": 3, "4": 3, "5": 3, "6": 3, "7": 3, "8": 3, "9": 3 },
    suggestion: "",
  };
  const dupLegacyEval = {
    id: "randLegacyDup1",
    courseId: "c1",
    userId: "u1", // duplicate of u1
    ratings: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  };

  assert(
    JSON.stringify(getRatingsArray(legacyEval.ratings)) === JSON.stringify([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
    "getRatingsArray reads legacy Array ratings identically"
  );
  assert(
    JSON.stringify(getRatingsArray(detEval.ratings)) === JSON.stringify([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
    "getRatingsArray reads deterministic '0'..'9' map ratings identically"
  );

  const cleanAnalysis = analyzeEvaluations([legacyEval, detEval], DEFAULT_QUESTIONS_TH, "Test Course");
  assert(cleanAnalysis.totalResponses === 2, "Clean mixed dataset totalResponses === 2");
  assert(cleanAnalysis.overallAverage === 4.0, `Clean mixed overallAverage === 4.00 (got ${cleanAnalysis.overallAverage})`);

  // Verify exact known behavior with historical duplicate: raw analysis counts 3 docs, operational stats deduplicates uniqueEvaluatorsCount to 2
  const dupAnalysis = analyzeEvaluations([legacyEval, detEval, dupLegacyEval], DEFAULT_QUESTIONS_TH, "Test Course");
  const opStats = calculateCourseOperationalStats(
    "c1",
    [
      { courseId: "c1", userId: "u1", attended: true },
      { courseId: "c1", userId: "u2", attended: true },
    ],
    [legacyEval, detEval, dupLegacyEval]
  );
  assert(
    dupAnalysis.totalResponses === 3 && opStats.uniqueEvaluatorsCount === 2 && opStats.responseRate === 100,
    "Analytics & KPI preserve historical formula (totalEvals=3, uniqueEvaluatorsCount=2, capped responseRate=100%)"
  );
}

// 5. Bilingual Evaluation UI & Error Classification Regression
console.log("\n--- 5. Bilingual Evaluation UI Regression ---");
{
  assert(resolveCourseLang({ language: "en" }) === "en", "course.language='en' resolves to 'en'");
  assert(resolveCourseLang({ language: "th" }) === "th", "course.language='th' resolves to 'th'");
  assert(resolveCourseLang({}) === "th", "missing course.language falls back to 'th'");
  assert(resolveCourseLang(null) === "th", "null course falls back to 'th'");

  assert(
    DEFAULT_QUESTIONS_TH.length === EVALUATION_COUNT && DEFAULT_QUESTIONS_EN.length === EVALUATION_COUNT,
    "Both TH and EN default question lists have exactly 10 items"
  );
  assert(!validQuestions(["short"]), "validQuestions rejects < 10 questions");

  const customSettings = {
    questions: Array.from({ length: 10 }, (_, i) => `TH ${i + 1}`),
    questionsEn: Array.from({ length: 10 }, (_, i) => `EN ${i + 1}`),
  };
  assert(getEvaluationQuestions(customSettings, "en")[0] === "EN 1", "EN loads custom questionsEn");
  assert(getEvaluationQuestions(customSettings, "th")[0] === "TH 1", "TH loads custom questions");
  assert(
    getEvaluationQuestions({ questions: customSettings.questions }, "en")[0] === DEFAULT_QUESTIONS_EN[0],
    "EN falls back to DEFAULT_QUESTIONS_EN when questionsEn is absent"
  );

  // Verify every UI dictionary key is populated in both TH and EN
  const thKeys = Object.keys(evaluationUi.th).sort();
  const enKeys = Object.keys(evaluationUi.en).sort();
  assert(JSON.stringify(thKeys) === JSON.stringify(enKeys), "evaluationUi TH and EN dictionaries have identical keys");
  assert(
    Boolean(
      evaluationUi.th.already &&
        evaluationUi.en.already &&
        evaluationUi.th.duplicateSubmission &&
        evaluationUi.en.duplicateSubmission &&
        evaluationUi.th.permissionDenied &&
        evaluationUi.en.permissionDenied &&
        evaluationUi.th.networkError &&
        evaluationUi.en.networkError
    ),
    "Duplicate, permission-denied, and network error messages defined in both TH & EN"
  );
}

console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
