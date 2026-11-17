/**
 * MODULE 19 — Instructor Faculty / Department Editing Verification Suite
 *
 * Verifies:
 * 1. InstructorModal uses a real <select> dropdown bound to `formData.department` via `onChange`,
 *    sourced dynamically from `allInstructors` (no hardcoded incomplete list), deduplicated, and
 *    preserving legacy saved department values without silent overwrites.
 * 2. InstructorService.validate validates `department` cleanly and rejects empty/whitespace values
 *    while permitting editing existing instructors without false duplicate errors.
 * 3. InstructorService.updateInstructor preserves unrelated fields (uid, id, englishFullName,
 *    englishNameVerified) when updating department in place on `instructors/{oldDocId}`.
 * 4. firestore.rules permits Admin department updates while blocking unauthorized cross-user writes
 *    and preserving English-name verification restrictions for non-admins.
 */
import fs from "fs";
import path from "path";
import { InstructorService } from "../src/lib/instructorService";
import { Instructor } from "../src/types";

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

console.log("=== MODULE 19 INSTRUCTOR DEPARTMENT EDITING SUITE ===\n");

const root = process.cwd();
const modalText = fs.readFileSync(path.resolve(root, "src/components/InstructorModal.tsx"), "utf8");
const serviceText = fs.readFileSync(path.resolve(root, "src/lib/instructorService.ts"), "utf8");
const rulesText = fs.readFileSync(path.resolve(root, "firestore.rules"), "utf8");

// 1. UI Dropdown Structure & Option Handling
assert(
  modalText.includes("<select") &&
    modalText.includes('id="instructor-department-field"') &&
    modalText.includes("value={formData.department}") &&
    !modalText.includes('list="departments-list"'),
  "InstructorModal uses a <select> dropdown bound to formData.department (replaces datalist input)"
);
assert(
  modalText.includes('handleChange("department", selected)') &&
    modalText.includes("disabled={submitting}"),
  "Dropdown onChange updates formData.department immediately and is only disabled while submitting"
);
assert(
  modalText.includes("allInstructors.forEach") &&
    modalText.includes("new Set<string>()") &&
    modalText.includes("if (trimmedSaved && !options.includes(trimmedSaved))"),
  "Options source derives deduplicated departments from allInstructors and preserves legacy saved values"
);
assert(
  modalText.includes("__CUSTOM_DEPARTMENT__") && modalText.includes("เลือกจากรายการ"),
  "Supports custom department input fallback without removing dropdown selection"
);

// 2. Service Validation & Update Logic
const sampleInstructors: Instructor[] = [
  {
    firebaseId: "uid-doc-1",
    uid: "uid-doc-1",
    id: "A67001",
    name: "อ.สมชาย ใจดี",
    email: "somchai.j@bu.ac.th",
    department: "คณะเทคโนโลยีสารสนเทศและนวัตกรรม",
    position: "อาจารย์ประจำ",
    englishFullName: "Somchai Jaidee",
    englishNameVerified: true,
  },
  {
    firebaseId: "A67002",
    id: "A67002",
    name: "ดร.สมหญิง รักเรียน",
    email: "somying.r@bu.ac.th",
    department: "คณะบริหารธุรกิจ",
    position: "ผู้ช่วยศาสตราจารย์",
  },
];

{
  const validEdit = InstructorService.validate(
    {
      id: "A67001",
      name: "อ.สมชาย ใจดี",
      email: "somchai.j@bu.ac.th",
      department: "คณะบริหารธุรกิจ",
      position: "อาจารย์ประจำ",
      englishFullName: "Somchai Jaidee",
      englishNameVerified: true,
    },
    sampleInstructors,
    "A67001"
  );
  assert(validEdit.isValid, "Validation accepts changing department to another valid faculty");

  const validLegacyEdit = InstructorService.validate(
    {
      id: "A67001",
      name: "อ.สมชาย ใจดี",
      email: "somchai.j@bu.ac.th",
      department: "หน่วยงานเดิม (Legacy Center)",
      position: "อาจารย์ประจำ",
    },
    sampleInstructors,
    "A67001"
  );
  assert(validLegacyEdit.isValid, "Validation accepts legacy or custom department strings");

  const emptyDept = InstructorService.validate(
    {
      id: "A67001",
      name: "อ.สมชาย ใจดี",
      email: "somchai.j@bu.ac.th",
      department: "   ",
      position: "อาจารย์ประจำ",
    },
    sampleInstructors,
    "A67001"
  );
  assert(!emptyDept.isValid && Boolean(emptyDept.errors.department), "Validation rejects empty/whitespace department");
}

// 3. Static Firestore Update Payload & Rules Integrity
assert(
  serviceText.includes("const targetRef = doc(db, \"instructors\", oldDocId);") &&
    serviceText.includes("department: cleanDept,") &&
    serviceText.includes("await setDoc(targetRef, updateData, { merge: true });") &&
    serviceText.includes("isEnglishFieldsChanged"),
  "updateInstructor updates instructors/{oldDocId} in place with department and preserves untouched English-name verification fields"
);
assert(
  rulesText.includes("match /instructors/{instructorId}") &&
    rulesText.includes("data.department is string && data.department.size() > 0") &&
    rulesText.includes("isAdmin() || (") &&
    rulesText.includes("!request.resource.data.diff(resource.data).affectedKeys().hasAny(['englishNameVerified'])") &&
    rulesText.includes("!request.resource.data.diff(resource.data).affectedKeys().hasAny(['englishFullName'])"),
  "firestore.rules permits admin department updates, blocks unauthorized edits, and enforces English-name verification protection"
);

console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
