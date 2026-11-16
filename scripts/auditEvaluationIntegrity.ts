/**
 * MODULE 15 — Read-Only Historical Evaluation Integrity Audit (Admin CLI)
 *
 * Strictly read-only:
 *  - Performs ZERO Firestore writes, deletes, updates, or migrations.
 *  - Uses cursor-based pagination (FieldPath.documentId() + limit) for bounded memory/reads.
 *  - Strips/anonymizes user identity (never logs userName or userEmail).
 *
 * Usage (requires Firebase Admin ADC credentials in environment):
 *   npx tsx scripts/auditEvaluationIntegrity.ts [--page-size=500] [--json]
 */
import fs from "fs";
import path from "path";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldPath, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { EvaluationAuditAccumulator } from "../src/lib/evaluationAudit";

const DEFAULT_PAGE_SIZE = 500;

function parseArgs() {
  const args = process.argv.slice(2);
  let pageSize = DEFAULT_PAGE_SIZE;
  let jsonOutput = false;

  for (const arg of args) {
    if (arg === "--json") {
      jsonOutput = true;
    } else if (arg.startsWith("--page-size=")) {
      const parsed = Number(arg.split("=")[1]);
      if (Number.isInteger(parsed) && parsed >= 50 && parsed <= 2000) {
        pageSize = parsed;
      }
    }
  }
  return { pageSize, jsonOutput };
}

async function paginateCollectionIds(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  pageSize: number,
  onDoc: (doc: QueryDocumentSnapshot) => void
): Promise<number> {
  let count = 0;
  let lastDoc: QueryDocumentSnapshot | null = null;

  while (true) {
    let q = db
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);

    if (lastDoc) {
      q = q.startAfter(lastDoc);
    }

    const snap = await q.get();
    if (snap.empty) break;

    for (const docSnap of snap.docs) {
      onDoc(docSnap);
      count++;
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  return count;
}

async function main() {
  const { pageSize, jsonOutput } = parseArgs();

  const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("firebase-applet-config.json not found in workspace root.");
  }
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId: firebaseConfig.projectId,
    });
  }

  const db =
    firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== "(default)"
      ? getFirestore(firebaseConfig.firestoreDatabaseId)
      : getFirestore();

  const knownCourseIds = new Set<string>();
  const knownUserIds = new Set<string>();

  await paginateCollectionIds(db, "courses", pageSize, (docSnap) => {
    knownCourseIds.add(docSnap.id);
  });

  await paginateCollectionIds(db, "instructors", pageSize, (docSnap) => {
    knownUserIds.add(docSnap.id);
    const uid = docSnap.get("uid");
    if (typeof uid === "string" && uid.trim()) {
      knownUserIds.add(uid);
    }
  });

  await paginateCollectionIds(db, "admins", pageSize, (docSnap) => {
    knownUserIds.add(docSnap.id);
  });

  const accumulator = new EvaluationAuditAccumulator({
    knownCourseIds,
    knownUserIds,
    maxSampleIds: 50,
  });

  await paginateCollectionIds(db, "evaluations", pageSize, (docSnap) => {
    const data = docSnap.data();
    // Explicitly project only non-PII audit fields
    accumulator.addDocument({
      id: docSnap.id,
      courseId: data.courseId,
      userId: data.userId,
      ratings: data.ratings,
      createdAt: data.createdAt,
    });
  });

  const report = accumulator.buildReport();

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("=== BU Academic Training Portal — Read-Only Evaluation Integrity Audit ===");
  console.log(`Generated At (UTC):               ${report.generatedAt}`);
  console.log(`Mode:                             READ-ONLY / PII-REDACTED`);
  console.log(`Page Size:                        ${pageSize}`);
  console.log(`Total Evaluation Docs:            ${report.totals.totalEvaluationDocs}`);
  console.log(`Unique (courseId, userId) Pairs:  ${report.totals.uniqueCourseUserPairs}`);
  console.log(`Duplicate Pairs:                  ${report.totals.duplicateCourseUserPairs}`);
  console.log(`Excess Duplicate Docs:            ${report.totals.excessDuplicateDocs}`);
  console.log(`Deterministic-ID Docs:            ${report.totals.deterministicIdDocs}`);
  console.log(`Legacy Random-ID Docs:            ${report.totals.legacyRandomIdDocs}`);
  console.log(`Mismatched eval_-Prefix Docs:     ${report.totals.mismatchedEvalPrefixDocs}`);
  console.log(`Missing/Invalid Ratings Field:    ${report.dataIntegrity.missingOrInvalidRatingFieldsCount}`);
  console.log(`Invalid Rating Values:            ${report.dataIntegrity.invalidRatingValuesCount}`);
  console.log(`Missing courseId Field:           ${report.dataIntegrity.missingCourseIdFieldCount}`);
  console.log(`Missing userId Field:             ${report.dataIntegrity.missingUserIdFieldCount}`);
  console.log(`Orphaned courseId References:     ${report.dataIntegrity.orphanedCourseReferencesCount}`);
  console.log(`Unmatched userId References:      ${report.dataIntegrity.unmatchedUserReferencesCount}`);
  console.log(`KPI Mean (Raw vs Deduplicated):   ${report.kpiImpactDiagnostic.rawMeanScore ?? "N/A"} vs ${report.kpiImpactDiagnostic.deduplicatedFirstSeenMeanScore ?? "N/A"} (delta=${report.kpiImpactDiagnostic.meanDelta ?? "N/A"})`);
  if (report.duplicatePairs.length > 0) {
    console.log("\nDuplicate Pair Summary (userId hashed, zero PII):");
    for (const pair of report.duplicatePairs.slice(0, 25)) {
      console.log(
        `  - course=${pair.courseId} userHash=${pair.userHash} count=${pair.count} (det=${pair.deterministicCount}, legacy=${pair.legacyCount}) docIds=[${pair.docIds.join(", ")}]`
      );
    }
  }
}

main().catch((err) => {
  console.error("Evaluation integrity audit failed:", err?.message || err);
  console.error("Note: Running against live/staging Firestore requires valid GOOGLE_APPLICATION_CREDENTIALS or Firebase Admin ADC.");
  process.exit(1);
});
