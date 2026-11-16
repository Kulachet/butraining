/**
 * Constructs an unambiguous, collision-free, Firestore-compatible evaluation document ID
 * derived from `courseId` and the authenticated user's `uid`.
 *
 * Format: `eval_<codePointLength(courseId)>_<courseId>_<uid>`
 *
 * Why length-prefixing:
 * Plain concatenation (`${courseId}_${uid}`) is ambiguous if either identifier contains `_`.
 * Prefixing with the exact Unicode code-point length of `courseId` guarantees injectivity:
 * two distinct `(courseId, uid)` pairs can never produce the same document ID, and the
 * exact same formula is enforced server-side in `firestore.rules` via `expectedEvaluationId()`.
 */
export function buildEvaluationDocId(courseId: string, uid: string): string {
  if (typeof courseId !== "string" || typeof uid !== "string") {
    throw new Error("Invalid arguments for evaluation document ID.");
  }
  if (courseId.includes("/") || uid.includes("/")) {
    throw new Error("Evaluation document ID components cannot contain '/'.");
  }
  const courseCodePointLength = Array.from(courseId).length;
  const uidCodePointLength = Array.from(uid).length;
  if (courseCodePointLength === 0 || courseCodePointLength > 128) {
    throw new Error("Invalid courseId for evaluation document ID.");
  }
  if (uidCodePointLength === 0 || uidCodePointLength > 128) {
    throw new Error("Invalid uid for evaluation document ID.");
  }
  return `eval_${courseCodePointLength}_${courseId}_${uid}`;
}
