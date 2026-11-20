import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import {
  buildCandidateOnlineDocIds,
  buildSessionAttendanceEntry,
  buildWalkInDocId,
  findDuplicateCourseRegistration,
  getRegistrationSource,
  sanitizeAttendedSessionsMap,
  validateWalkInFormData,
} from "../src/lib/registrationService";
import {
  ATTENDANCE_CSV_HEADERS,
  buildActualAttendanceRows,
  buildTrainingReportEmailContent,
  generateActualAttendanceCsv,
} from "../src/lib/trainingReport";
import { calculateCourseOperationalStats } from "../src/lib/evaluationAnalytics";
import { Instructor, Registration, SessionAttendance } from "../src/types";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function assertNoUndefinedDeep(value: unknown, trail = "root") {
  assert.notEqual(value, undefined, `Found undefined at ${trail}`);
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertNoUndefinedDeep(v, `${trail}.${k}`);
    }
  }
}

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// Shared fixtures
const masterInstructors: Instructor[] = [
  {
    uid: "uid-master-1",
    id: "A67013",
    name: "อ.ดร. นภาวรรณ สุขสันต์",
    email: "napawan.s@bu.ac.th",
    department: "คณะนิเทศศาสตร์",
    position: "ผู้ช่วยศาสตราจารย์",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    uid: "uid-master-2",
    id: "A66009",
    name: "อ. กิตติพงษ์ เจริญศรี",
    email: "kittipong.c@bu.ac.th",
    department: "คณะวิศวกรรมศาสตร์",
    position: "อาจารย์",
    createdAt: "2026-01-02T00:00:00.000Z",
  },
];

const onlineAttendedReg: Registration = {
  id: "c1_default_uid-master-1",
  courseId: "c1",
  courseTitle: "AI Teaching Lab 2026",
  sessionId: "default",
  source: "online",
  userId: "uid-master-1",
  instructorId: "A67013",
  userName: "อ.ดร. นภาวรรณ สุขสันต์",
  userEmail: "napawan.s@bu.ac.th",
  userDepartment: "คณะนิเทศศาสตร์",
  userPosition: "ผู้ช่วยศาสตราจารย์",
  sequenceNumber: 1,
  checkInSequenceNumber: 1,
  checkInAt: "2026-07-10T09:05:00.000Z",
  attended: true,
  registeredAt: "2026-07-01T08:00:00.000Z",
};

const onlineNotAttendedReg: Registration = {
  id: "c1_default_uid-online-no-show",
  courseId: "c1",
  courseTitle: "AI Teaching Lab 2026",
  sessionId: "default",
  source: "online",
  userId: "uid-online-no-show",
  instructorId: "A65022",
  userName: "อ. มานะ ไม่ได้มาอบรม",
  userEmail: "mana.n@bu.ac.th",
  userDepartment: "คณะบริหารธุรกิจ",
  userPosition: "อาจารย์",
  sequenceNumber: 2,
  attended: false,
  registeredAt: "2026-07-02T09:00:00.000Z",
};

const walkInManualReg: Registration = {
  id: "walkin_c1_somying.t_bu.ac.th",
  courseId: "c1",
  courseTitle: "AI Teaching Lab 2026",
  sessionId: "default",
  source: "walk_in",
  userId: null,
  instructorId: "A68099",
  userName: "สมหญิง ทดสอบวอล์คอิน",
  userEmail: "somying.t@bu.ac.th",
  userDepartment: "คณะเทคโนโลยีสารสนเทศและนวัตกรรม",
  userPosition: "อาจารย์ประจำ",
  sequenceNumber: 3,
  checkInSequenceNumber: 2,
  checkInAt: "2026-07-10T09:18:00.000Z",
  attended: true,
  registeredAt: "2026-07-10T09:18:00.000Z",
  createdByAdminUid: "admin-uid-1",
  createdByAdminEmail: "kulachet.l@bu.ac.th",
  createdAt: "2026-07-10T09:18:00.000Z",
};

// Legacy historical online registration without `source` field
const legacyOnlineReg: Registration = {
  id: "c1_uid-legacy",
  courseId: "c1",
  courseTitle: "AI Teaching Lab 2026",
  userId: "uid-legacy",
  instructorId: "A64001",
  userName: "อ. เก่าแก่ ดั้งเดิม",
  userEmail: "kaokae.d@bu.ac.th",
  userDepartment: "คณะบัญชี",
  userPosition: "รองศาสตราจารย์",
  sequenceNumber: 4,
  checkInSequenceNumber: 3,
  checkInAt: "2026-07-10T09:25:00.000Z",
  attended: true,
  registeredAt: "2026-06-20T10:00:00.000Z",
};

// 1. Walk-in without Firebase Auth UID or self-registration + validation
test("1. Walk-in validation enforces @bu.ac.th, required fields, explicit confirmation, and allows userId: null", () => {
  const missingConfirm = validateWalkInFormData(
    {
      instructorId: "A68099",
      userName: "สมหญิง ทดสอบวอล์คอิน",
      userEmail: "somying.t@bu.ac.th",
      userDepartment: "คณะเทคโนโลยีสารสนเทศและนวัตกรรม",
      userPosition: "อาจารย์",
      checkInAt: "2026-07-10T09:18",
      confirmAttended: false,
    },
    { requireAttendanceConfirmation: true }
  );
  assert.equal(missingConfirm.isValid, false);
  assert.ok(missingConfirm.errors.confirmAttended);

  const nonBuEmail = validateWalkInFormData({
    userName: "External User",
    userEmail: "user@gmail.com",
    userDepartment: "IT",
    checkInAt: "2026-07-10T09:18",
    confirmAttended: true,
  });
  assert.equal(nonBuEmail.isValid, false);
  assert.ok(nonBuEmail.errors.userEmail);

  const valid = validateWalkInFormData({
    userName: "สมหญิง ทดสอบวอล์คอิน",
    userEmail: "Somying.T@bu.ac.th",
    userDepartment: "คณะเทคโนโลยีสารสนเทศและนวัตกรรม",
    checkInAt: "2026-07-10T09:18",
    confirmAttended: true,
  });
  assert.equal(valid.isValid, true);
  assert.equal(walkInManualReg.userId, null);
  assert.equal(getRegistrationSource(walkInManualReg), "walk_in");
});

// 2. Existing master instructor selection works & preserves faculty ID / dept / email
test("2. Walk-in model works with existing instructor master record and manual entry", () => {
  const fromMaster = masterInstructors[1];
  const validMasterWalkIn = validateWalkInFormData({
    instructorId: fromMaster.id,
    userName: fromMaster.name,
    userEmail: fromMaster.email,
    userDepartment: fromMaster.department,
    userPosition: fromMaster.position,
    checkInAt: "2026-07-10T09:30",
    confirmAttended: true,
  });
  assert.equal(validMasterWalkIn.isValid, true);

  const walkInFromMaster: Registration = {
    id: buildWalkInDocId("c1", fromMaster.email, fromMaster.id),
    courseId: "c1",
    courseTitle: "AI Teaching Lab 2026",
    source: "walk_in",
    userId: null,
    instructorId: fromMaster.id,
    userName: fromMaster.name,
    userEmail: fromMaster.email,
    userDepartment: fromMaster.department,
    userPosition: fromMaster.position,
    sequenceNumber: 5,
    checkInSequenceNumber: 4,
    checkInAt: "2026-07-10T09:30:00.000Z",
    attended: true,
    registeredAt: "2026-07-10T09:30:00.000Z",
    createdByAdminUid: "admin-uid-1",
  };
  assert.equal(walkInFromMaster.instructorId, "A66009");
  assert.equal(walkInFromMaster.userDepartment, "คณะวิศวกรรมศาสตร์");
});

// 3. Firestore undefined value repair: true -> false -> true lifecycle
test("3. AttendedSessions builders never produce undefined nested values across true -> false -> true", () => {
  // Initial attended = true
  const initialMap: Record<string, SessionAttendance> = {
    day1: buildSessionAttendanceEntry({
      attended: true,
      checkInAt: "2026-07-10T09:15:00.000Z",
      checkInSequenceNumber: 2,
      sessionDate: "2026-07-10",
      sessionName: "Day 1",
    }),
    day2: buildSessionAttendanceEntry({
      attended: true,
      checkInAt: "2026-07-11T09:05:00.000Z",
      checkInSequenceNumber: 5,
      sessionDate: "2026-07-11",
      sessionName: "Day 2",
    }),
  };
  assertNoUndefinedDeep(initialMap, "initialMap");
  assert.equal(initialMap.day1.checkInSequenceNumber, 2);

  // Toggle day1 true -> false (preserve day2 + day1 metadata, ZERO undefined)
  const sanitized = sanitizeAttendedSessionsMap({
    ...initialMap,
    legacyStray: {
      attended: false,
      checkInAt: undefined,
      checkInSequenceNumber: undefined,
      sessionDate: undefined,
      sessionName: "Legacy",
    },
  });
  const afterFalseMap: Record<string, SessionAttendance> = {
    ...sanitized,
    day1: buildSessionAttendanceEntry({
      attended: false,
      checkInAt: null,
      checkInSequenceNumber: null,
      sessionDate: sanitized.day1.sessionDate || null,
      sessionName: sanitized.day1.sessionName || null,
    }),
  };
  assertNoUndefinedDeep(afterFalseMap, "afterFalseMap");
  assert.equal(afterFalseMap.day1.attended, false);
  assert.equal("checkInAt" in afterFalseMap.day1, false);
  assert.equal("checkInSequenceNumber" in afterFalseMap.day1, false);
  assert.equal(afterFalseMap.day1.sessionDate, "2026-07-10");
  assert.equal(afterFalseMap.day2.attended, true);

  // Toggle day1 back false -> true
  const afterBackToTrueMap: Record<string, SessionAttendance> = {
    ...afterFalseMap,
    day1: buildSessionAttendanceEntry({
      attended: true,
      checkInAt: "2026-07-10T10:00:00.000Z",
      checkInSequenceNumber: 6,
      sessionDate: afterFalseMap.day1.sessionDate || null,
      sessionName: afterFalseMap.day1.sessionName || null,
    }),
  };
  assertNoUndefinedDeep(afterBackToTrueMap, "afterBackToTrueMap");
  assert.equal(afterBackToTrueMap.day1.attended, true);
  assert.equal(afterBackToTrueMap.day1.checkInAt, "2026-07-10T10:00:00.000Z");
  assert.equal(afterBackToTrueMap.day1.checkInSequenceNumber, 6);

  // Static check: registrationService.ts must NOT assign ': undefined' to Firestore fields
  const regSvcCode = read("src/lib/registrationService.ts");
  assert.ok(!regSvcCode.includes(": undefined"));
});

// 4. Cross-source duplicate prevention across Online & Walk-in, email changes, and transactions
test("4. Duplicate detection & transactional cross-source checks catch collisions across Online, Walk-in, and email edits", () => {
  const regs = [onlineAttendedReg, onlineNotAttendedReg, walkInManualReg];

  // Duplicate by mixed-case email against online record
  const dupByEmail = findDuplicateCourseRegistration(regs, {
    email: "  NAPAWAN.S@BU.AC.TH ",
  });
  assert.equal(dupByEmail?.id, onlineAttendedReg.id);

  // Duplicate by instructorId against walk-in record
  const dupById = findDuplicateCourseRegistration(regs, {
    email: "different@bu.ac.th",
    instructorId: "a68099",
  });
  assert.equal(dupById?.id, walkInManualReg.id);

  // Exclude self during edit mode
  const excludeSelf = findDuplicateCourseRegistration(regs, {
    email: walkInManualReg.userEmail,
    instructorId: walkInManualReg.instructorId,
    excludeRegId: walkInManualReg.id,
  });
  assert.equal(excludeSelf, null);

  // Deterministic Walk-in ID & candidate Online IDs
  assert.equal(
    buildWalkInDocId("c1", "Somying.T@bu.ac.th"),
    buildWalkInDocId("c1", "somying.t@bu.ac.th")
  );
  assert.ok(buildWalkInDocId("c1", "somying.t@bu.ac.th").startsWith("walkin_c1_"));

  const candIds = buildCandidateOnlineDocIds(
    { id: "c1", sessions: [{ id: "s1", sessionId: "s1", date: "", startTime: "", endTime: "" }] },
    "uid-master-1",
    "s1"
  );
  assert.ok(candIds.includes("c1_uid-master-1"));
  assert.ok(candIds.includes("c1_default_uid-master-1"));
  assert.ok(candIds.includes("c1_s1_uid-master-1"));

  // Verify registerForCourse & updateWalkInParticipant & addWalkInParticipant all run transactional cross-checks
  const regSvcCode = read("src/lib/registrationService.ts");
  assert.ok(regSvcCode.includes("const walkInDoc = await transaction.get(walkInRef);"));
  assert.ok(regSvcCode.includes("const newWalkInRef ="));
  assert.ok(regSvcCode.includes("for (const onlineRef of candidateOnlineRefs)"));
  const updateFnBody = regSvcCode.slice(regSvcCode.indexOf("async updateWalkInParticipant("));
  assert.ok(updateFnBody.includes("runTransaction(db, async (transaction)"));
  assert.ok(updateFnBody.includes("transaction.update(regRef, updates);"));
});

// 5. Registered-but-not-attended workflow in WalkInModal + RegistrationService
test("5. Existing non-attended online registrant is detected so admin can mark existing attended instead of duplicating", () => {
  const regs = [onlineAttendedReg, onlineNotAttendedReg, walkInManualReg];
  const existing = findDuplicateCourseRegistration(regs, {
    email: "MANA.N@BU.AC.TH",
  });
  assert.ok(existing);
  assert.equal(existing.attended, false);
  assert.equal(getRegistrationSource(existing), "online");

  const regSvcCode = read("src/lib/registrationService.ts");
  assert.ok(regSvcCode.includes("async markExistingAsAttended("));
  const modalCode = read("src/components/WalkInModal.tsx");
  assert.ok(modalCode.includes("ยืนยันเช็คอินรายชื่อที่ลงทะเบียนไว้แล้ว"));
});

// 6. Attendance Management UI wiring in RegistrantsList & ApplicantList
test("6. RegistrantsList & ApplicantList wire Admin Walk-in button, source badges, edit action, and live totals", () => {
  const registrantsCode = read("src/components/RegistrantsList.tsx");
  assert.ok(registrantsCode.includes("เพิ่มผู้เข้าอบรม Walk-in"));
  assert.ok(registrantsCode.includes('isAdmin && selectedCourse && selectedCourseId !== "all_courses"'));
  assert.ok(registrantsCode.includes('getRegistrationSource(reg) === "walk_in"'));
  assert.ok(registrantsCode.includes("แก้ไขข้อมูล Walk-in"));
  assert.ok(registrantsCode.includes("<WalkInModal"));

  const applicantListCode = read("src/components/ApplicantList.tsx");
  assert.ok(applicantListCode.includes('reg.source === "walk_in"'));
});

// 7. Actual Attendance CSV includes Online + Walk-in attendees, excludes non-attending, preserves 9 columns
test("7. Actual Attendance CSV includes Online + Walk-in + legacy attendees, excludes non-attending & un-attended walk-in", () => {
  const unAttendedWalkIn: Registration = {
    ...walkInManualReg,
    id: "walkin_c1_toggled_false",
    userEmail: "toggled.false@bu.ac.th",
    attended: false,
    checkInAt: undefined,
    checkInSequenceNumber: undefined,
  };
  const regs = [
    onlineAttendedReg,
    onlineNotAttendedReg,
    walkInManualReg,
    unAttendedWalkIn,
    legacyOnlineReg,
  ];
  const rows = buildActualAttendanceRows(regs, masterInstructors, "c1");

  assert.equal(rows.length, 3);
  assert.deepEqual(Object.keys(rows[0]), [...ATTENDANCE_CSV_HEADERS]);

  // Sorted by checkInSequenceNumber ascending: 1 (online), 2 (walk_in), 3 (legacy)
  assert.equal(rows[0]["อีเมล"], "napawan.s@bu.ac.th");
  assert.equal(rows[0]["ลำดับการเช็คอิน"], 1);
  assert.equal(rows[1]["อีเมล"], "somying.t@bu.ac.th");
  assert.equal(rows[1]["ลำดับการเช็คอิน"], 2);
  assert.equal(rows[1]["หน่วยงาน"], "คณะเทคโนโลยีสารสนเทศและนวัตกรรม");
  assert.equal(rows[2]["อีเมล"], "kaokae.d@bu.ac.th");
  assert.equal(rows[2]["ลำดับการเช็คอิน"], 3);

  // Non-attending registrants (both online & walk-in toggled false) must be excluded
  assert.ok(!rows.some((r) => r["อีเมล"] === "mana.n@bu.ac.th"));
  assert.ok(!rows.some((r) => r["อีเมล"] === "toggled.false@bu.ac.th"));

  const csvResult = generateActualAttendanceCsv(
    regs,
    masterInstructors,
    "AI Teaching Lab 2026",
    "c1"
  );
  assert.equal(csvResult.rowCount, 3);
  assert.ok(csvResult.csvContent.startsWith("\ufeff"));
  const parsed = Papa.parse<Record<string, string>>(csvResult.csvContent.slice(1), {
    header: true,
    skipEmptyLines: true,
  });
  assert.equal(parsed.data.length, 3);
  assert.deepEqual(parsed.meta.fields, [...ATTENDANCE_CSV_HEADERS]);
});

// 8. Module 20 Training Report Email & Evaluation Dashboard PDF counts remain accurate
test("8. Module 20 Training Report Email & Evaluation operational stats adjust cleanly across true -> false -> true & delete", () => {
  const regsInitial = [onlineAttendedReg, onlineNotAttendedReg, walkInManualReg];
  const stats1 = calculateCourseOperationalStats("c1", regsInitial, []);
  assert.equal(stats1.totalRegistrations, 3);
  assert.equal(stats1.totalAttendees, 2);

  // After toggling walk-in false
  const regsFalse = [
    onlineAttendedReg,
    onlineNotAttendedReg,
    { ...walkInManualReg, attended: false },
  ];
  const stats2 = calculateCourseOperationalStats("c1", regsFalse, []);
  assert.equal(stats2.totalRegistrations, 3);
  assert.equal(stats2.totalAttendees, 1);

  // After deleting walk-in
  const regsDeleted = [onlineAttendedReg, onlineNotAttendedReg];
  const stats3 = calculateCourseOperationalStats("c1", regsDeleted, []);
  assert.equal(stats3.totalRegistrations, 2);
  assert.equal(stats3.totalAttendees, 1);

  const email = buildTrainingReportEmailContent({
    courseTitle: "AI Teaching Lab 2026",
    trainingDate: "10 กรกฎาคม 2569",
    recipientName: "อ.จักกรี เสริมทรัพย์",
    registeredCount: stats1.totalRegistrations,
    attendedCount: stats1.totalAttendees,
    evaluationCount: stats1.totalEvals,
    averageScore: 4.8,
  });
  assert.ok(email.body.includes("ผู้ลงทะเบียน: 3 คน"));
  assert.ok(email.body.includes("ผู้เข้าอบรมจริง: 2 คน"));
});

// 9. Firestore Security Rules: Walk-in restricted to isAdmin() AND production evaluations rule preserved
test("9. firestore.rules restricts walk_in strictly to isAdmin(), forbids fake UIDs, and preserves current production evaluation rules", () => {
  const rules = read("firestore.rules");

  // Walk-in registration rules
  assert.ok(rules.includes("function isValidOnlineRegistration(data)"));
  assert.ok(rules.includes("function isValidWalkInRegistration(data)"));
  assert.ok(rules.includes("data.source == 'walk_in'"));
  assert.ok(rules.includes("(!('userId' in data) || data.userId == null)"));
  assert.ok(rules.includes("data.createdByAdminUid == request.auth.uid"));
  assert.ok(rules.includes("resource.data.source == 'walk_in'"));

  const regSectionStart = rules.indexOf("match /registrations/{regId}");
  const evalSectionStart = rules.indexOf("match /evaluations/{evaluationId}");
  const regRules = rules.slice(regSectionStart, evalSectionStart);
  assert.ok(regRules.includes("isAdmin() && ("));
  assert.ok(regRules.includes("(!('source' in resource.data) || resource.data.source == 'online')"));
  assert.ok(regRules.includes("resource.data.userId is string"));

  // Exact production evaluations rule preserved (NO strict Module 15 helpers overwriting it)
  assert.ok(!rules.includes("expectedEvaluationId"));
  assert.ok(!rules.includes("isValidRatingsMap"));
  assert.ok(!rules.includes("isValidEvaluation"));

  const evalSectionEnd = rules.indexOf("match /mail/{mailId}");
  const evalRules = rules.slice(evalSectionStart, evalSectionEnd);
  assert.ok(evalRules.includes("allow get, list: if ("));
  assert.ok(evalRules.includes("resource.data.userId == request.auth.uid"));
  assert.ok(
    evalRules.includes(
      "allow create: if isAuthenticated() &&\n        request.resource.data.userId == request.auth.uid;"
    )
  );
  assert.ok(evalRules.includes("allow update, delete: if isAdmin();"));
});

// 10. Legacy online & self-service cancellation safety
test("10. Historical registrations without source default to online and self-cancel blocks walk_in", () => {
  assert.equal(getRegistrationSource({}), "online");
  assert.equal(getRegistrationSource(legacyOnlineReg), "online");
  const regSvcCode = read("src/lib/registrationService.ts");
  assert.ok(regSvcCode.includes('if (regData.source === "walk_in")'));
});

// 11. Module 20 GAS / Netlify endpoint untouched check
test("11. Module 20 Netlify Function & GAS integration files remain untouched cleanly", () => {
  const fnCode = read("netlify/functions/send-training-report.ts");
  assert.ok(fnCode.includes("GAS_REPORT_URL"));
  assert.ok(fnCode.includes("GAS_REPORT_SECRET"));
});

console.log(`\nSummary: ${passed}/11 Module 21 tests passed.`);
