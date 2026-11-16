/**
 * MODULE 15 — Reproducible Firestore Emulator Security Rules & Concurrency Test Suite
 *
 * Designed to execute against a running Firebase Firestore Emulator:
 *   firebase emulators:exec --only firestore "npx tsx scripts/test_module15_emulator.ts"
 *
 * Uses the Firestore Emulator REST API with `Authorization: Bearer owner` for fixture seeding
 * and unsigned Emulator JWTs (`alg: "none"`) for participant/attacker/admin requests so it
 * exercises the real `firestore.rules` CEL engine with zero extra npm dependencies.
 *
 * If no Firestore Emulator is reachable, prints PENDING EXECUTION and exits with code 2.
 */
import fs from "fs";
import path from "path";
import { buildEvaluationDocId } from "../src/lib/evaluationId";

const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
const PROJECT_ID = JSON.parse(fs.readFileSync(configPath, "utf8")).projectId || "my-bu-app-2026-d4620";
const BASE_DOC_URL = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const CLEAR_URL = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function makeEmulatorJwt(uid: string, email: string): string {
  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = b64({ alg: "none", typ: "JWT" });
  const payload = b64({
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    auth_time: Math.floor(Date.now() / 1000),
    user_id: uid,
    sub: uid,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    email,
    email_verified: true,
    firebase: { identities: { email: [email] }, sign_in_provider: "google.com" },
  });
  return `${header}.${payload}.`;
}

function validRatingsFields(score = 5) {
  const fields: Record<string, { integerValue: string }> = {};
  for (let i = 0; i < 10; i++) {
    fields[String(i)] = { integerValue: String(score) };
  }
  return { mapValue: { fields } };
}

function buildEvalFields(courseId: string, userId: string, email: string, score = 5) {
  return {
    courseId: { stringValue: courseId },
    userId: { stringValue: userId },
    userEmail: { stringValue: email },
    userName: { stringValue: `User ${userId}` },
    ratings: validRatingsFields(score),
    suggestion: { stringValue: "Great workshop" },
    createdAt: { stringValue: new Date().toISOString() },
  };
}

async function isEmulatorRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://${FIRESTORE_HOST}/`, { signal: AbortSignal.timeout(1500) });
    const contentType = res.headers.get("content-type") || "";
    const text = (await res.text()).trim();
    // Firestore Emulator responds to GET / with 200 text/plain "Ok" (distinguishes from nginx/Vite HTML servers)
    return res.status === 200 && !contentType.includes("text/html") && text === "Ok";
  } catch {
    return false;
  }
}

async function emulatorRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  token: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

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

async function main() {
  const reachable = await isEmulatorRunning();
  if (!reachable) {
    console.log(
      `[PENDING EXECUTION] Firestore Emulator is not reachable at ${FIRESTORE_HOST}.`
    );
    console.log(
      'Run inside an environment with Java installed:\n  firebase emulators:exec --only firestore "npx tsx scripts/test_module15_emulator.ts"'
    );
    process.exit(2);
  }

  console.log(`=== MODULE 15 FIRESTORE EMULATOR TESTS (${FIRESTORE_HOST}) ===\n`);

  // Clear emulator state
  await fetch(CLEAR_URL, { method: "DELETE", headers: { Authorization: "Bearer owner" } });

  const userAToken = makeEmulatorJwt("uid_alice", "alice@bu.ac.th");
  const userBToken = makeEmulatorJwt("uid_bob", "bob@bu.ac.th");
  const adminToken = makeEmulatorJwt("uid_admin", "kulachet.l@bu.ac.th");

  // Seed courses (with ASCII, Thai, and underscore IDs)
  const courseIds = ["course_2026_en", "อบรม_2569_วิชาการ"];
  for (const cid of courseIds) {
    await emulatorRequest("PATCH", `${BASE_DOC_URL}/courses/${encodeURIComponent(cid)}`, "owner", {
      fields: {
        title: { stringValue: `Course ${cid}` },
        language: { stringValue: cid.includes("en") ? "en" : "th" },
      },
    });
  }

  // 1. Valid create by participant A on English course
  const detA = buildEvaluationDocId("course_2026_en", "uid_alice");
  {
    const res = await emulatorRequest(
      "PATCH",
      `${BASE_DOC_URL}/evaluations/${encodeURIComponent(detA)}`,
      userAToken,
      { fields: buildEvalFields("course_2026_en", "uid_alice", "alice@bu.ac.th", 5) }
    );
    assert(res.status === 200, "1. Participant creates valid deterministic evaluation", `status=${res.status}`);
  }

  // 2. Concurrent / rapid second write with same deterministic ID is DENIED for participant A
  {
    const res = await emulatorRequest(
      "PATCH",
      `${BASE_DOC_URL}/evaluations/${encodeURIComponent(detA)}`,
      userAToken,
      { fields: buildEvalFields("course_2026_en", "uid_alice", "alice@bu.ac.th", 1) }
    );
    assert(res.status === 403, "2. Participant overwrite / duplicate deterministic write is DENIED (403)", `status=${res.status}`);
  }

  // 3. Parallel Promise.all race condition for user B on Thai course: exactly 1 succeeds, 1 denied
  {
    const detBThai = buildEvaluationDocId("อบรม_2569_วิชาการ", "uid_bob");
    const url = `${BASE_DOC_URL}/evaluations/${encodeURIComponent(detBThai)}`;
    const body = { fields: buildEvalFields("อบรม_2569_วิชาการ", "uid_bob", "bob@bu.ac.th", 5) };
    const [r1, r2] = await Promise.all([
      emulatorRequest("PATCH", url, userBToken, body),
      emulatorRequest("PATCH", url, userBToken, body),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert(
      statuses[0] === 200 && statuses[1] === 403,
      "3. Concurrent duplicate submission race yields exactly 1 success (200) and 1 rejection (403)",
      `statuses=${statuses.join(",")}`
    );
  }

  // 4. Participant cannot read another participant's evaluation (403), owner can read own (200), admin can read all (200)
  {
    const ownRead = await emulatorRequest("GET", `${BASE_DOC_URL}/evaluations/${encodeURIComponent(detA)}`, userAToken);
    const crossRead = await emulatorRequest("GET", `${BASE_DOC_URL}/evaluations/${encodeURIComponent(detA)}`, userBToken);
    const adminRead = await emulatorRequest("GET", `${BASE_DOC_URL}/evaluations/${encodeURIComponent(detA)}`, adminToken);
    assert(ownRead.status === 200, "4a. Participant reads own evaluation (200)");
    assert(crossRead.status === 403, "4b. Participant reading another user's evaluation DENIED (403)");
    assert(adminRead.status === 200, "4c. Admin reads participant evaluation (200)");
  }

  // 5. Participant self-query (where courseId == X && userId == auth.uid) succeeds, querying another uid is denied
  {
    const ownQuery = await emulatorRequest("POST", `${BASE_DOC_URL}:runQuery`, userAToken, {
      structuredQuery: {
        from: [{ collectionId: "evaluations" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "courseId" }, op: "EQUAL", value: { stringValue: "course_2026_en" } } },
              { fieldFilter: { field: { fieldPath: "userId" }, op: "EQUAL", value: { stringValue: "uid_alice" } } },
            ],
          },
        },
        limit: 1,
      },
    });
    const otherQuery = await emulatorRequest("POST", `${BASE_DOC_URL}:runQuery`, userBToken, {
      structuredQuery: {
        from: [{ collectionId: "evaluations" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "courseId" }, op: "EQUAL", value: { stringValue: "course_2026_en" } } },
              { fieldFilter: { field: { fieldPath: "userId" }, op: "EQUAL", value: { stringValue: "uid_alice" } } },
            ],
          },
        },
        limit: 1,
      },
    });
    assert(ownQuery.status === 200, "5a. Participant pre-check query for own userId succeeds (200)");
    assert(otherQuery.status === 403, "5b. Participant query filtering another userId is DENIED (403)");
  }

  // 6. Malicious writes: tampered doc ID, forged userId, non-existent courseId, invalid ratings, extra fields
  {
    const badIdRes = await emulatorRequest(
      "PATCH",
      `${BASE_DOC_URL}/evaluations/arbitrary_random_id_999`,
      userBToken,
      { fields: buildEvalFields("course_2026_en", "uid_bob", "bob@bu.ac.th", 5) }
    );
    assert(badIdRes.status === 403, "6a. Direct write with non-deterministic random ID DENIED (403)");

    const forgedUidDocId = buildEvaluationDocId("course_2026_en", "uid_alice");
    const forgedUidRes = await emulatorRequest(
      "PATCH",
      `${BASE_DOC_URL}/evaluations/${encodeURIComponent(forgedUidDocId)}`,
      userBToken,
      { fields: buildEvalFields("course_2026_en", "uid_alice", "alice@bu.ac.th", 5) }
    );
    assert(forgedUidRes.status === 403, "6b. Forged userId DENIED (403)");

    const missingCourseDocId = buildEvaluationDocId("nonexistent_course", "uid_bob");
    const missingCourseRes = await emulatorRequest(
      "PATCH",
      `${BASE_DOC_URL}/evaluations/${encodeURIComponent(missingCourseDocId)}`,
      userBToken,
      { fields: buildEvalFields("nonexistent_course", "uid_bob", "bob@bu.ac.th", 5) }
    );
    assert(missingCourseRes.status === 403, "6c. Non-existent courseId DENIED (403)");

    const validBobId = buildEvaluationDocId("course_2026_en", "uid_bob");
    const outOfRangeFields = buildEvalFields("course_2026_en", "uid_bob", "bob@bu.ac.th", 5);
    (outOfRangeFields.ratings.mapValue.fields as any)["0"] = { integerValue: "6" };
    const badRatingRes = await emulatorRequest(
      "PATCH",
      `${BASE_DOC_URL}/evaluations/${encodeURIComponent(validBobId)}`,
      userBToken,
      { fields: outOfRangeFields }
    );
    assert(badRatingRes.status === 403, "6d. Out-of-range rating (6) DENIED (403)");

    const extraFieldPayload = {
      ...buildEvalFields("course_2026_en", "uid_bob", "bob@bu.ac.th", 5),
      adminOverride: { booleanValue: true },
    };
    const extraKeyRes = await emulatorRequest(
      "PATCH",
      `${BASE_DOC_URL}/evaluations/${encodeURIComponent(validBobId)}`,
      userBToken,
      { fields: extraFieldPayload }
    );
    assert(extraKeyRes.status === 403, "6e. Extra disallowed field DENIED (403)");
  }

  // 7. Participant cannot delete, Admin CAN update/delete
  {
    const userDel = await emulatorRequest("DELETE", `${BASE_DOC_URL}/evaluations/${encodeURIComponent(detA)}`, userAToken);
    const adminUpd = await emulatorRequest(
      "PATCH",
      `${BASE_DOC_URL}/evaluations/${encodeURIComponent(detA)}`,
      adminToken,
      { fields: buildEvalFields("course_2026_en", "uid_alice", "alice@bu.ac.th", 4) }
    );
    const adminDel = await emulatorRequest("DELETE", `${BASE_DOC_URL}/evaluations/${encodeURIComponent(detA)}`, adminToken);
    assert(userDel.status === 403, "7a. Participant delete DENIED (403)");
    assert(adminUpd.status === 200, "7b. Admin update ALLOWED (200)");
    assert(adminDel.status === 200, "7c. Admin delete ALLOWED (200)");
  }

  console.log(`\n=== EMULATOR SUMMARY: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Emulator test suite encountered unexpected error:", err);
  process.exit(1);
});
