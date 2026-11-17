/**
 * MODULE 18 — Participant Evaluation Permission Diagnosis & Repair Verification Suite
 *
 * Verifies:
 * 1. EvaluatePage traces exact Firestore operations (LOAD_COURSE, LOAD_EVALUATION_SETTINGS,
 *    CHECK_EXISTING_EVALUATION, SUBMIT_EVALUATION, RECHECK_EXISTING_EVALUATION).
 * 2. Diagnostic logging is strictly gated by `import.meta.env.DEV` and logs only safe fields
 *    (operation, code, projectId, authenticated) with zero PII, tokens, or evaluation answers.
 * 3. Pre-check and submission bind strictly to `auth.currentUser.uid`, filter by `courseId` + `userId`,
 *    use `limit(1)`, and gate execution on `authLoading`.
 * 4. firestore.rules separates `allow get` / `allow list`, places owner match before `isAdmin()`,
 *    short-circuits email-listed admins before `/admins` document reads, and preserves all
 *    Module 14/15 write integrity constraints.
 * 5. Client Firebase config (`src/lib/firebase.ts` + `firebase-applet-config.json`) points to a
 *    valid non-empty `projectId` and `(default)` `firestoreDatabaseId`.
 */
import fs from "fs";
import path from "path";

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

console.log("=== MODULE 18 PERMISSION & DIAGNOSTICS VERIFICATION SUITE ===\n");

const root = process.cwd();
const evalPageText = fs.readFileSync(path.resolve(root, "src/pages/EvaluatePage.tsx"), "utf8");
const rulesText = fs.readFileSync(path.resolve(root, "firestore.rules"), "utf8");
const firebaseTsText = fs.readFileSync(path.resolve(root, "src/lib/firebase.ts"), "utf8");
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.resolve(root, "firebase-applet-config.json"), "utf8")
);

// 1. Operation labels & dev-only diagnostic guard
const requiredOps = [
  "LOAD_COURSE",
  "LOAD_EVALUATION_SETTINGS",
  "CHECK_EXISTING_EVALUATION",
  "SUBMIT_EVALUATION",
  "RECHECK_EXISTING_EVALUATION",
];
for (const op of requiredOps) {
  assert(evalPageText.includes(`"${op}"`), `Operation label defined: ${op}`);
}

assert(
  evalPageText.includes("if (!import.meta.env.DEV) return;"),
  "Diagnostic logger strictly disabled outside import.meta.env.DEV"
);

const logFnMatch = evalPageText.match(/function logEvaluationDiagnostic[\s\S]*?\n\}/);
const logFnBody = logFnMatch ? logFnMatch[0] : "";
assert(Boolean(logFnBody), "logEvaluationDiagnostic helper exists");
assert(
  logFnBody.includes("operation") &&
    logFnBody.includes("code") &&
    logFnBody.includes("projectId") &&
    logFnBody.includes("authenticated") &&
    !logFnBody.includes("email") &&
    !logFnBody.includes("uid") &&
    !logFnBody.includes("ratings") &&
    !logFnBody.includes("suggestion") &&
    !logFnBody.includes("token"),
  "Diagnostic logger logs only safe metadata (zero PII, UIDs, tokens, or evaluation answers)"
);

// 2. Query & Auth binding
assert(
  evalPageText.includes("if (authLoading) return;"),
  "EvaluatePage waits until authLoading is false before running Firestore checks"
);
assert(
  evalPageText.includes("const currentUser = auth.currentUser;") &&
    evalPageText.includes("const targetUid = currentUser.uid;") &&
    evalPageText.includes('where("courseId", "==", targetCourseId)') &&
    evalPageText.includes('where("userId", "==", targetUid)') &&
    evalPageText.includes("limit(1)"),
  "hasUserSubmittedEvaluation binds strictly to auth.currentUser.uid with courseId + userId + limit(1)"
);
assert(
  evalPageText.includes("const activeUid = currentUser.uid;") &&
    evalPageText.includes("buildEvaluationDocId(courseId, activeUid)"),
  "handleSubmit binds deterministic evaluation ID and userId payload strictly to auth.currentUser.uid"
);

// 3. Firestore Rules security & ordering checks
assert(
  rulesText.includes("allow get: if (isAuthenticated() && resource.data.userId == request.auth.uid) || isAdmin();") &&
    rulesText.includes("allow list: if (isAuthenticated() && resource.data.userId == request.auth.uid) || isAdmin();"),
  "evaluations rules split allow get / allow list with owner match before isAdmin()"
);
assert(
  !rulesText.includes("allow read: if true") || !rulesText.includes("match /evaluations/{evaluationId} {\n      allow read: if true"),
  "evaluations does NOT allow public reads"
);
assert(
  rulesText.indexOf('request.auth.token.email.lower() == "kulachet.l@bu.ac.th"') <
    rulesText.indexOf("exists(/databases/$(database)/documents/admins/$(request.auth.uid))"),
  "isAdmin() checks email allowlist before exists/get on /admins"
);
assert(
  rulesText.includes("allow update, delete: if isAdmin();") &&
    rulesText.includes("evaluationId == expectedEvaluationId(request.resource.data.courseId, request.auth.uid)"),
  "evaluations write rules preserve deterministic ID creation and block participant update/delete"
);

// 4. Firebase configuration check (no secret exposure)
assert(
  firebaseTsText.includes('import firebaseConfig from "../../firebase-applet-config.json"') &&
    firebaseTsText.includes("getFirestore(app, firebaseConfig.firestoreDatabaseId)"),
  "src/lib/firebase.ts binds Firestore instance directly to firebase-applet-config.json project & databaseId"
);
assert(
  typeof firebaseConfig.projectId === "string" &&
    firebaseConfig.projectId.length > 0 &&
    firebaseConfig.firestoreDatabaseId === "(default)",
  `firebase-applet-config.json targets valid projectId (${firebaseConfig.projectId}) and databaseId (${firebaseConfig.firestoreDatabaseId})`
);

console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
