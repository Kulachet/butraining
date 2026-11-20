import Papa from "papaparse";
import { Course, Instructor, Registration } from "../types";
import { formatDateThai, formatInstructorName } from "./utils";

export const DEFAULT_REPORT_RECIPIENT_NAME = "อ.จักกรี เสริมทรัพย์";
export const DEFAULT_REPORT_RECIPIENT_EMAIL = "jakree.s@bu.ac.th";
export const TRAINING_REPORT_ENDPOINT = "/api/send-training-report";

export const MAX_CSV_BYTES = 1 * 1024 * 1024; // 1 MB
export const MAX_PDF_BYTES = 3.5 * 1024 * 1024; // 3.5 MB
export const MAX_TOTAL_PAYLOAD_BYTES = 5.4 * 1024 * 1024; // Stay safely under Netlify's 6 MB limit

export const ATTENDANCE_CSV_HEADERS = [
  "ลำดับที่ (ใบประกาศ)",
  "ลำดับการเช็คอิน",
  "ลำดับ (ระบบ)",
  "รหัสอาจารย์",
  "ชื่อ-นามสกุล",
  "อีเมล",
  "หน่วยงาน",
  "ตำแหน่ง",
  "เวลาเช็คอิน",
] as const;

export type TrainingReportDeliveryState =
  | "idle"
  | "preparing"
  | "ready"
  | "sending"
  | "confirmed_sent"
  | "failed"
  | "unknown";

export interface InstructorLookupEntry {
  id: string;
  name: string;
  position?: string;
}

export interface AttendanceCsvRow {
  "ลำดับที่ (ใบประกาศ)": number;
  "ลำดับการเช็คอิน": number | string;
  "ลำดับ (ระบบ)": number | string;
  "รหัสอาจารย์": string;
  "ชื่อ-นามสกุล": string;
  "อีเมล": string;
  "หน่วยงาน": string;
  "ตำแหน่ง": string;
  "เวลาเช็คอิน": string;
}

export interface GeneratedAttendanceCsv {
  rows: AttendanceCsvRow[];
  csvContent: string;
  blob: Blob;
  filename: string;
  rowCount: number;
}

export interface TrainingReportEmailContent {
  subject: string;
  body: string;
  htmlBody: string;
}

export interface TrainingReportDispatchResult {
  deliveryState: "confirmed_sent" | "failed" | "unknown";
  message: string;
  code?: string;
  recipient?: string;
  sentAt?: string;
  attachmentsCount?: number;
  requestId: string;
  gatewayUnavailable?: boolean;
}

/**
 * Neutralizes CSV formula injection payloads while keeping normal display strings
 * such as "-" untouched for backward compatibility with RegistrantsList CSV exports.
 */
export function sanitizeCsvTextCell(value: unknown, fallback: string = "-"): string {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  if (!str) return fallback;
  if (str === "-") return "-";
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function sanitizeReportFilenamePart(rawTitle?: string): string {
  const base = (rawTitle || "หลักสูตร").trim();
  const cleaned = base
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "หลักสูตร").slice(0, 80);
}

export function buildAttendanceCsvFilename(courseTitle?: string): string {
  return `รายชื่อผู้มาอบรมจริง_${sanitizeReportFilenamePart(courseTitle)}.csv`;
}

export function buildOverviewPdfFilename(courseTitle?: string): string {
  return `Executive_Evaluation_Overview_${sanitizeReportFilenamePart(courseTitle)}.pdf`;
}

export function buildInstructorLookup(
  instructors: Array<Pick<Instructor, "id" | "name" | "position" | "email"> | Record<string, any>>
): {
  byId: Record<string, InstructorLookupEntry>;
  byEmail: Record<string, InstructorLookupEntry>;
} {
  const byId: Record<string, InstructorLookupEntry> = {};
  const byEmail: Record<string, InstructorLookupEntry> = {};

  instructors.forEach((inst) => {
    if (!inst) return;
    const entry: InstructorLookupEntry = {
      id: inst.id ? String(inst.id).trim() : "",
      name: inst.name ? String(inst.name).trim() : "",
      position: inst.position !== undefined && inst.position !== null ? String(inst.position) : undefined,
    };

    if (entry.id) {
      byId[entry.id] = entry;
      byId[entry.id.toLowerCase()] = entry;
    }

    if (inst.email) {
      const emailRaw = String(inst.email).trim();
      const emailLower = emailRaw.toLowerCase();
      byEmail[emailRaw] = entry;
      byEmail[emailLower] = entry;
    }
  });

  return { byId, byEmail };
}

/**
 * Authoritative actual attendance filter, ordering, and 9-column mapping.
 * Strictly includes only registrations where `reg.attended === true`.
 */
export function buildActualAttendanceRows(
  registrations: Array<Partial<Registration> & Record<string, any>>,
  instructors: Array<Pick<Instructor, "id" | "name" | "position" | "email"> | Record<string, any>> = [],
  courseId?: string
): AttendanceCsvRow[] {
  const { byId, byEmail } = buildInstructorLookup(instructors);

  const attendees = registrations
    .filter((reg) => {
      if (courseId && reg.courseId !== courseId) return false;
      return Boolean(reg.attended);
    })
    .sort((a, b) => {
      const diff =
        (Number(a.checkInSequenceNumber) || Number(a.sequenceNumber) || 0) -
        (Number(b.checkInSequenceNumber) || Number(b.sequenceNumber) || 0);
      if (diff !== 0) return diff;
      return (Number(a.sequenceNumber) || 0) - (Number(b.sequenceNumber) || 0);
    });

  return attendees.map((reg, index) => {
    const rawEmail = reg.userEmail ? String(reg.userEmail).trim() : "";
    const emailLower = rawEmail.toLowerCase();
    const rawInstId = reg.instructorId ? String(reg.instructorId).trim() : "";
    const instIdLower = rawInstId.toLowerCase();

    const matched =
      (emailLower && byEmail[emailLower]) ||
      (instIdLower && byId[instIdLower]) ||
      undefined;

    const resolvedId = matched?.id || rawInstId || "";
    const resolvedName = matched?.name || (reg.userName ? String(reg.userName) : "");
    const resolvedPos =
      matched?.position !== undefined ? matched.position : reg.userPosition;

    const formattedFullName = formatInstructorName(
      resolvedName,
      resolvedId || undefined,
      resolvedPos
    );

    const checkInFormatted = reg.checkInAt
      ? new Date(reg.checkInAt).toLocaleString("th-TH")
      : "-";

    return {
      "ลำดับที่ (ใบประกาศ)": index + 1,
      "ลำดับการเช็คอิน": reg.checkInSequenceNumber || "-",
      "ลำดับ (ระบบ)": reg.sequenceNumber ?? "-",
      "รหัสอาจารย์": sanitizeCsvTextCell(resolvedId, "-"),
      "ชื่อ-นามสกุล": sanitizeCsvTextCell(formattedFullName, "-"),
      "อีเมล": sanitizeCsvTextCell(rawEmail, "-"),
      "หน่วยงาน": sanitizeCsvTextCell(reg.userDepartment, "-"),
      "ตำแหน่ง": sanitizeCsvTextCell(reg.userPosition, "-"),
      "เวลาเช็คอิน": checkInFormatted,
    };
  });
}

export function generateActualAttendanceCsv(
  registrations: Array<Partial<Registration> & Record<string, any>>,
  instructors: Array<Pick<Instructor, "id" | "name" | "position" | "email"> | Record<string, any>>,
  courseTitle?: string,
  courseId?: string
): GeneratedAttendanceCsv {
  const rows = buildActualAttendanceRows(registrations, instructors, courseId);
  const csvBody =
    rows.length > 0
      ? Papa.unparse(rows)
      : Papa.unparse({ fields: [...ATTENDANCE_CSV_HEADERS], data: [] });

  const csvContent = "\ufeff" + csvBody;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  return {
    rows,
    csvContent,
    blob,
    filename: buildAttendanceCsvFilename(courseTitle),
    rowCount: rows.length,
  };
}

export function isValidBuRecipientEmail(email: string | undefined | null): boolean {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim().toLowerCase();
  return /^[a-z0-9._%+-]+@bu\.ac\.th$/i.test(trimmed);
}

export function formatCourseTrainingDateDisplay(course: Partial<Course> | null | undefined): string {
  if (!course) return "-";
  if (course.isMultiDay && Array.isArray(course.sessions) && course.sessions.length > 1) {
    const first = course.sessions[0]?.date;
    const last = course.sessions[course.sessions.length - 1]?.date;
    if (first && last && first !== last) {
      return `${formatDateThai(first)} – ${formatDateThai(last)}`;
    }
  }
  return course.date ? formatDateThai(course.date) : "-";
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildTrainingReportEmailContent(params: {
  courseTitle: string;
  trainingDate: string;
  recipientName: string;
  registeredCount: number;
  attendedCount: number;
  evaluationCount: number;
  averageScore: number | string;
}): TrainingReportEmailContent {
  const recipientName = (params.recipientName || DEFAULT_REPORT_RECIPIENT_NAME).trim();
  const courseTitle = (params.courseTitle || "หลักสูตร").trim();
  const trainingDate = (params.trainingDate || "-").trim();
  const avgNum =
    typeof params.averageScore === "number"
      ? params.averageScore
      : Number(params.averageScore || 0);
  const averageScoreStr = isNaN(avgNum) ? "0.00" : avgNum.toFixed(2);

  const subject = `[BU Training] ส่งรายชื่อผู้เข้าอบรมจริงและผลประเมิน: ${courseTitle}`;

  const body =
    `เรียน ${recipientName}\n\n` +
    `สำนักพัฒนาการเรียนรู้ ขอส่งข้อมูลการจัดอบรมหลักสูตร "${courseTitle}" ซึ่งจัดขึ้นเมื่อวันที่ ${trainingDate} เพื่อดำเนินการบันทึกผลการอบรม\n\n` +
    `สรุปข้อมูล:\n` +
    `- ผู้ลงทะเบียน: ${params.registeredCount} คน\n` +
    `- ผู้เข้าอบรมจริง: ${params.attendedCount} คน\n` +
    `- ผู้ตอบแบบประเมิน: ${params.evaluationCount} คน\n` +
    `- คะแนนความพึงพอใจเฉลี่ย: ${averageScoreStr} / 5.00\n\n` +
    `เอกสารแนบ:\n` +
    `1. รายชื่อผู้เข้าอบรมจริง (CSV)\n` +
    `2. รายงานสรุปผลการประเมิน (PDF)\n\n` +
    `จึงเรียนมาเพื่อดำเนินการบันทึกผลการอบรมตามเอกสารแนบ\n\n` +
    `ขอบคุณครับ\n\n` +
    `สำนักพัฒนาการเรียนรู้ (LDO)\n` +
    `มหาวิทยาลัยกรุงเทพ`;

  const htmlBody =
    `<div style="font-family: 'Sarabun', 'Noto Sans Thai', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; padding: 24px; line-height: 1.7; max-width: 640px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;">` +
    `<div style="border-bottom: 2px solid #8b0000; padding-bottom: 12px; margin-bottom: 20px;">` +
    `<span style="font-size: 11px; font-weight: 700; color: #8b0000; text-transform: uppercase; letter-spacing: 0.8px;">มหาวิทยาลัยกรุงเทพ • สำนักพัฒนาการเรียนรู้ (LDO)</span>` +
    `<h2 style="color: #0f172a; margin: 6px 0 0 0; font-size: 18px;">ส่งรายชื่อผู้เข้าอบรมจริงและรายงานสรุปผลการประเมิน</h2>` +
    `</div>` +
    `<p style="margin-top: 0;">เรียน <strong>${escapeHtml(recipientName)}</strong></p>` +
    `<p>สำนักพัฒนาการเรียนรู้ ขอส่งข้อมูลการจัดอบรมหลักสูตร <strong>&ldquo;${escapeHtml(courseTitle)}&rdquo;</strong> ซึ่งจัดขึ้นเมื่อวันที่ <strong>${escapeHtml(trainingDate)}</strong> เพื่อดำเนินการบันทึกผลการอบรม</p>` +
    `<div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; margin: 18px 0;">` +
    `<p style="margin: 0 0 8px 0; font-weight: 700; color: #0f172a;">สรุปข้อมูล:</p>` +
    `<ul style="margin: 0; padding-left: 20px; color: #334155;">` +
    `<li>ผู้ลงทะเบียน: <strong>${params.registeredCount}</strong> คน</li>` +
    `<li>ผู้เข้าอบรมจริง: <strong>${params.attendedCount}</strong> คน</li>` +
    `<li>ผู้ตอบแบบประเมิน: <strong>${params.evaluationCount}</strong> คน</li>` +
    `<li>คะแนนความพึงพอใจเฉลี่ย: <strong>${escapeHtml(averageScoreStr)} / 5.00</strong></li>` +
    `</ul>` +
    `</div>` +
    `<div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 12px 16px; margin: 18px 0;">` +
    `<p style="margin: 0 0 6px 0; font-weight: 700; color: #92400e;">เอกสารแนบ:</p>` +
    `<ol style="margin: 0; padding-left: 20px; color: #78350f;">` +
    `<li>รายชื่อผู้เข้าอบรมจริง (CSV)</li>` +
    `<li>รายงานสรุปผลการประเมิน (PDF)</li>` +
    `</ol>` +
    `</div>` +
    `<p>จึงเรียนมาเพื่อดำเนินการบันทึกผลการอบรมตามเอกสารแนบ</p>` +
    `<p>ขอบคุณครับ</p>` +
    `<div style="margin-top: 20px; padding-top: 14px; border-top: 1px solid #f1f5f9;">` +
    `<p style="margin: 0; font-weight: bold; color: #8b0000;">สำนักพัฒนาการเรียนรู้ (LDO)</p>` +
    `<p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b;">มหาวิทยาลัยกรุงเทพ</p>` +
    `</div>` +
    `</div>`;

  return { subject, body, htmlBody };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = typeof reader.result === "string" ? reader.result : "";
        const commaIdx = res.indexOf(",");
        if (commaIdx === -1) {
          reject(new Error("ไม่สามารถเข้ารหัสไฟล์แนบเป็น Base64 ได้"));
          return;
        }
        resolve(res.slice(commaIdx + 1));
      };
      reader.onerror = () => reject(new Error("เกิดข้อผิดพลาดระหว่างอ่านไฟล์แนบ"));
      reader.readAsDataURL(blob);
    });
  }

  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function validateTrainingReportAttachments(
  csvBlob: Blob | null,
  pdfBlob: Blob | null
): Promise<{ valid: boolean; error?: string }> {
  if (!csvBlob || csvBlob.size === 0) {
    return { valid: false, error: "ไม่พบไฟล์ CSV รายชื่อผู้เข้าอบรมจริง หรือไฟล์มีขนาด 0 ไบต์" };
  }
  if (!pdfBlob || pdfBlob.size === 0) {
    return { valid: false, error: "ไม่พบไฟล์ PDF รายงานสรุปผลการประเมิน หรือไฟล์มีขนาด 0 ไบต์" };
  }
  if (csvBlob.size > MAX_CSV_BYTES) {
    return { valid: false, error: "ไฟล์ CSV มีขนาดใหญ่เกิน 1 MB" };
  }
  if (pdfBlob.size > MAX_PDF_BYTES) {
    return { valid: false, error: "ไฟล์ PDF มีขนาดใหญ่เกินขีดจำกัด (3.5 MB)" };
  }

  // Approximate Base64 overhead (~1.37x + JSON wrapper)
  const estimatedPayloadSize = Math.ceil((csvBlob.size + pdfBlob.size) * 1.37);
  if (estimatedPayloadSize > MAX_TOTAL_PAYLOAD_BYTES) {
    return {
      valid: false,
      error: "ขนาดไฟล์แนบรวมเกินขีดจำกัดการส่งอีเมลผ่านระบบอัตโนมัติ (กรุณาดาวน์โหลดส่งด้วยตนเอง)",
    };
  }

  try {
    const headerBuf = await pdfBlob.slice(0, 5).arrayBuffer();
    const headerText = new TextDecoder("ascii").decode(headerBuf);
    if (!headerText.startsWith("%PDF-")) {
      return { valid: false, error: "ไฟล์ PDF ที่สร้างไม่ถูกต้อง (ส่วนหัวไฟล์ไม่ใช่ PDF)" };
    }
  } catch {
    // Non-fatal in environments without Blob.slice/arrayBuffer
  }

  return { valid: true };
}

export function formatBytesCompact(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function createTrainingReportRequestId(courseId: string): string {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `tr-${courseId.slice(0, 12)}-${Date.now()}-${randomPart}`;
}

export async function dispatchTrainingReportEmail(params: {
  idToken: string;
  requestId: string;
  courseId: string;
  courseTitle: string;
  trainingDate: string;
  recipientName: string;
  recipientEmail: string;
  registeredCount: number;
  attendedCount: number;
  evaluationCount: number;
  averageScore: string;
  subject: string;
  body: string;
  htmlBody: string;
  csvFilename: string;
  csvBase64: string;
  pdfFilename: string;
  pdfBase64: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}): Promise<TrainingReportDispatchResult> {
  const endpoint = params.endpoint || TRAINING_REPORT_ENDPOINT;
  const fetchFn = params.fetchImpl || fetch;

  if (!params.idToken) {
    return {
      deliveryState: "failed",
      code: "UNAUTHENTICATED",
      message: "ไม่พบสิทธิ์การยืนยันตัวตน (กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบอีกครั้ง)",
      requestId: params.requestId,
    };
  }

  const recipientEmail = params.recipientEmail.trim().toLowerCase();
  if (!isValidBuRecipientEmail(recipientEmail)) {
    return {
      deliveryState: "failed",
      code: "INVALID_RECIPIENT",
      message: "อีเมลผู้รับต้องเป็นบัญชีของมหาวิทยาลัยกรุงเทพ (@bu.ac.th) เท่านั้น",
      requestId: params.requestId,
    };
  }

  const payload = {
    action: "send_training_report" as const,
    requestId: params.requestId,
    courseId: params.courseId,
    courseTitle: params.courseTitle,
    trainingDate: params.trainingDate,
    recipientName: params.recipientName.trim() || DEFAULT_REPORT_RECIPIENT_NAME,
    recipientEmail,
    stats: {
      registeredCount: params.registeredCount,
      attendedCount: params.attendedCount,
      evaluationCount: params.evaluationCount,
      averageScore: params.averageScore,
    },
    subject: params.subject,
    body: params.body,
    htmlBody: params.htmlBody,
    attachments: {
      csv: {
        filename: params.csvFilename,
        mimeType: "text/csv",
        base64: params.csvBase64,
      },
      pdf: {
        filename: params.pdfFilename,
        mimeType: "application/pdf",
        base64: params.pdfBase64,
      },
    },
  };

  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.idToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    return {
      deliveryState: "unknown",
      code: "NETWORK_UNCERTAIN",
      message:
        "การเชื่อมต่อขัดข้องระหว่างรอผลยืนยันจากเซิร์ฟเวอร์ (Delivery status unknown) — กรุณาตรวจสอบกล่องจดหมายก่อนลองส่งซ้ำเพื่อหลีกเลี่ยงการส่งอีเมลซ้ำ",
      requestId: params.requestId,
    };
  }

  let parsed: any = null;
  let rawText = "";
  try {
    rawText = await response.text();
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  // Explicitly distinguish confirmed delivery vs ambiguous/failed outcomes
  if (response.ok && parsed && parsed.status === "success") {
    return {
      deliveryState: "confirmed_sent",
      message: parsed.message || "ส่งรายงานการอบรมและไฟล์แนบทั้งหมดสำเร็จแล้ว",
      recipient: parsed.recipient || recipientEmail,
      sentAt: parsed.sentAt,
      attachmentsCount: parsed.attachmentsCount ?? 2,
      requestId: parsed.requestId || params.requestId,
    };
  }

  if (response.status === 504 || parsed?.status === "unknown") {
    return {
      deliveryState: "unknown",
      code: parsed?.code || "DELIVERY_STATUS_UNKNOWN",
      message:
        parsed?.message ||
        "ไม่พบคำยืนยันการส่งกลับมาจาก Google Apps Script ภายในเวลาที่กำหนด (Delivery status unknown) — กรุณาตรวจสอบอีเมลผู้รับก่อนดำเนินการส่งซ้ำ",
      requestId: params.requestId,
    };
  }

  const isGatewayMissing =
    response.status === 404 ||
    response.status === 503 ||
    parsed?.code === "GATEWAY_UNCONFIGURED" ||
    parsed?.code === "SERVER_MISCONFIGURED";

  return {
    deliveryState: "failed",
    code: parsed?.code || `HTTP_${response.status}`,
    message:
      parsed?.message ||
      (response.status === 404
        ? "ไม่พบ API ส่งอีเมลรายงานบนเซิร์ฟเวอร์ปัจจุบัน (สามารถใช้ปุ่มดาวน์โหลดไฟล์แนบและคัดลอกข้อความเพื่อส่งด้วยตนเองได้ทันที)"
        : `ส่งอีเมลไม่สำเร็จ (HTTP ${response.status})`),
    requestId: params.requestId,
    gatewayUnavailable: isGatewayMissing,
  };
}
