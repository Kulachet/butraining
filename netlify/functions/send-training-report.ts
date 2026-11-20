import { initializeApp, getApps, cert, applicationDefault, App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Firestore } from "firebase-admin/firestore";

interface HandlerEvent {
  rawUrl?: string;
  path: string;
  httpMethod: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  isBase64Encoded?: boolean;
}

interface HandlerResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const ADMIN_EMAIL_ALLOWLIST = new Set([
  "kulachet.l@bu.ac.th",
  "napaporn.pu@bu.ac.th",
]);

const MAX_REQUEST_BYTES = 5.5 * 1024 * 1024; // 5.5 MB
const MAX_CSV_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_PDF_BYTES = 3.5 * 1024 * 1024; // 3.5 MB

function getFirebaseAdmin(): { app: App; db: Firestore } | null {
  const apps = getApps();
  if (apps.length > 0 && apps[0]) {
    const existing = apps[0];
    return { app: existing, db: getFirestore(existing) };
  }

  try {
    let credential: any = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      credential = cert(sa);
    } else if (
      process.env.FIREBASE_PRIVATE_KEY &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PROJECT_ID
    ) {
      credential = cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      });
    } else {
      try {
        credential = applicationDefault();
      } catch {
        credential = null;
      }
    }

    if (!credential) {
      return null;
    }

    const app = initializeApp({
      credential,
      projectId: process.env.FIREBASE_PROJECT_ID || "my-bu-app-2026-d4620",
    });

    return { app, db: getFirestore(app) };
  } catch (err) {
    console.error("Firebase Admin initialization error:", err);
    return null;
  }
}

export function isValidBuEmail(email: string | undefined | null): boolean {
  if (!email || typeof email !== "string") return false;
  return /^[a-z0-9._%+-]+@bu\.ac\.th$/i.test(email.trim());
}

export function sanitizeHeaderString(value: unknown, maxLen: number = 250): string {
  if (!value) return "";
  return String(value)
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function sanitizeBodyString(value: unknown, maxLen: number = 20000): string {
  if (!value) return "";
  return String(value).trim().slice(0, maxLen);
}

export function validateAttachmentPayload(
  att: any,
  kind: "csv" | "pdf"
): { valid: boolean; error?: string; byteLength?: number; filename?: string } {
  if (!att || typeof att !== "object") {
    return { valid: false, error: `Missing ${kind.toUpperCase()} attachment payload` };
  }

  const filename = sanitizeHeaderString(att.filename, 160);
  const mimeType = sanitizeHeaderString(att.mimeType, 80).toLowerCase();
  const base64 = typeof att.base64 === "string" ? att.base64.trim() : "";

  if (!filename || !base64) {
    return { valid: false, error: `Incomplete ${kind.toUpperCase()} attachment metadata` };
  }

  if (kind === "csv") {
    if (!filename.toLowerCase().endsWith(".csv") || !mimeType.startsWith("text/csv")) {
      return { valid: false, error: "Invalid CSV attachment filename or MIME type" };
    }
  } else {
    if (!filename.toLowerCase().endsWith(".pdf") || mimeType !== "application/pdf") {
      return { valid: false, error: "Invalid PDF attachment filename or MIME type" };
    }
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(base64, "base64");
  } catch {
    return { valid: false, error: `Invalid Base64 encoding for ${kind.toUpperCase()} attachment` };
  }

  if (decoded.length === 0) {
    return { valid: false, error: `${kind.toUpperCase()} attachment is empty` };
  }

  if (kind === "csv" && decoded.length > MAX_CSV_BYTES) {
    return { valid: false, error: "CSV attachment exceeds 1 MB limit" };
  }

  if (kind === "pdf") {
    if (decoded.length > MAX_PDF_BYTES) {
      return { valid: false, error: "PDF attachment exceeds 3.5 MB limit" };
    }
    const magic = decoded.subarray(0, 5).toString("ascii");
    if (!magic.startsWith("%PDF-")) {
      return { valid: false, error: "PDF attachment does not have a valid %PDF- header" };
    }
  }

  return { valid: true, byteLength: decoded.length, filename };
}

async function verifyAdminCaller(
  db: Firestore,
  uid: string,
  email: string | undefined,
  emailVerified: boolean | undefined
): Promise<boolean> {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (normalizedEmail && emailVerified !== false && ADMIN_EMAIL_ALLOWLIST.has(normalizedEmail)) {
    return true;
  }
  try {
    const adminDoc = await db.collection("admins").doc(uid).get();
    if (adminDoc.exists && adminDoc.data()?.active === true) {
      return true;
    }
  } catch {
    // Fall through to deny
  }
  return false;
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "METHOD_NOT_ALLOWED",
        message: "Only POST requests are supported",
      }),
    };
  }

  if (event.body && Buffer.byteLength(event.body, "utf8") > MAX_REQUEST_BYTES) {
    return {
      statusCode: 413,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "PAYLOAD_TOO_LARGE",
        message: "Request payload exceeds 5.5 MB limit",
      }),
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "UNAUTHORIZED",
        message: "Missing or malformed Authorization header",
      }),
    };
  }
  const idToken = authHeader.substring(7).trim();

  const fb = getFirebaseAdmin();
  if (!fb) {
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "SERVER_MISCONFIGURED",
        message: "Firebase Admin credentials are not configured on the server.",
      }),
    };
  }

  let decodedToken: any;
  try {
    decodedToken = await getAuth(fb.app).verifyIdToken(idToken);
  } catch {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "INVALID_TOKEN",
        message: "Invalid or expired Firebase authentication token",
      }),
    };
  }

  const isAdmin = await verifyAdminCaller(
    fb.db,
    decodedToken.uid,
    decodedToken.email,
    decodedToken.email_verified
  );

  if (!isAdmin) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "FORBIDDEN",
        message: "Administrator privileges are required to send training report emails.",
      }),
    };
  }

  let bodyData: any;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "{}";
    bodyData = JSON.parse(rawBody);
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "INVALID_JSON",
        message: "Invalid JSON request body",
      }),
    };
  }

  if (bodyData.action !== "send_training_report") {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "INVALID_ACTION",
        message: "Unsupported action for send-training-report endpoint",
      }),
    };
  }

  const courseId = sanitizeHeaderString(bodyData.courseId, 120);
  const requestId = sanitizeHeaderString(bodyData.requestId, 120).replace(/[^a-zA-Z0-9_-]/g, "_");
  const recipientEmail = sanitizeHeaderString(bodyData.recipientEmail, 160).toLowerCase();
  const recipientName = sanitizeHeaderString(bodyData.recipientName, 160);

  if (!courseId || !requestId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "MISSING_PARAMETERS",
        message: "courseId and requestId are required",
      }),
    };
  }

  if (!isValidBuEmail(recipientEmail)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "INVALID_RECIPIENT",
        message: "Recipient email must be a valid @bu.ac.th address",
      }),
    };
  }

  const csvCheck = validateAttachmentPayload(bodyData.attachments?.csv, "csv");
  if (!csvCheck.valid) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "INVALID_CSV_ATTACHMENT",
        message: csvCheck.error,
      }),
    };
  }

  const pdfCheck = validateAttachmentPayload(bodyData.attachments?.pdf, "pdf");
  if (!pdfCheck.valid) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "INVALID_PDF_ATTACHMENT",
        message: pdfCheck.error,
      }),
    };
  }

  // Verify course exists in Firestore
  const courseDoc = await fb.db.collection("courses").doc(courseId).get();
  if (!courseDoc.exists) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "COURSE_NOT_FOUND",
        message: "Selected course does not exist",
      }),
    };
  }

  const gasUrl = (process.env.GAS_REPORT_URL || process.env.GAS_EN_URL || "").trim();
  const gasSecret = (process.env.GAS_REPORT_SECRET || process.env.GAS_EN_SECRET || "").trim();

  if (!gasUrl || !gasSecret) {
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "GATEWAY_UNCONFIGURED",
        message:
          "Server email gateway (GAS_REPORT_URL/GAS_EN_URL and GAS_REPORT_SECRET/GAS_EN_SECRET) is not configured.",
      }),
    };
  }

  // Idempotency lock (stores metadata only — never attachment bytes or participant lists)
  const logRef = fb.db.collection("training_report_dispatches").doc(requestId);
  const lockOutcome = await fb.db.runTransaction(async (tx) => {
    const snap = await tx.get(logRef);
    if (snap.exists) {
      const existing = snap.data() || {};
      if (existing.status === "sent") {
        return { proceed: false, alreadySent: true, existing };
      }
      if (existing.status === "processing") {
        return { proceed: false, inProgress: true, existing };
      }
    }
    tx.set(
      logRef,
      {
        requestId,
        courseId,
        recipientEmail,
        triggeredByUid: decodedToken.uid,
        status: "processing",
        updatedAt: new Date().toISOString(),
        createdAt: snap.exists ? snap.data()?.createdAt || new Date().toISOString() : new Date().toISOString(),
      },
      { merge: true }
    );
    return { proceed: true };
  });

  if (!lockOutcome.proceed) {
    if (lockOutcome.alreadySent) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "success",
          alreadySent: true,
          requestId,
          recipient: lockOutcome.existing?.recipientEmail || recipientEmail,
          attachmentsCount: 2,
          sentAt: lockOutcome.existing?.sentAt,
          message: "รายงานการอบรมสำหรับคำขอนี้ถูกส่งเรียบร้อยแล้ว",
        }),
      };
    }
    return {
      statusCode: 429,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "DISPATCH_IN_PROGRESS",
        message: "กำลังดำเนินการส่งรายงานนี้อยู่ กรุณารอสักครู่",
      }),
    };
  }

  const courseData = courseDoc.data() || {};
  const gasPayload = {
    action: "send_training_report",
    secretToken: gasSecret,
    requestId,
    courseId,
    courseTitle: sanitizeHeaderString(bodyData.courseTitle || courseData.title, 300),
    trainingDate: sanitizeHeaderString(bodyData.trainingDate || courseData.date, 160),
    recipientName: recipientName || "อ.จักกรี เสริมทรัพย์",
    recipientEmail,
    subject: sanitizeHeaderString(bodyData.subject, 300),
    body: sanitizeBodyString(bodyData.body, 20000),
    htmlBody: sanitizeBodyString(bodyData.htmlBody, 40000),
    senderName: "สำนักพัฒนาการเรียนรู้ (LDO) มหาวิทยาลัยกรุงเทพ",
    attachments: {
      csv: {
        filename: csvCheck.filename,
        mimeType: "text/csv",
        base64: bodyData.attachments.csv.base64.trim(),
      },
      pdf: {
        filename: pdfCheck.filename,
        mimeType: "application/pdf",
        base64: bodyData.attachments.pdf.base64.trim(),
      },
    },
  };

  let gasResponse: Response;
  try {
    gasResponse = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gasPayload),
      redirect: "follow",
    });
  } catch (err: any) {
    await logRef.update({
      status: "unknown",
      error: `GAS network/timeout: ${err?.message || String(err)}`,
      updatedAt: new Date().toISOString(),
    });
    return {
      statusCode: 504,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "unknown",
        code: "GAS_TIMEOUT",
        requestId,
        message:
          "ไม่สามารถยืนยันผลการส่งจาก Google Apps Script ได้ (Delivery status unknown) — กรุณาตรวจสอบอีเมลผู้รับก่อนส่งซ้ำ",
      }),
    };
  }

  let gasText = "";
  let gasJson: any = null;
  try {
    gasText = await gasResponse.text();
    gasJson = gasText ? JSON.parse(gasText) : null;
  } catch {
    gasJson = null;
  }

  if (!gasResponse.ok || !gasJson) {
    await logRef.update({
      status: "unknown",
      error: `Unexpected GAS HTTP ${gasResponse.status}`,
      updatedAt: new Date().toISOString(),
    });
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "unknown",
        code: "GAS_AMBIGUOUS_RESPONSE",
        requestId,
        message: `เซิร์ฟเวอร์อีเมลตอบกลับไม่สมบูรณ์ (HTTP ${gasResponse.status}) — กรุณาตรวจสอบกล่องจดหมายก่อนส่งซ้ำ`,
      }),
    };
  }

  if (gasJson.status === "success") {
    const sentAt = gasJson.sentAt || new Date().toISOString();
    await logRef.update({
      status: "sent",
      sentAt,
      attachmentsCount: gasJson.attachmentsCount ?? 2,
      updatedAt: new Date().toISOString(),
    });
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "success",
        requestId,
        recipient: gasJson.recipient || recipientEmail,
        attachmentsCount: gasJson.attachmentsCount ?? 2,
        sentAt,
        message: "ส่งรายงานการอบรมพร้อมไฟล์แนบ CSV และ PDF สำเร็จแล้ว",
      }),
    };
  }

  await logRef.update({
    status: "failed",
    error: gasJson.message || "GAS rejected request",
    updatedAt: new Date().toISOString(),
  });

  return {
    statusCode: 502,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      status: "error",
      code: gasJson.code || "GAS_DELIVERY_FAILED",
      requestId,
      message: gasJson.message || "Google Apps Script ปฏิเสธการส่งอีเมลรายงาน",
    }),
  };
}
