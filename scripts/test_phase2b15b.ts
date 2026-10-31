/**
 * Phase 2B.1.5B Focused Security & Integrity Test Suite
 * Evaluates:
 * 1. Admin approves a name
 * 2. Non-admin changes unrelated fields on a verified record: ALLOWED
 * 3. Non-admin modifies a verified English name while preserving verified=true: DENIED
 * 4. Non-admin deletes an approved English name: DENIED
 * 5. Non-admin edits an unverified English name: ALLOWED
 * 6. Non-admin sets or removes the verification flag: DENIED
 * 7. Admin replaces and reapproves an English name: ALLOWED
 * 8. Existing documents without English fields remain compatible
 * 9. English notification uses only an approved name (authoritative backend resolution)
 */

interface MockDoc {
  id: string;
  name: string;
  email: string;
  department: string;
  position?: string;
  uid?: string;
  englishFullName?: string;
  englishNameVerified?: boolean;
  [key: string]: any;
}

interface MockAuth {
  uid: string;
  token: {
    email: string;
  };
}

// Simulates Firestore Security Rule: match /instructors/{instructorId}
function evaluateInstructorUpdateRule(
  instructorId: string,
  resourceData: MockDoc,
  requestResourceData: MockDoc,
  auth: MockAuth | null,
  isAdminUser: boolean
): { allowed: boolean; reason: string } {
  if (!auth) {
    return { allowed: false, reason: "Unauthenticated" };
  }

  // isValidInstructor
  const hasRequired = ['id', 'name', 'email', 'department'].every(k => k in requestResourceData);
  const validEmail = typeof requestResourceData.email === 'string' && /^[a-zA-Z0-9._%+-]+@bu\.ac\.th$/.test(requestResourceData.email);
  const validStrings = Boolean(requestResourceData.id && requestResourceData.name && requestResourceData.department);
  if (!hasRequired || !validEmail || !validStrings) {
    return { allowed: false, reason: "Invalid instructor schema" };
  }

  // Admin bypass
  if (isAdminUser) {
    return { allowed: true, reason: "Admin permission" };
  }

  // Owner check
  const isOwner = auth.uid === instructorId;
  const isDocOwner = auth.uid === resourceData.uid;
  const isEmailOwner = auth.token.email.toLowerCase() === resourceData.email.toLowerCase();
  if (!isOwner && !isDocOwner && !isEmailOwner) {
    return { allowed: false, reason: "Not resource owner" };
  }

  // diff calculation
  const allKeys = new Set([...Object.keys(resourceData), ...Object.keys(requestResourceData)]);
  const affectedKeys = new Set<string>();
  for (const k of allKeys) {
    if (resourceData[k] !== requestResourceData[k]) {
      affectedKeys.add(k);
    }
  }

  // Condition 1: !affectedKeys.hasAny(['englishNameVerified'])
  if (affectedKeys.has('englishNameVerified')) {
    return { allowed: false, reason: "Non-admin cannot modify englishNameVerified" };
  }

  // Condition 2:
  // !('englishNameVerified' in resource.data) ||
  // resource.data.englishNameVerified != true ||
  // !request.resource.data.diff(resource.data).affectedKeys().hasAny(['englishFullName'])
  const isVerifiedInDoc = ('englishNameVerified' in resourceData) && resourceData.englishNameVerified === true;
  if (isVerifiedInDoc) {
    if (affectedKeys.has('englishFullName')) {
      return { allowed: false, reason: "Non-admin cannot modify or delete englishFullName on a verified record" };
    }
  }

  return { allowed: true, reason: "Satisfies owner update policy" };
}

// Simulates Netlify Function English recipient resolution
function resolveEnglishRecipientName(
  instData: { englishFullName?: string; englishNameVerified?: boolean } | null
): string {
  if (!instData) return "Faculty Member";
  const rawEn = (instData.englishFullName || "").trim();
  if (rawEn && !/[\u0E00-\u0E7F]/.test(rawEn)) {
    if (instData.englishNameVerified === true) {
      return rawEn;
    }
  }
  return "Faculty Member";
}

let allPassed = true;
function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName} - ${detail || "Condition not met"}`);
    allPassed = false;
  }
}

console.log("=== RUNNING PHASE 2B.1.5B SECURITY & INTEGRITY TESTS ===\n");

const baseDoc: MockDoc = {
  id: "A1001",
  name: "ดร. สมชาย ใจดี",
  email: "somchai.j@bu.ac.th",
  department: "IT",
  position: "อาจารย์",
  uid: "uid-somchai-123",
};

const userAuth: MockAuth = {
  uid: "uid-somchai-123",
  token: { email: "somchai.j@bu.ac.th" },
};

// Test 1: Admin approves a name
{
  const resData: MockDoc = { ...baseDoc, englishFullName: "Dr. Somchai Jaidee", englishNameVerified: false };
  const reqData: MockDoc = { ...resData, englishNameVerified: true };
  const res = evaluateInstructorUpdateRule("A1001", resData, reqData, { uid: "admin-1", token: { email: "kulachet.l@bu.ac.th" } }, true);
  assert(res.allowed === true, "1. Admin approves a name: ALLOWED", res.reason);
}

// Test 2: Non-admin changes unrelated fields on a verified record: ALLOWED
{
  const verifiedDoc: MockDoc = { ...baseDoc, englishFullName: "Dr. Somchai Jaidee", englishNameVerified: true };
  const updatedDoc: MockDoc = { ...verifiedDoc, position: "ผู้ช่วยศาสตราจารย์", department: "Computer Science" };
  const res = evaluateInstructorUpdateRule("A1001", verifiedDoc, updatedDoc, userAuth, false);
  assert(res.allowed === true, "2. Non-admin changes unrelated fields on verified record: ALLOWED", res.reason);
}

// Test 3: Non-admin modifies a verified English name while preserving verified=true: DENIED
{
  const verifiedDoc: MockDoc = { ...baseDoc, englishFullName: "Dr. Somchai Jaidee", englishNameVerified: true };
  const tamperedDoc: MockDoc = { ...verifiedDoc, englishFullName: "Dr. Somchai Attacker" };
  const res = evaluateInstructorUpdateRule("A1001", verifiedDoc, tamperedDoc, userAuth, false);
  assert(res.allowed === false, "3. Non-admin modifies verified English name preserving verified=true: DENIED", res.reason);
}

// Test 4: Non-admin deletes an approved English name: DENIED
{
  const verifiedDoc: MockDoc = { ...baseDoc, englishFullName: "Dr. Somchai Jaidee", englishNameVerified: true };
  const deletedNameDoc: MockDoc = { ...baseDoc, englishNameVerified: true }; // englishFullName removed
  const res = evaluateInstructorUpdateRule("A1001", verifiedDoc, deletedNameDoc, userAuth, false);
  assert(res.allowed === false, "4. Non-admin deletes approved English name: DENIED", res.reason);
}

// Test 5: Non-admin edits an unverified English name: ALLOWED
{
  const unverifiedDoc: MockDoc = { ...baseDoc, englishFullName: "Somchai J.", englishNameVerified: false };
  const editedDoc: MockDoc = { ...unverifiedDoc, englishFullName: "Dr. Somchai Jaidee" };
  const res = evaluateInstructorUpdateRule("A1001", unverifiedDoc, editedDoc, userAuth, false);
  assert(res.allowed === true, "5. Non-admin edits an unverified English name: ALLOWED", res.reason);
}

// Test 6: Non-admin sets or removes the verification flag: DENIED
{
  // 6a: Non-admin tries to set englishNameVerified to true
  const unverifiedDoc: MockDoc = { ...baseDoc, englishFullName: "Dr. Somchai Jaidee", englishNameVerified: false };
  const selfVerifyDoc: MockDoc = { ...unverifiedDoc, englishNameVerified: true };
  const resA = evaluateInstructorUpdateRule("A1001", unverifiedDoc, selfVerifyDoc, userAuth, false);
  assert(resA.allowed === false, "6a. Non-admin sets englishNameVerified=true: DENIED", resA.reason);

  // 6b: Non-admin tries to remove englishNameVerified flag
  const verifiedDoc: MockDoc = { ...baseDoc, englishFullName: "Dr. Somchai Jaidee", englishNameVerified: true };
  const removedFlagDoc: MockDoc = { ...baseDoc, englishFullName: "Dr. Somchai Jaidee" }; // flag deleted
  const resB = evaluateInstructorUpdateRule("A1001", verifiedDoc, removedFlagDoc, userAuth, false);
  assert(resB.allowed === false, "6b. Non-admin removes englishNameVerified flag: DENIED", resB.reason);
}

// Test 7: Admin replaces and reapproves an English name: ALLOWED
{
  const verifiedDoc: MockDoc = { ...baseDoc, englishFullName: "Dr. Somchai Jaidee", englishNameVerified: true };
  const adminUpdatedDoc: MockDoc = { ...verifiedDoc, englishFullName: "Assoc. Prof. Dr. Somchai Jaidee", englishNameVerified: true };
  const res = evaluateInstructorUpdateRule("A1001", verifiedDoc, adminUpdatedDoc, { uid: "admin-1", token: { email: "kulachet.l@bu.ac.th" } }, true);
  assert(res.allowed === true, "7. Admin replaces and reapproves English name: ALLOWED", res.reason);
}

// Test 8: Existing documents without English fields remain compatible
{
  const legacyDoc: MockDoc = { ...baseDoc }; // No englishFullName, no englishNameVerified
  // 8a: User updates department on legacy doc
  const legacyUpdateDoc: MockDoc = { ...legacyDoc, department: "Digital Media" };
  const resA = evaluateInstructorUpdateRule("A1001", legacyDoc, legacyUpdateDoc, userAuth, false);
  assert(resA.allowed === true, "8a. Non-admin updates legacy doc without English fields: ALLOWED", resA.reason);

  // 8b: User supplies unverified English name on legacy doc
  const addUnverifiedDoc: MockDoc = { ...legacyDoc, englishFullName: "Somchai Jaidee" };
  const resB = evaluateInstructorUpdateRule("A1001", legacyDoc, addUnverifiedDoc, userAuth, false);
  assert(resB.allowed === true, "8b. Non-admin adds unverified English name to legacy doc: ALLOWED", resB.reason);
}

// Test 9: English notification uses only an approved name
{
  // 9a: Verified English name -> Uses verified name
  const nameA = resolveEnglishRecipientName({ englishFullName: "Dr. Somchai Jaidee", englishNameVerified: true });
  assert(nameA === "Dr. Somchai Jaidee", "9a. Verified name used in English notification: PASS");

  // 9b: Unverified English name -> Neutral fallback
  const nameB = resolveEnglishRecipientName({ englishFullName: "Dr. Somchai Jaidee", englishNameVerified: false });
  assert(nameB === "Faculty Member", "9b. Unverified name falls back to Faculty Member: PASS");

  // 9c: Missing verification field -> Neutral fallback
  const nameC = resolveEnglishRecipientName({ englishFullName: "Dr. Somchai Jaidee" });
  assert(nameC === "Faculty Member", "9c. Missing verification falls back to Faculty Member: PASS");

  // 9d: Thai characters in English field -> Neutral fallback even if verified flag was set
  const nameD = resolveEnglishRecipientName({ englishFullName: "ผศ.ดร. สมชาย ใจดี", englishNameVerified: true });
  assert(nameD === "Faculty Member", "9d. Thai characters rejected even if verified: PASS");
}

console.log("\nAll Phase 2B.1.5B Focused Tests Completed. Overall Result:", allPassed ? "ALL PASS" : "FAILURES DETECTED");
if (!allPassed) {
  process.exit(1);
}
