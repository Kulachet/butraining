/**
 * Module 20 Automated Regression & Security Verification Suite
 * Tests Training Attendance & Evaluation Report Email without sending real emails
 * or mutating production Firestore.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import {
  ATTENDANCE_CSV_HEADERS,
  buildActualAttendanceRows,
  buildTrainingReportEmailContent,
  createTrainingReportRequestId,
  DEFAULT_REPORT_RECIPIENT_EMAIL,
  DEFAULT_REPORT_RECIPIENT_NAME,
  dispatchTrainingReportEmail,
  generateActualAttendanceCsv,
  isValidBuRecipientEmail,
  validateTrainingReportAttachments,
} from "../src/lib/trainingReport";
import { analyzeEvaluations, calculateCourseOperationalStats, DEFAULT_QUESTIONS } from "../src/lib/evaluationAnalytics";
import {
  handler as reportHandler,
  isValidBuEmail,
  validateAttachmentPayload,
} from "../netlify/functions/send-training-report";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`FAIL: ${name} -> ${err?.message || err}`);
    failed++;
  }
}

const ROOT = process.cwd();

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

async function run() {
  console.log("=== Running Module 20 Training Attendance & Evaluation Report Tests ===");

  await test("1. Default recipient constants match required BU staff details", () => {
    assert.equal(DEFAULT_REPORT_RECIPIENT_NAME, "อ.จักกรี เสริมทรัพย์");
    assert.equal(DEFAULT_REPORT_RECIPIENT_EMAIL, "jakree.s@bu.ac.th");
    assert.equal(isValidBuRecipientEmail(DEFAULT_REPORT_RECIPIENT_EMAIL), true);
    assert.equal(isValidBuRecipientEmail("someone@gmail.com"), false);
  });

  await test("2. Actual attendance CSV strictly includes attended=true and excludes non-attendees", () => {
    const registrations = [
      {
        id: "r1",
        courseId: "c1",
        userId: "u1",
        userName: "สมชาย ใจดี",
        userEmail: "somchai.j@bu.ac.th",
        userDepartment: "คณะวิศวกรรมศาสตร์",
        userPosition: "อาจารย์",
        sequenceNumber: 1,
        checkInSequenceNumber: 2,
        attended: true,
        checkInAt: "2026-08-01T09:15:00.000Z",
      },
      {
        id: "r2",
        courseId: "c1",
        userId: "u2",
        userName: "สมหญิง ไม่มาอบรม",
        userEmail: "somying.m@bu.ac.th",
        userDepartment: "คณะบริหารธุรกิจ",
        userPosition: "อาจารย์",
        sequenceNumber: 2,
        attended: false,
      },
      {
        id: "r3",
        courseId: "c1",
        userId: "u3",
        userName: "วิชัย มาก่อน",
        userEmail: "wichai.k@bu.ac.th",
        userDepartment: "คณะนิเทศศาสตร์",
        userPosition: "ผศ.",
        sequenceNumber: 3,
        checkInSequenceNumber: 1,
        attended: true,
        checkInAt: "2026-08-01T08:50:00.000Z",
      },
      {
        id: "r4",
        courseId: "c2", // Different course
        userId: "u4",
        userName: "คนละหลักสูตร",
        userEmail: "other.c@bu.ac.th",
        userDepartment: "คณะศิลปกรรมศาสตร์",
        userPosition: "อาจารย์",
        sequenceNumber: 1,
        checkInSequenceNumber: 1,
        attended: true,
      },
    ];

    const instructors = [
      {
        id: "INST-003",
        name: "วิชัย มาก่อน",
        position: "ผศ.",
        email: "wichai.k@bu.ac.th",
      },
    ];

    const rows = buildActualAttendanceRows(registrations as any, instructors as any, "c1");
    assert.equal(rows.length, 2, "Must exclude absent registrant r2 and other course r4");
    assert.equal(rows[0]["ลำดับการเช็คอิน"], 1, "Must sort by checkInSequenceNumber ascending");
    assert.equal(rows[1]["ลำดับการเช็คอิน"], 2);
    assert.equal(rows[0]["ลำดับที่ (ใบประกาศ)"], 1);
    assert.equal(rows[1]["ลำดับที่ (ใบประกาศ)"], 2);
    assert.equal(rows[0]["รหัสอาจารย์"], "INST-003");
    assert.equal(rows[1]["รหัสอาจารย์"], "-");
  });

  await test("3. CSV output includes UTF-8 BOM, exact 9 columns, and formula injection defense", () => {
    const registrations = [
      {
        id: "r1",
        courseId: "c1",
        userName: "สมชาย ใจดี",
        userEmail: "test.user@bu.ac.th",
        userDepartment: "=cmd|' /C calc'!A0",
        userPosition: "อาจารย์",
        sequenceNumber: 1,
        checkInSequenceNumber: 1,
        attended: true,
      },
    ];
    const generated = generateActualAttendanceCsv(registrations as any, [], "AI Workshop 2026", "c1");
    assert.ok(generated.csvContent.startsWith("\ufeff"), "Must include UTF-8 BOM");
    const parsed = Papa.parse<Record<string, string>>(generated.csvContent.replace(/^\ufeff/, ""), {
      header: true,
    });
    assert.deepEqual(parsed.meta.fields, [...ATTENDANCE_CSV_HEADERS]);
    assert.equal(parsed.data.length, 1);
    assert.ok(parsed.data[0]["หน่วยงาน"].startsWith("'="), "Formula payload must be escaped");
    assert.equal(parsed.data[0]["เวลาเช็คอิน"], "-", "Dash placeholder must stay '-'");
  });

  await test("4. Email template uses Thai format, exact subject, and live stats", () => {
    const regs = [
      { id: "r1", courseId: "c1", attended: true },
      { id: "r2", courseId: "c1", attended: true },
      { id: "r3", courseId: "c1", attended: false },
    ];
    const evals = [
      { id: "e1", courseId: "c1", userId: "u1", ratings: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5] },
      { id: "e2", courseId: "c1", userId: "u2", ratings: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4] },
    ];
    const opStats = calculateCourseOperationalStats("c1", regs, evals);
    const analysis = analyzeEvaluations(evals, DEFAULT_QUESTIONS, "การสอนด้วย AI");

    const email = buildTrainingReportEmailContent({
      courseTitle: "การสอนด้วย AI",
      trainingDate: "12 สิงหาคม 2569",
      recipientName: DEFAULT_REPORT_RECIPIENT_NAME,
      registeredCount: opStats.totalRegistrations,
      attendedCount: opStats.totalAttendees,
      evaluationCount: analysis.totalResponses,
      averageScore: analysis.overallAverage,
    });

    assert.equal(email.subject, "[BU Training] ส่งรายชื่อผู้เข้าอบรมจริงและผลประเมิน: การสอนด้วย AI");
    assert.ok(email.body.includes("เรียน อ.จักกรี เสริมทรัพย์"));
    assert.ok(email.body.includes("- ผู้ลงทะเบียน: 3 คน"));
    assert.ok(email.body.includes("- ผู้เข้าอบรมจริง: 2 คน"));
    assert.ok(email.body.includes("- ผู้ตอบแบบประเมิน: 2 คน"));
    assert.ok(email.body.includes("- คะแนนความพึงพอใจเฉลี่ย: 4.50 / 5.00"));
    assert.ok(email.body.includes("1. รายชื่อผู้เข้าอบรมจริง (CSV)"));
    assert.ok(email.body.includes("2. รายงานสรุปผลการประเมิน (PDF)"));
    assert.ok(email.htmlBody.includes("สำนักพัฒนาการเรียนรู้ (LDO)"));
  });

  await test("5. Attachment validator enforces PDF header, non-empty blobs, and payload bounds", async () => {
    const csvBlob = new Blob(["\ufeffa,b\n1,2"], { type: "text/csv" });
    const validPdfBlob = new Blob(["%PDF-1.4 mock pdf bytes"], { type: "application/pdf" });
    const badPdfBlob = new Blob(["NOT_A_PDF"], { type: "application/pdf" });

    const ok = await validateTrainingReportAttachments(csvBlob, validPdfBlob);
    assert.equal(ok.valid, true);

    const bad = await validateTrainingReportAttachments(csvBlob, badPdfBlob);
    assert.equal(bad.valid, false);
    assert.ok(bad.error?.includes("PDF"));

    const serverCsvCheck = validateAttachmentPayload(
      {
        filename: "attendance.csv",
        mimeType: "text/csv;charset=utf-8",
        base64: Buffer.from("a,b\n1,2").toString("base64"),
      },
      "csv"
    );
    assert.equal(serverCsvCheck.valid, true);

    const serverPdfCheck = validateAttachmentPayload(
      {
        filename: "overview.pdf",
        mimeType: "application/pdf",
        base64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
      },
      "pdf"
    );
    assert.equal(serverPdfCheck.valid, true);

    const fakePdfServerCheck = validateAttachmentPayload(
      {
        filename: "overview.pdf",
        mimeType: "application/pdf",
        base64: Buffer.from("<html>hack</html>").toString("base64"),
      },
      "pdf"
    );
    assert.equal(fakePdfServerCheck.valid, false);
  });

  await test("6. Delivery dispatcher never uses no-cors and cleanly distinguishes confirmed_sent vs failed vs unknown", async () => {
    const baseArgs = {
      idToken: "fake-firebase-id-token",
      requestId: createTrainingReportRequestId("c1"),
      courseId: "c1",
      courseTitle: "Test Course",
      trainingDate: "12 สิงหาคม 2569",
      recipientName: DEFAULT_REPORT_RECIPIENT_NAME,
      recipientEmail: DEFAULT_REPORT_RECIPIENT_EMAIL,
      registeredCount: 10,
      attendedCount: 8,
      evaluationCount: 7,
      averageScore: "4.80",
      subject: "[BU Training] ส่งรายชื่อผู้เข้าอบรมจริงและผลประเมิน: Test Course",
      body: "Body",
      htmlBody: "<p>Body</p>",
      csvFilename: "attendance.csv",
      csvBase64: Buffer.from("a,b\n1,2").toString("base64"),
      pdfFilename: "overview.pdf",
      pdfBase64: Buffer.from("%PDF-1.4").toString("base64"),
    };

    // Case A: Confirmed sent from server
    let capturedInit: RequestInit | undefined;
    const confirmedRes = await dispatchTrainingReportEmail({
      ...baseArgs,
      fetchImpl: async (_url, init) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({
            status: "success",
            recipient: "jakree.s@bu.ac.th",
            attachmentsCount: 2,
            sentAt: "2026-08-01T10:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });
    assert.notEqual(capturedInit?.mode, "no-cors", "Must NEVER use mode: no-cors");
    assert.equal(confirmedRes.deliveryState, "confirmed_sent");

    // Case B: Server 504 -> Delivery status unknown
    const unknownRes = await dispatchTrainingReportEmail({
      ...baseArgs,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ status: "unknown", code: "GAS_TIMEOUT", message: "Timeout" }),
          { status: 504 }
        ),
    });
    assert.equal(unknownRes.deliveryState, "unknown");

    // Case C: Network throw -> Delivery status unknown
    const networkUnknownRes = await dispatchTrainingReportEmail({
      ...baseArgs,
      fetchImpl: async () => {
        throw new Error("Network disconnected");
      },
    });
    assert.equal(networkUnknownRes.deliveryState, "unknown");

    // Case D: HTTP 403 -> Failed
    const forbiddenRes = await dispatchTrainingReportEmail({
      ...baseArgs,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ status: "error", code: "FORBIDDEN", message: "Admin only" }),
          { status: 403 }
        ),
    });
    assert.equal(forbiddenRes.deliveryState, "failed");

    // Case E: Non-@bu.ac.th recipient blocked client-side before fetch
    let fetchCalled = false;
    const badRecipientRes = await dispatchTrainingReportEmail({
      ...baseArgs,
      recipientEmail: "external@example.com",
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("{}", { status: 200 });
      },
    });
    assert.equal(fetchCalled, false);
    assert.equal(badRecipientRes.deliveryState, "failed");
  });

  await test("7. Netlify handler enforces auth, POST method, and @bu.ac.th email check", async () => {
    const getResp = await reportHandler({
      path: "/api/send-training-report",
      httpMethod: "GET",
      headers: {},
      body: null,
    });
    assert.equal(getResp.statusCode, 405);

    const noAuthResp = await reportHandler({
      path: "/api/send-training-report",
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ action: "send_training_report" }),
    });
    assert.equal(noAuthResp.statusCode, 401);
    assert.equal(isValidBuEmail("jakree.s@bu.ac.th"), true);
    assert.equal(isValidBuEmail("jakree.s@gmail.com"), false);
  });

  await test("8. Client code contains zero shared secrets and never uses no-cors for training report dispatch", () => {
    const trainingReportSrc = readRepoFile("src/lib/trainingReport.ts");
    const modalSrc = readRepoFile("src/components/analytics/TrainingReportEmailModal.tsx");
    assert.ok(!trainingReportSrc.includes("INTERNAL_WEBHOOK_SECRET"));
    assert.ok(!trainingReportSrc.includes("secretToken"));
    assert.ok(!trainingReportSrc.includes("no-cors"));
    assert.ok(!modalSrc.includes("secretToken"));
    assert.ok(!modalSrc.includes("no-cors"));
    assert.ok(modalSrc.includes("URL.revokeObjectURL"));
    assert.ok(modalSrc.includes("sendingRef"));
    assert.ok(modalSrc.includes("isAdmin"));
  });

  await test("9. UI placement adds button in OverviewTab & EvaluationDashboard without modifying AdminPortal sidebar", () => {
    const overviewTab = readRepoFile("src/components/analytics/OverviewTab.tsx");
    const evalDashboard = readRepoFile("src/components/EvaluationDashboard.tsx");
    const adminPortal = readRepoFile("src/pages/AdminPortal.tsx");
    const pdfExportSrc = readRepoFile("src/lib/pdfExport.ts");
    const overviewPdfSrc = readRepoFile("src/components/analytics/OverviewPdfReport.tsx");

    assert.ok(overviewTab.includes("ส่งรายงานการอบรม"));
    assert.ok(evalDashboard.includes("ส่งรายงานการอบรม"));
    assert.ok(!adminPortal.includes("ส่งรายงานการอบรม"), "Must NOT add a new sidebar item");
    assert.ok(pdfExportSrc.includes("generateEvaluationPdfBlob"));
    assert.ok(pdfExportSrc.includes("exportEvaluationPdf"));
    assert.ok(overviewPdfSrc.includes('containerId = "overview-pdf-report"'));
  });

  await test("10. GAS scripts support send_training_report while preserving all existing actions", () => {
    const gasEn = readRepoFile("GAS_EN_CODE.gs");
    const gasTh = readRepoFile("GAS_CODE.md");

    for (const src of [gasEn, gasTh]) {
      assert.ok(src.includes('action === "send_training_report"'));
      assert.ok(src.includes("function handleTrainingReport(data)"));
      assert.ok(src.includes("INTERNAL_WEBHOOK_SECRET"));
      assert.ok(src.includes("CacheService.getScriptCache()"));
      assert.ok(src.includes("LockService.getScriptLock()"));
      assert.ok(src.includes("send_certificates"));
      assert.ok(src.includes("send_reminders"));
      assert.ok(src.includes("send_evaluations"));
      assert.ok(src.includes("validate_folder"));
    }
  });

  console.log(`\nModule 20 Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
