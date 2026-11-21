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

const MAX_REQUEST_BYTES = 2.5 * 1024 * 1024; // 2.5 MB
const MAX_POSTER_BYTES = 800 * 1024; // 800 KB
const MAX_BATCH_SIZE = 25;
const DEFAULT_BATCH_SIZE = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_CALLS_PER_WINDOW = 12;

// Warm-instance in-memory rate limiter (complemented by Firestore lock cooldown)
const adminRateBuckets = new Map<string, number[]>();

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

export function isAuthorizedBuEmail(email: unknown): boolean {
  if (!email || typeof email !== "string") return false;
  const clean = email.trim().toLowerCase();
  if (!clean || clean.length > 254) return false;
  return /^[a-z0-9._%+-]+@bu\.ac\.th$/i.test(clean);
}

export function sanitizeHeaderString(value: unknown, maxLen: number = 250): string {
  if (!value) return "";
  return String(value).replace(/[\r\n]+/g, " ").trim().slice(0, maxLen);
}

export function sanitizeBodyString(value: unknown, maxLen: number = 8000): string {
  if (!value) return "";
  return String(value).trim().slice(0, maxLen);
}

export function escapeHtml(str: unknown): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function containsDangerousHtmlOrScript(raw: unknown): boolean {
  if (!raw || typeof raw !== "string") return false;
  return (
    /<\s*(script|iframe|object|embed|form)\b/i.test(raw) ||
    /\bon[a-z]+\s*=/i.test(raw) ||
    /javascript\s*:/i.test(raw)
  );
}

export function validatePublishedRegistrationUrl(rawUrl: unknown): {
  valid: boolean;
  normalizedUrl?: string;
  reason?: string;
} {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!trimmed || trimmed.length > 1000) {
    return { valid: false, reason: "Missing or overly long registration URL" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: "Invalid registration URL syntax" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "Registration URL must use https://" };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    /^ais-(pre|dev)-/i.test(host) ||
    host === "run.app" ||
    host.endsWith(".run.app") ||
    /^deploy-preview-\d+--/i.test(host) ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".local")
  ) {
    return { valid: false, reason: "Preview or localhost registration URLs are not allowed" };
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

function hasValidImageMagicBytes(buf: Buffer, mimeType: string): boolean {
  if (buf.length < 8) return false;
  if (mimeType === "image/jpeg") {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (mimeType === "image/gif") {
    return buf.subarray(0, 4).toString("ascii") === "GIF8";
  }
  if (mimeType === "image/webp") {
    return (
      buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

export function validatePosterPayload(poster: any): {
  valid: boolean;
  mode: "course_url" | "custom_url" | "inline_cid" | "none";
  publicUrl?: string;
  inlineBase64?: string;
  inlineMimeType?: string;
  inlineFilename?: string;
  error?: string;
} {
  if (!poster || typeof poster !== "object" || !poster.mode || poster.mode === "none") {
    return { valid: true, mode: "none" };
  }

  const mode = String(poster.mode);
  if (mode === "course_url" || mode === "custom_url") {
    const rawUrl = typeof poster.publicUrl === "string" ? poster.publicUrl.trim() : "";
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { valid: false, mode: "none", error: "Invalid poster HTTPS URL" };
    }
    if (parsed.protocol !== "https:") {
      return { valid: false, mode: "none", error: "Poster URL must use https://" };
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === "drive.google.com" ||
      host.endsWith(".drive.google.com") ||
      host === "docs.google.com"
    ) {
      return {
        valid: false,
        mode: "none",
        error: "Private Google Drive URLs cannot be exposed as public poster assets",
      };
    }
    if (
      /^ais-(pre|dev)-/i.test(host) ||
      host === "run.app" ||
      host.endsWith(".run.app") ||
      host === "localhost" ||
      host === "127.0.0.1"
    ) {
      return { valid: false, mode: "none", error: "Temporary preview URLs cannot be used for poster assets" };
    }
    return {
      valid: true,
      mode: mode as "course_url" | "custom_url",
      publicUrl: parsed.toString(),
    };
  }

  if (mode === "inline_cid") {
    const mime = sanitizeHeaderString(poster.inlineMimeType, 60).toLowerCase();
    const allowedMimes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
    if (!allowedMimes.has(mime)) {
      return { valid: false, mode: "none", error: "Unsupported poster image MIME type" };
    }
    const base64 = typeof poster.inlineBase64 === "string" ? poster.inlineBase64.trim() : "";
    if (!base64) {
      return { valid: false, mode: "none", error: "Missing inline poster Base64 payload" };
    }
    let decoded: Buffer;
    try {
      decoded = Buffer.from(base64, "base64");
    } catch {
      return { valid: false, mode: "none", error: "Invalid inline poster Base64 encoding" };
    }
    if (decoded.length === 0 || decoded.length > MAX_POSTER_BYTES) {
      return {
        valid: false,
        mode: "none",
        error: `Inline poster size must be between 1 byte and ${Math.round(MAX_POSTER_BYTES / 1024)} KB`,
      };
    }
    if (!hasValidImageMagicBytes(decoded, mime)) {
      return {
        valid: false,
        mode: "none",
        error: "Poster binary header does not match declared image MIME type",
      };
    }
    const filename = sanitizeHeaderString(poster.inlineFilename || "course_poster.jpg", 80).replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );
    return {
      valid: true,
      mode: "inline_cid",
      inlineBase64: base64,
      inlineMimeType: mime,
      inlineFilename: filename || "course_poster.jpg",
    };
  }

  return { valid: false, mode: "none", error: "Unsupported poster mode" };
}

function checkInMemoryRateLimit(uid: string): boolean {
  const now = Date.now();
  const timestamps = (adminRateBuckets.get(uid) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX_CALLS_PER_WINDOW) {
    adminRateBuckets.set(uid, timestamps);
    return false;
  }
  timestamps.push(now);
  adminRateBuckets.set(uid, timestamps);
  return true;
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
    // Fall through
  }
  return false;
}

const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const TH_WEEKDAYS = [
  "วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์",
];
const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const EN_WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function formatDateServer(dateStr: string | undefined, lang: "th" | "en"): string {
  if (!dateStr || typeof dateStr !== "string") return "";
  const match = dateStr.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return dateStr;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const d = new Date(year, month - 1, day, 12, 0, 0);
  if (lang === "en") {
    return `${EN_WEEKDAYS[d.getDay()] || ""}, ${EN_MONTHS[month - 1] || ""} ${day}, ${year}`;
  }
  return `${TH_WEEKDAYS[d.getDay()] || ""}ที่ ${day} ${TH_MONTHS[month - 1] || ""} ${year + 543}`;
}

function formatTimeServer(startTime?: string, endTime?: string, lang: "th" | "en" = "th"): string {
  if (!startTime && !endTime) return "";
  if (lang === "th") {
    const s = (startTime || "").trim().replace(":", ".");
    const e = (endTime || "").trim().replace(":", ".");
    if (s && e) return `${s}–${e} น.`;
    return `${s || e} น.`;
  }
  const to12h = (t?: string) => {
    if (!t) return "";
    const parts = t.trim().split(":");
    if (parts.length < 2) return t;
    const h = parseInt(parts[0], 10);
    const m = parts[1].padStart(2, "0");
    if (isNaN(h)) return t;
    return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
  };
  const s = to12h(startTime);
  const e = to12h(endTime);
  return s && e ? `${s} – ${e}` : s || e;
}

/**
 * Renders an email-safe HTML + plain-text promotional email purely from validated template data
 * and server-verified course fields, guaranteeing XSS immunity and personalized recipient greetings.
 */
function buildServerPromotionContent(params: {
  course: Record<string, any>;
  template: Record<string, any>;
  language: "th" | "en";
  registrationUrl: string;
  recipientName: string;
  posterSrc?: string;
  isTest: boolean;
}) {
  const { course, template, language, registrationUrl, recipientName, posterSrc, isTest } = params;
  const isEn = language === "en";
  const courseTitle = sanitizeHeaderString(course.title, 300) || (isEn ? "Training Workshop" : "หลักสูตรอบรม");

  const greetingPrefix = sanitizeHeaderString(
    template.greetingPrefix || (isEn ? "Dear" : "เรียน"),
    40
  );
  const neutralGreetingName = sanitizeHeaderString(
    template.neutralGreetingName || (isEn ? "Colleague" : "คณาจารย์และบุคลากรทุกท่าน"),
    80
  );

  const rawRecName = sanitizeHeaderString(recipientName, 120);
  const useNeutral = !rawRecName || (isEn && /[\u0E00-\u0E7F]/.test(rawRecName));
  const greetingLine = `${greetingPrefix} ${useNeutral ? neutralGreetingName : rawRecName}`;

  const rawSpeaker = sanitizeHeaderString(course.instructorName, 160);
  const speakerText = isEn && /[\u0E00-\u0E7F]/.test(rawSpeaker) ? "" : rawSpeaker;

  const sessionsRaw: any[] =
    Array.isArray(course.sessions) && course.sessions.length > 0
      ? course.sessions
      : [
          {
            date: course.date,
            startTime: course.startTime,
            endTime: course.endTime,
            locationDetail: course.locationDetail,
          },
        ];

  const scheduleRows = sessionsRaw.map((s, idx) => ({
    label:
      sessionsRaw.length > 1
        ? isEn
          ? `Day ${idx + 1}`
          : `วันที่ ${idx + 1}`
        : isEn
        ? "Schedule"
        : "วันเวลาอบรม",
    dateText: formatDateServer(s.date || course.date, language),
    timeText: formatTimeServer(s.startTime || course.startTime, s.endTime || course.endTime, language),
    venueText: sanitizeHeaderString(
      s.locationDetail || course.locationDetail || (isEn ? "Bangkok University" : "มหาวิทยาลัยกรุงเทพ"),
      200
    ),
  }));

  const subjectBase = sanitizeHeaderString(template.subject || courseTitle, 280);
  const subject = isTest && !subjectBase.startsWith("[TEST]") ? `[TEST] ${subjectBase}` : subjectBase;

  const headline = sanitizeHeaderString(
    template.headline || (isEn ? "You Are Invited to Join Our Upcoming Workshop" : "ขอเชิญเข้าร่วมการอบรมเชิงปฏิบัติการ"),
    200
  );
  const invitationMessage = sanitizeBodyString(template.invitationMessage, 3000);
  const includeDescription = template.includeDescription !== false;
  const descriptionText = includeDescription
    ? sanitizeBodyString(
        template.customDescription !== undefined ? template.customDescription : course.description,
        3000
      )
    : "";
  const ctaLabel = sanitizeHeaderString(
    template.ctaLabel || (isEn ? "Register Now" : "ลงทะเบียนเข้าอบรม"),
    60
  );
  const signatureTitle = sanitizeHeaderString(
    template.signatureTitle || (isEn ? "Learning Development Office (LDO)" : "สำนักพัฒนาการเรียนรู้ (Learning Development Office)"),
    160
  );
  const signatureOrg = sanitizeHeaderString(
    template.signatureOrg || (isEn ? "Bangkok University" : "มหาวิทยาลัยกรุงเทพ"),
    160
  );
  const footerNote = sanitizeBodyString(template.footerNote, 500);

  const safeTitle = escapeHtml(courseTitle);
  const safeGreeting = escapeHtml(greetingLine);
  const safeHeadline = escapeHtml(headline);
  const safeInvitation = escapeHtml(invitationMessage).replace(/\n/g, "<br>");
  const safeDescription = escapeHtml(descriptionText).replace(/\n/g, "<br>");
  const safeSpeaker = escapeHtml(speakerText);
  const safeCta = escapeHtml(ctaLabel);
  const safeRegUrl = escapeHtml(registrationUrl);

  const testBannerHtml = isTest
    ? `<tr><td style="background-color:#fef3c7;border-bottom:1px solid #f59e0b;padding:10px 24px;color:#92400e;font-size:12px;font-weight:bold;text-align:center;">[TEST EMAIL] Admin preview dispatch only — real campaign recipients were not contacted.</td></tr>`
    : "";

  const posterHtml = posterSrc
    ? `<tr><td style="padding:20px 24px 8px 24px;text-align:center;background-color:#ffffff;"><img src="${escapeHtml(posterSrc)}" alt="${safeTitle}" style="display:block;width:100%;max-width:552px;height:auto;border:0;border-radius:10px;margin:0 auto;" /></td></tr>`
    : "";

  const scheduleRowsHtml = scheduleRows
    .map(
      (row) =>
        `<tr>` +
        `<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;width:130px;font-size:13px;font-weight:bold;color:#8b0000;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:13px;color:#1e293b;line-height:1.5;">` +
        `<strong>${escapeHtml(row.dateText)}</strong>` +
        (row.timeText ? `<br><span style="color:#475569;">${isEn ? "Time" : "เวลา"}: ${escapeHtml(row.timeText)}</span>` : "") +
        (row.venueText ? `<br><span style="color:#475569;">${isEn ? "Venue" : "สถานที่"}: ${escapeHtml(row.venueText)}</span>` : "") +
        `</td></tr>`
    )
    .join("");

  const speakerRowHtml = safeSpeaker
    ? `<tr>` +
      `<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;width:130px;font-size:13px;font-weight:bold;color:#8b0000;">${isEn ? "Speaker" : "วิทยากร"}</td>` +
      `<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:13px;color:#1e293b;">${safeSpeaker}</td>` +
      `</tr>`
    : "";

  const htmlBody =
    `<!DOCTYPE html><html lang="${language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>` +
    `<body style="margin:0;padding:0;background-color:#f8fafc;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#1e293b;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc;padding:24px 12px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">` +
    testBannerHtml +
    `<tr><td style="background-color:#8b0000;padding:20px 24px;">` +
    `<p style="margin:0;font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:#fde68a;">` +
    `${isEn ? "BANGKOK UNIVERSITY • LEARNING DEVELOPMENT OFFICE" : "มหาวิทยาลัยกรุงเทพ • สำนักพัฒนาการเรียนรู้ (LDO)"}` +
    `</p>` +
    `<h1 style="margin:6px 0 0 0;font-size:20px;line-height:1.35;color:#ffffff;font-weight:bold;">${safeHeadline}</h1>` +
    `</td></tr>` +
    posterHtml +
    `<tr><td style="padding:20px 24px 12px 24px;">` +
    `<p style="margin:0 0 12px 0;font-size:15px;font-weight:bold;color:#0f172a;">${safeGreeting},</p>` +
    `<h2 style="margin:0 0 12px 0;font-size:20px;line-height:1.4;color:#8b0000;font-weight:bold;">${safeTitle}</h2>` +
    `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.7;color:#334155;">${safeInvitation}</p>` +
    (safeDescription
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;"><tr><td style="padding:14px 16px;font-size:13px;line-height:1.7;color:#334155;"><strong style="display:block;margin-bottom:4px;color:#0f172a;">${isEn ? "Course Overview" : "รายละเอียดหลักสูตร"}</strong>${safeDescription}</td></tr></table>`
      : "") +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px 0;border-top:2px solid #8b0000;">` +
    speakerRowHtml +
    scheduleRowsHtml +
    `</table>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" style="padding:6px 0 18px 0;">` +
    `<a href="${safeRegUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#8b0000;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:8px;">${safeCta}</a>` +
    `</td></tr></table>` +
    `<p style="margin:0;padding:12px 14px;background-color:#f8fafc;border-radius:8px;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">` +
    `${isEn ? "Direct Registration Link:" : "ลิงก์ลงทะเบียนโดยตรง:"}<br>` +
    `<a href="${safeRegUrl}" target="_blank" rel="noopener noreferrer" style="color:#8b0000;text-decoration:underline;">${safeRegUrl}</a>` +
    `</p></td></tr>` +
    `<tr><td style="padding:16px 24px 22px 24px;border-top:1px solid #e2e8f0;background-color:#ffffff;">` +
    `<p style="margin:0;font-size:14px;font-weight:bold;color:#8b0000;">${escapeHtml(signatureTitle)}</p>` +
    `<p style="margin:2px 0 12px 0;font-size:13px;color:#475569;">${escapeHtml(signatureOrg)}</p>` +
    `<p style="margin:0;font-size:11px;line-height:1.5;color:#94a3b8;">${escapeHtml(footerNote)}</p>` +
    `</td></tr></table></td></tr></table></body></html>`;

  const schedulePlain = scheduleRows
    .map((r) => `• ${r.label}: ${r.dateText}${r.timeText ? ` (${r.timeText})` : ""} | ${r.venueText}`)
    .join("\n");

  const textBody =
    (isTest ? "[TEST EMAIL — ADMIN PREVIEW ONLY]\n\n" : "") +
    `${greetingLine}\n\n${courseTitle}\n\n${invitationMessage}\n\n` +
    (descriptionText ? `${descriptionText}\n\n` : "") +
    (speakerText ? `${isEn ? "Speaker" : "วิทยากร"}: ${speakerText}\n` : "") +
    `${schedulePlain}\n\n${ctaLabel}: ${registrationUrl}\n\n${signatureTitle}\n${signatureOrg}\n\n${footerNote}`;

  const senderName = isEn
    ? "Learning Development Office (LDO)"
    : "สำนักพัฒนาการเรียนรู้ (LDO) มหาวิทยาลัยกรุงเทพ";

  return { subject, htmlBody, textBody, senderName };
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", code: "METHOD_NOT_ALLOWED", message: "Only POST supported" }),
    };
  }

  if (event.body && Buffer.byteLength(event.body, "utf8") > MAX_REQUEST_BYTES) {
    return {
      statusCode: 413,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", code: "PAYLOAD_TOO_LARGE", message: "Payload exceeds 2.5 MB limit" }),
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", code: "UNAUTHORIZED", message: "Missing Bearer token" }),
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
      body: JSON.stringify({ status: "error", code: "INVALID_TOKEN", message: "Invalid or expired Firebase ID token" }),
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
        message: "Administrator permission is required for course promotion campaigns.",
      }),
    };
  }

  if (!checkInMemoryRateLimit(decodedToken.uid)) {
    return {
      statusCode: 429,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "RATE_LIMITED",
        message: "Too many campaign requests in a short period. Please wait a few seconds.",
      }),
    };
  }

  let bodyData: any;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "{}";
    bodyData = JSON.parse(raw);
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", code: "INVALID_JSON", message: "Invalid JSON payload" }),
    };
  }

  const action = String(bodyData.action || "").trim();
  const gasUrl = (process.env.GAS_PROMOTION_URL || "").trim();
  const gasSecret = (process.env.GAS_PROMOTION_SECRET || "").trim();

  if (!gasUrl || !gasSecret) {
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "GATEWAY_UNCONFIGURED",
        message: "GAS_PROMOTION_URL and GAS_PROMOTION_SECRET are not configured in server environment variables.",
      }),
    };
  }

  // --- ACTION 1: CHECK DAILY QUOTA ---
  if (action === "check_quota") {
    try {
      const gasRes = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_quota", secretToken: gasSecret }),
        redirect: "follow",
      });
      const gasJson = await gasRes.json().catch(() => null);
      if (!gasRes.ok || !gasJson || gasJson.status === "error") {
        return {
          statusCode: 502,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            status: "error",
            code: gasJson?.code || "QUOTA_CHECK_FAILED",
            message: gasJson?.message || "Unable to verify MailApp daily quota",
          }),
        };
      }
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "success",
          remainingDailyQuota: gasJson.remainingDailyQuota,
        }),
      };
    } catch (err: any) {
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "GAS_UNREACHABLE",
          message: err?.message || "Failed to contact promotion GAS gateway",
        }),
      };
    }
  }

  // --- ACTION 2: SEND TEST EMAIL (DOES NOT MUTATE CAMPAIGN RECIPIENTS) ---
  if (action === "send_test") {
    const courseId = sanitizeHeaderString(bodyData.courseId, 128);
    const testEmail = sanitizeHeaderString(bodyData.testEmail, 160).toLowerCase();
    const language: "th" | "en" = bodyData.language === "en" ? "en" : "th";
    const template = bodyData.template || {};

    if (!courseId || !isAuthorizedBuEmail(testEmail)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "INVALID_TEST_REQUEST",
          message: "courseId and an authorized @bu.ac.th test email are required",
        }),
      };
    }

    if (
      containsDangerousHtmlOrScript(template.subject) ||
      containsDangerousHtmlOrScript(template.headline) ||
      containsDangerousHtmlOrScript(template.invitationMessage) ||
      containsDangerousHtmlOrScript(template.customDescription)
    ) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "UNSAFE_CONTENT",
          message: "Template contains disallowed HTML scripts or event handlers",
        }),
      };
    }

    const regCheck = validatePublishedRegistrationUrl(bodyData.registrationUrl);
    if (!regCheck.valid || !regCheck.normalizedUrl) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "error", code: "INVALID_URL", message: regCheck.reason }),
      };
    }

    const posterCheck = validatePosterPayload(bodyData.poster);
    if (!posterCheck.valid) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "error", code: "INVALID_POSTER", message: posterCheck.error }),
      };
    }

    const courseDoc = await fb.db.collection("courses").doc(courseId).get();
    if (!courseDoc.exists) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "error", code: "COURSE_NOT_FOUND", message: "Course not found" }),
      };
    }
    const courseData = courseDoc.data() || {};

    const posterSrc =
      posterCheck.mode === "inline_cid"
        ? "cid:coursePoster"
        : posterCheck.publicUrl || undefined;

    const rendered = buildServerPromotionContent({
      course: courseData,
      template,
      language,
      registrationUrl: regCheck.normalizedUrl,
      recipientName: sanitizeHeaderString(bodyData.testName, 120),
      posterSrc,
      isTest: true,
    });

    try {
      const gasRes = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_course_promotion",
          secretToken: gasSecret,
          isTest: true,
          campaignId: sanitizeHeaderString(bodyData.campaignId || "test_preview", 80),
          language,
          senderName: rendered.senderName,
          poster:
            posterCheck.mode === "inline_cid"
              ? {
                  mode: "inline_cid",
                  cidName: "coursePoster",
                  mimeType: posterCheck.inlineMimeType,
                  filename: posterCheck.inlineFilename,
                  base64: posterCheck.inlineBase64,
                }
              : undefined,
          messages: [
            {
              recipientId: `test_${Date.now()}`,
              to: testEmail,
              subject: rendered.subject,
              textBody: rendered.textBody,
              htmlBody: rendered.htmlBody,
            },
          ],
        }),
        redirect: "follow",
      });

      const gasJson = await gasRes.json().catch(() => null);
      if (!gasRes.ok || !gasJson || gasJson.status === "error") {
        return {
          statusCode: 502,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            status: "error",
            code: gasJson?.code || "TEST_SEND_FAILED",
            message: gasJson?.message || "Failed to send test email via GAS",
          }),
        };
      }

      const singleResult = Array.isArray(gasJson.results) ? gasJson.results[0] : null;
      if (singleResult && singleResult.status !== "sent") {
        return {
          statusCode: 502,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            status: "error",
            code: "TEST_SEND_REJECTED",
            message: singleResult.error || "GAS failed to dispatch test email",
          }),
        };
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "success",
          message: `ส่งอีเมลทดสอบ [TEST] ไปยัง ${testEmail} แล้ว (ไม่มีผลต่อสถานะผู้รับในแคมเปญ)`,
          remainingDailyQuota: gasJson.remainingDailyQuota ?? null,
        }),
      };
    } catch (err: any) {
      return {
        statusCode: 504,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "GAS_TIMEOUT",
          message: err?.message || "Timeout contacting promotion gateway for test send",
        }),
      };
    }
  }

  // --- ACTION 3: RESUMABLE IDEMPOTENT BATCH DISPATCH ---
  if (action !== "dispatch_batch") {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "INVALID_ACTION",
        message: "Unsupported action for send-course-promotion gateway",
      }),
    };
  }

  const campaignId = sanitizeHeaderString(bodyData.campaignId, 128).replace(/[^a-zA-Z0-9_-]/g, "_");
  const requestedBatchSize = Math.min(
    MAX_BATCH_SIZE,
    Math.max(1, Number(bodyData.batchSize) || DEFAULT_BATCH_SIZE)
  );

  if (!campaignId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", code: "MISSING_CAMPAIGN_ID", message: "campaignId is required" }),
    };
  }

  const campaignRef = fb.db.collection("promotion_campaigns").doc(campaignId);
  const campaignSnap = await campaignRef.get();
  if (!campaignSnap.exists) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", code: "CAMPAIGN_NOT_FOUND", message: "Promotion campaign not found" }),
    };
  }

  const campaignData = campaignSnap.data() || {};
  const courseId = String(campaignData.courseId || "");
  const language: "th" | "en" = campaignData.language === "en" ? "en" : "th";

  const courseSnap = await fb.db.collection("courses").doc(courseId).get();
  if (!courseSnap.exists) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", code: "COURSE_NOT_FOUND", message: "Target course does not exist" }),
    };
  }
  const courseData = courseSnap.data() || {};

  const regCheck = validatePublishedRegistrationUrl(campaignData.registrationUrl);
  if (!regCheck.valid || !regCheck.normalizedUrl) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", code: "INVALID_URL", message: regCheck.reason }),
    };
  }

  const template = campaignData.template || {};
  if (
    containsDangerousHtmlOrScript(template.subject) ||
    containsDangerousHtmlOrScript(template.headline) ||
    containsDangerousHtmlOrScript(template.invitationMessage) ||
    containsDangerousHtmlOrScript(template.customDescription)
  ) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", code: "UNSAFE_CONTENT", message: "Campaign template failed security validation" }),
    };
  }

  // Validate poster (either inline_cid provided in batch request or stored URL)
  const posterInput = bodyData.poster || {
    mode: campaignData.posterMode || "none",
    publicUrl: campaignData.posterUrl,
  };
  const posterCheck = validatePosterPayload(posterInput);
  if (!posterCheck.valid) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", code: "INVALID_POSTER", message: posterCheck.error }),
    };
  }

  // Fetch authoritative suppression list from Firestore so suppressed recipients are NEVER emailed
  const suppressionSnap = await fb.db.collection("promotion_suppressions").get();
  const suppressedEmails = new Set<string>();
  suppressionSnap.docs.forEach((d) => {
    const email = String(d.data()?.email || "").trim().toLowerCase();
    if (email) suppressedEmails.add(email);
  });

  // Acquire campaign batch lock & claim up to `requestedBatchSize` confirmed `pending` recipients transactionally
  const recipientsColl = campaignRef.collection("recipients");
  const batchLockResult = await fb.db.runTransaction(async (tx) => {
    const cSnap = await tx.get(campaignRef);
    const cData = cSnap.data() || {};
    const lockUntil = cData.activeLockUntil ? new Date(cData.activeLockUntil).getTime() : 0;
    if (lockUntil && lockUntil > Date.now()) {
      return { locked: true, claimed: [] as any[] };
    }

    const pendingSnap = await tx.get(
      recipientsColl.where("status", "==", "pending").limit(requestedBatchSize)
    );

    if (pendingSnap.empty) {
      return { locked: false, empty: true, claimed: [] as any[] };
    }

    const nowIso = new Date().toISOString();
    const nextLockUntil = new Date(Date.now() + 25_000).toISOString();
    tx.update(campaignRef, {
      status: "sending",
      activeLockUntil: nextLockUntil,
      updatedAt: nowIso,
    });

    const claimed: any[] = [];
    for (const rDoc of pendingSnap.docs) {
      const rData = rDoc.data();
      const email = String(rData.email || "").trim().toLowerCase();

      if (!isAuthorizedBuEmail(email)) {
        tx.update(rDoc.ref, {
          status: "skipped",
          error: "Blocked server-side: non-@bu.ac.th or invalid email",
          updatedAt: nowIso,
        });
        continue;
      }

      if (suppressedEmails.has(email)) {
        tx.update(rDoc.ref, {
          status: "skipped",
          error: "Excluded server-side: present in suppression list",
          updatedAt: nowIso,
        });
        continue;
      }

      tx.update(rDoc.ref, {
        status: "processing",
        attempts: (Number(rData.attempts) || 0) + 1,
        updatedAt: nowIso,
      });

      claimed.push({
        id: rDoc.id,
        email,
        name: String(rData.name || ""),
        ref: rDoc.ref,
      });
    }

    return { locked: false, empty: false, claimed };
  });

  if (batchLockResult.locked) {
    return {
      statusCode: 429,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "BATCH_IN_PROGRESS",
        message: "กำลังประมวลผลชุดข้อมูลก่อนหน้านี้อยู่ กรุณารอสักครู่",
      }),
    };
  }

  const claimed = batchLockResult.claimed;
  const posterSrc =
    posterCheck.mode === "inline_cid"
      ? "cid:coursePoster"
      : posterCheck.publicUrl || undefined;

  let sentCountDelta = 0;
  let failedCountDelta = 0;
  let unknownCountDelta = 0;
  let skippedCountDelta = 0;
  let remainingDailyQuota: number | null = null;
  let quotaExhausted = false;
  let lastBatchError = "";

  if (claimed.length > 0) {
    const messages = claimed.map((rec) => {
      const rendered = buildServerPromotionContent({
        course: courseData,
        template,
        language,
        registrationUrl: regCheck.normalizedUrl!,
        recipientName: rec.name,
        posterSrc,
        isTest: false,
      });
      return {
        recipientId: rec.id,
        to: rec.email,
        subject: rendered.subject,
        textBody: rendered.textBody,
        htmlBody: rendered.htmlBody,
      };
    });

    const senderName =
      language === "en"
        ? "Learning Development Office (LDO)"
        : "สำนักพัฒนาการเรียนรู้ (LDO) มหาวิทยาลัยกรุงเทพ";

    let gasRes: Response | null = null;
    let gasJson: any = null;
    try {
      gasRes = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_course_promotion",
          secretToken: gasSecret,
          isTest: false,
          campaignId,
          language,
          senderName,
          poster:
            posterCheck.mode === "inline_cid"
              ? {
                  mode: "inline_cid",
                  cidName: "coursePoster",
                  mimeType: posterCheck.inlineMimeType,
                  filename: posterCheck.inlineFilename,
                  base64: posterCheck.inlineBase64,
                }
              : undefined,
          messages,
        }),
        redirect: "follow",
      });
      gasJson = await gasRes.json().catch(() => null);
    } catch (err: any) {
      lastBatchError = `GAS network/timeout: ${err?.message || String(err)}`;
    }

    const nowIso = new Date().toISOString();
    const updateBatch = fb.db.batch();

    if (!gasRes || !gasRes.ok || !gasJson) {
      // Request timed out or upstream returned non-JSON after send attempt -> mark recipients UNKNOWN (never blindly resend)
      for (const rec of claimed) {
        updateBatch.update(rec.ref, {
          status: "unknown",
          error: lastBatchError || `Upstream HTTP ${gasRes?.status || 504} — explicit Admin review required`,
          updatedAt: nowIso,
        });
        unknownCountDelta++;
      }
    } else if (gasJson.status === "error" && (!Array.isArray(gasJson.results) || gasJson.results.length === 0)) {
      // Complete pre-send rejection (e.g. bad GAS secret, quota 0 before first send, lock timeout)
      const isQuotaError = gasJson.code === "QUOTA_EXHAUSTED";
      if (isQuotaError) quotaExhausted = true;
      lastBatchError = gasJson.message || "GAS rejected batch before sending";
      for (const rec of claimed) {
        // Revert to pending safely since zero emails were attempted!
        updateBatch.update(rec.ref, {
          status: "pending",
          error: lastBatchError,
          updatedAt: nowIso,
        });
      }
    } else {
      remainingDailyQuota =
        typeof gasJson.remainingDailyQuota === "number" ? gasJson.remainingDailyQuota : null;
      quotaExhausted = Boolean(gasJson.quotaExhausted);

      const resultsMap = new Map<string, any>();
      if (Array.isArray(gasJson.results)) {
        for (const resItem of gasJson.results) {
          if (resItem?.recipientId) resultsMap.set(String(resItem.recipientId), resItem);
        }
      }

      for (const rec of claimed) {
        const outcome = resultsMap.get(rec.id);
        if (!outcome) {
          updateBatch.update(rec.ref, {
            status: "unknown",
            error: "No confirmation returned by GAS for this recipient — review required",
            updatedAt: nowIso,
          });
          unknownCountDelta++;
        } else if (outcome.status === "sent") {
          updateBatch.update(rec.ref, {
            status: "sent",
            sentAt: outcome.sentAt || nowIso,
            error: "",
            updatedAt: nowIso,
          });
          sentCountDelta++;
        } else if (outcome.status === "unattempted") {
          // Stopped cleanly before sending (quota exhausted or GAS time budget): return safely to pending
          updateBatch.update(rec.ref, {
            status: "pending",
            error: outcome.error || "Paused prior to send attempt (resumable)",
            updatedAt: nowIso,
          });
        } else if (outcome.status === "skipped") {
          updateBatch.update(rec.ref, {
            status: "skipped",
            error: outcome.error || "Skipped by mail service",
            updatedAt: nowIso,
          });
          skippedCountDelta++;
        } else {
          updateBatch.update(rec.ref, {
            status: "failed",
            error: outcome.error || "Failed to send via MailApp",
            updatedAt: nowIso,
          });
          failedCountDelta++;
        }
      }
    }

    await updateBatch.commit();
  }

  // Recompute authoritative aggregate counts cleanly & release lock
  const allRecipientsSnap = await recipientsColl.get();
  let totalSent = 0;
  let totalFailed = 0;
  let totalPending = 0;
  let totalUnknown = 0;
  let totalSkipped = 0;

  allRecipientsSnap.docs.forEach((d) => {
    const s = String(d.data()?.status || "pending");
    if (s === "sent") totalSent++;
    else if (s === "failed") totalFailed++;
    else if (s === "unknown" || s === "processing") totalUnknown++;
    else if (s === "skipped") totalSkipped++;
    else totalPending++;
  });

  let nextCampaignStatus = "paused";
  if (totalPending === 0) {
    nextCampaignStatus = totalFailed > 0 || totalUnknown > 0 ? "completed_with_issues" : "completed";
  }

  const nowDone = new Date().toISOString();
  await campaignRef.update({
    status: nextCampaignStatus,
    activeLockUntil: "",
    totalRecipients: allRecipientsSnap.docs.length,
    sentCount: totalSent,
    failedCount: totalFailed,
    pendingCount: totalPending,
    unknownCount: totalUnknown,
    skippedCount: totalSkipped,
    remainingQuota: remainingDailyQuota,
    lastProcessedAt: nowDone,
    ...(lastBatchError ? { lastBatchError } : {}),
    updatedAt: nowDone,
  });

  return {
    statusCode: lastBatchError && unknownCountDelta === claimed.length ? 504 : 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      status: lastBatchError && claimed.length === 0 ? "error" : "success",
      processedCount: claimed.length,
      sentCount: sentCountDelta,
      failedCount: failedCountDelta,
      unknownCount: unknownCountDelta,
      skippedCount: skippedCountDelta,
      remainingPending: totalPending,
      remainingDailyQuota,
      quotaExhausted,
      campaignStatus: nextCampaignStatus,
      message: quotaExhausted
        ? "โควตาการส่งอีเมลรายวันของ Google Apps Script หมดแล้ว ระบบหยุดชั่วคราวโดยคงผู้รับที่เหลือเป็น Pending เพื่อส่งต่อได้ภายหลัง"
        : lastBatchError || "ประมวลผลชุดข้อมูลเรียบร้อยแล้ว",
    }),
  };
}
