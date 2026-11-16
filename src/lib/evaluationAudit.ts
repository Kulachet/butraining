import { createHash } from "crypto";
import { buildEvaluationDocId } from "./evaluationId";

export interface RawEvaluationAuditRecord {
  id: string;
  courseId?: unknown;
  userId?: unknown;
  ratings?: unknown;
  createdAt?: unknown;
  // Intentionally ignore userName/userEmail so PII never enters audit output
}

export type EvaluationDocIdKind =
  | "deterministic"
  | "legacy_random"
  | "mismatched_eval_prefix"
  | "unverifiable_missing_keys";

export interface RatingValidationIssue {
  docId: string;
  issueType: "missing_or_invalid_ratings_field" | "invalid_rating_value";
  reasons: string[];
}

export interface DuplicatePairSummary {
  courseId: string;
  userHash: string; // Salted/one-way SHA-256 prefix (never raw email/name)
  count: number;
  excessCount: number;
  docIds: string[];
  deterministicCount: number;
  legacyCount: number;
}

export interface EvaluationAuditOptions {
  knownCourseIds?: Set<string>;
  knownUserIds?: Set<string>;
  maxSampleIds?: number;
}

export interface EvaluationAuditReport {
  generatedAt: string;
  readOnly: true;
  piiRedacted: true;
  totals: {
    totalEvaluationDocs: number;
    uniqueCourseUserPairs: number;
    duplicateCourseUserPairs: number;
    excessDuplicateDocs: number;
    legacyRandomIdDocs: number;
    deterministicIdDocs: number;
    mismatchedEvalPrefixDocs: number;
    unverifiableIdDocs: number;
  };
  dataIntegrity: {
    missingOrInvalidRatingFieldsCount: number;
    invalidRatingValuesCount: number;
    missingCourseIdFieldCount: number;
    missingUserIdFieldCount: number;
    orphanedCourseReferencesCount: number | null;
    unmatchedUserReferencesCount: number | null;
    sampleRatingFieldIssueDocIds: string[];
    sampleRatingValueIssues: RatingValidationIssue[];
    sampleMissingCourseIdDocIds: string[];
    sampleMissingUserIdDocIds: string[];
    sampleOrphanedCourseDocIds: string[];
    sampleUnmatchedUserDocIds: string[];
    sampleMismatchedEvalPrefixDocIds: string[];
  };
  kpiImpactDiagnostic: {
    rawEvaluationCount: number;
    deduplicatedPairCount: number;
    rawMeanScore: number | null;
    deduplicatedFirstSeenMeanScore: number | null;
    meanDelta: number | null;
  };
  duplicatePairs: DuplicatePairSummary[];
}

const EXPECTED_RATING_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

function anonymizeUid(uid: string): string {
  return createHash("sha256").update(`bu-eval-audit:${uid}`).digest("hex").slice(0, 12);
}

export function classifyEvaluationDocId(
  docId: string,
  courseId: unknown,
  userId: unknown
): EvaluationDocIdKind {
  if (typeof courseId !== "string" || !courseId || typeof userId !== "string" || !userId) {
    return "unverifiable_missing_keys";
  }
  try {
    const expected = buildEvaluationDocId(courseId, userId);
    if (docId === expected) {
      return "deterministic";
    }
  } catch {
    // Non-standard courseId or userId length/characters -> cannot match deterministic builder
  }
  if (docId.startsWith("eval_")) {
    return "mismatched_eval_prefix";
  }
  return "legacy_random";
}

export function validateEvaluationRatings(
  docId: string,
  ratings: unknown
): {
  missingOrInvalidField: boolean;
  invalidValueReasons: string[];
  averageScore: number | null;
} {
  if (ratings === null || ratings === undefined || typeof ratings !== "object") {
    return {
      missingOrInvalidField: true,
      invalidValueReasons: ["ratings field is missing or not an object/array"],
      averageScore: null,
    };
  }

  const reasons: string[] = [];
  let missingSlots = 0;
  let sum = 0;
  let validCount = 0;

  if (Array.isArray(ratings)) {
    if (ratings.length !== 10) {
      reasons.push(`legacy array length is ${ratings.length} (expected 10)`);
    }
    for (let i = 0; i < 10; i++) {
      const rawVal = ratings[i];
      if (rawVal === null || rawVal === undefined || rawVal === "") {
        missingSlots++;
        continue;
      }
      if (typeof rawVal !== "number" || !Number.isInteger(rawVal) || rawVal < 1 || rawVal > 5) {
        reasons.push(`slot[${i}] invalid value (${String(rawVal)})`);
      } else {
        sum += rawVal;
        validCount++;
      }
    }
  } else {
    const record = ratings as Record<string, unknown>;
    const keys = Object.keys(record);
    const extraKeys = keys.filter((k) => !(EXPECTED_RATING_KEYS as readonly string[]).includes(k));
    if (extraKeys.length > 0) {
      reasons.push(`unexpected keys: ${extraKeys.join(",")}`);
    }
    for (const key of EXPECTED_RATING_KEYS) {
      if (!(key in record) || record[key] === null || record[key] === undefined || record[key] === "") {
        missingSlots++;
        continue;
      }
      const rawVal = record[key];
      if (typeof rawVal !== "number" || !Number.isInteger(rawVal) || rawVal < 1 || rawVal > 5) {
        reasons.push(`slot['${key}'] invalid value (${String(rawVal)})`);
      } else {
        sum += rawVal;
        validCount++;
      }
    }
  }

  if (missingSlots === 10) {
    return {
      missingOrInvalidField: true,
      invalidValueReasons: ["all 10 rating slots are missing"],
      averageScore: null,
    };
  }

  if (missingSlots > 0) {
    reasons.push(`missing ${missingSlots} of 10 rating slots`);
  }

  return {
    missingOrInvalidField: false,
    invalidValueReasons: reasons,
    averageScore: validCount > 0 ? sum / validCount : null,
  };
}

interface PairAccumulator {
  courseId: string;
  userId: string;
  docIds: string[];
  deterministicCount: number;
  legacyCount: number;
  firstMean: number | null;
}

export class EvaluationAuditAccumulator {
  private readonly knownCourseIds?: Set<string>;
  private readonly knownUserIds?: Set<string>;
  private readonly maxSampleIds: number;

  private totalEvaluationDocs = 0;
  private legacyRandomIdDocs = 0;
  private deterministicIdDocs = 0;
  private mismatchedEvalPrefixDocs = 0;
  private unverifiableIdDocs = 0;

  private missingOrInvalidRatingFieldsCount = 0;
  private invalidRatingValuesCount = 0;
  private missingCourseIdFieldCount = 0;
  private missingUserIdFieldCount = 0;
  private orphanedCourseReferencesCount = 0;
  private unmatchedUserReferencesCount = 0;

  private sampleRatingFieldIssueDocIds: string[] = [];
  private sampleRatingValueIssues: RatingValidationIssue[] = [];
  private sampleMissingCourseIdDocIds: string[] = [];
  private sampleMissingUserIdDocIds: string[] = [];
  private sampleOrphanedCourseDocIds: string[] = [];
  private sampleUnmatchedUserDocIds: string[] = [];
  private sampleMismatchedEvalPrefixDocIds: string[] = [];

  private pairMap = new Map<string, PairAccumulator>();
  private rawMeanSum = 0;
  private rawMeanCount = 0;

  constructor(options: EvaluationAuditOptions = {}) {
    this.knownCourseIds = options.knownCourseIds;
    this.knownUserIds = options.knownUserIds;
    this.maxSampleIds = options.maxSampleIds ?? 50;
  }

  private pushSample(arr: string[], docId: string) {
    if (arr.length < this.maxSampleIds) arr.push(docId);
  }

  public addDocument(doc: RawEvaluationAuditRecord): void {
    this.totalEvaluationDocs++;

    const courseIdValid = typeof doc.courseId === "string" && doc.courseId.trim().length > 0;
    const userIdValid = typeof doc.userId === "string" && doc.userId.trim().length > 0;
    const courseIdStr = courseIdValid ? (doc.courseId as string) : "";
    const userIdStr = userIdValid ? (doc.userId as string) : "";

    if (!courseIdValid) {
      this.missingCourseIdFieldCount++;
      this.pushSample(this.sampleMissingCourseIdDocIds, doc.id);
    } else if (this.knownCourseIds && !this.knownCourseIds.has(courseIdStr)) {
      this.orphanedCourseReferencesCount++;
      this.pushSample(this.sampleOrphanedCourseDocIds, doc.id);
    }

    if (!userIdValid) {
      this.missingUserIdFieldCount++;
      this.pushSample(this.sampleMissingUserIdDocIds, doc.id);
    } else if (this.knownUserIds && !this.knownUserIds.has(userIdStr)) {
      this.unmatchedUserReferencesCount++;
      this.pushSample(this.sampleUnmatchedUserDocIds, doc.id);
    }

    const idKind = classifyEvaluationDocId(doc.id, doc.courseId, doc.userId);
    if (idKind === "deterministic") {
      this.deterministicIdDocs++;
    } else if (idKind === "legacy_random") {
      this.legacyRandomIdDocs++;
    } else if (idKind === "mismatched_eval_prefix") {
      this.mismatchedEvalPrefixDocs++;
      this.pushSample(this.sampleMismatchedEvalPrefixDocIds, doc.id);
    } else {
      this.unverifiableIdDocs++;
    }

    const ratingCheck = validateEvaluationRatings(doc.id, doc.ratings);
    if (ratingCheck.missingOrInvalidField) {
      this.missingOrInvalidRatingFieldsCount++;
      this.pushSample(this.sampleRatingFieldIssueDocIds, doc.id);
    } else if (ratingCheck.invalidValueReasons.length > 0) {
      this.invalidRatingValuesCount++;
      if (this.sampleRatingValueIssues.length < this.maxSampleIds) {
        this.sampleRatingValueIssues.push({
          docId: doc.id,
          issueType: "invalid_rating_value",
          reasons: ratingCheck.invalidValueReasons,
        });
      }
    }

    if (ratingCheck.averageScore !== null) {
      this.rawMeanSum += ratingCheck.averageScore;
      this.rawMeanCount++;
    }

    if (courseIdValid && userIdValid) {
      const pairKey = `${Array.from(courseIdStr).length}:${courseIdStr}:${userIdStr}`;
      let entry = this.pairMap.get(pairKey);
      if (!entry) {
        entry = {
          courseId: courseIdStr,
          userId: userIdStr,
          docIds: [],
          deterministicCount: 0,
          legacyCount: 0,
          firstMean: ratingCheck.averageScore,
        };
        this.pairMap.set(pairKey, entry);
      }
      entry.docIds.push(doc.id);
      if (idKind === "deterministic") entry.deterministicCount++;
      else if (idKind === "legacy_random") entry.legacyCount++;
    }
  }

  public buildReport(): EvaluationAuditReport {
    const duplicatePairs: DuplicatePairSummary[] = [];
    let excessDuplicateDocs = 0;
    let dedupSum = 0;
    let dedupCount = 0;

    for (const entry of this.pairMap.values()) {
      if (entry.firstMean !== null) {
        dedupSum += entry.firstMean;
        dedupCount++;
      }
      if (entry.docIds.length > 1) {
        const excess = entry.docIds.length - 1;
        excessDuplicateDocs += excess;
        duplicatePairs.push({
          courseId: entry.courseId,
          userHash: anonymizeUid(entry.userId),
          count: entry.docIds.length,
          excessCount: excess,
          docIds: [...entry.docIds],
          deterministicCount: entry.deterministicCount,
          legacyCount: entry.legacyCount,
        });
      }
    }

    duplicatePairs.sort((a, b) => b.count - a.count || a.courseId.localeCompare(b.courseId));

    const rawMean = this.rawMeanCount > 0 ? Number((this.rawMeanSum / this.rawMeanCount).toFixed(4)) : null;
    const dedupMean = dedupCount > 0 ? Number((dedupSum / dedupCount).toFixed(4)) : null;
    const meanDelta =
      rawMean !== null && dedupMean !== null ? Number((rawMean - dedupMean).toFixed(4)) : null;

    return {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      piiRedacted: true,
      totals: {
        totalEvaluationDocs: this.totalEvaluationDocs,
        uniqueCourseUserPairs: this.pairMap.size,
        duplicateCourseUserPairs: duplicatePairs.length,
        excessDuplicateDocs,
        legacyRandomIdDocs: this.legacyRandomIdDocs,
        deterministicIdDocs: this.deterministicIdDocs,
        mismatchedEvalPrefixDocs: this.mismatchedEvalPrefixDocs,
        unverifiableIdDocs: this.unverifiableIdDocs,
      },
      dataIntegrity: {
        missingOrInvalidRatingFieldsCount: this.missingOrInvalidRatingFieldsCount,
        invalidRatingValuesCount: this.invalidRatingValuesCount,
        missingCourseIdFieldCount: this.missingCourseIdFieldCount,
        missingUserIdFieldCount: this.missingUserIdFieldCount,
        orphanedCourseReferencesCount: this.knownCourseIds ? this.orphanedCourseReferencesCount : null,
        unmatchedUserReferencesCount: this.knownUserIds ? this.unmatchedUserReferencesCount : null,
        sampleRatingFieldIssueDocIds: this.sampleRatingFieldIssueDocIds,
        sampleRatingValueIssues: this.sampleRatingValueIssues,
        sampleMissingCourseIdDocIds: this.sampleMissingCourseIdDocIds,
        sampleMissingUserIdDocIds: this.sampleMissingUserIdDocIds,
        sampleOrphanedCourseDocIds: this.sampleOrphanedCourseDocIds,
        sampleUnmatchedUserDocIds: this.sampleUnmatchedUserDocIds,
        sampleMismatchedEvalPrefixDocIds: this.sampleMismatchedEvalPrefixDocIds,
      },
      kpiImpactDiagnostic: {
        rawEvaluationCount: this.rawMeanCount,
        deduplicatedPairCount: dedupCount,
        rawMeanScore: rawMean,
        deduplicatedFirstSeenMeanScore: dedupMean,
        meanDelta,
      },
      duplicatePairs,
    };
  }
}

export function auditEvaluationDataset(
  docs: RawEvaluationAuditRecord[],
  options: EvaluationAuditOptions = {}
): EvaluationAuditReport {
  const accumulator = new EvaluationAuditAccumulator(options);
  for (const doc of docs) {
    accumulator.addDocument(doc);
  }
  return accumulator.buildReport();
}
