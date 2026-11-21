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
  "Cache-Control": "no-store",
};

const DEFAULT_FIREBASE_PROJECT_ID = "my-bu-app-2026-d4620";
const DEFAULT_FIRESTORE_DATABASE_ID = "(default)";

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

export interface PromotionHandlerDeps {
  db?: any;
  projectId?: string;
  databaseId?: string;
  verifyIdToken?: (token: string) => Promise<{ uid: string; email?: string; email_verified?: boolean }>;
  verifyAdmin?: (db: any, uid: string, email?: string, emailVerified?: boolean) => Promise<boolean>;
  fetchFn?: typeof fetch;
  gasUrl?: string;
  gasSecret?: string;
  skipRateLimit?: boolean;
}

function getFirebaseAdmin(): { app: App; db: Firestore; projectId: string; databaseId: string } | null {
  const projectId = (process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID).trim();
  const databaseId = (process.env.FIREBASE_FIRESTORE_DATABASE_ID || DEFAULT_FIRESTORE_DATABASE_ID).trim();

  const apps = getApps();
  if (apps.length > 0 && apps[0]) {
    const existing = apps[0];
    return { app: existing, db: getFirestore(existing, databaseId), projectId, databaseId };
  }

  try {
    let credential: any = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      credential = cert(sa);
    } else if (
      process.env.FIREBASE_PRIVATE_KEY &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      (process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID)
    ) {
      credential = cert({
        projectId,
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
      projectId,
    });

    return { app, db: getFirestore(app, databaseId), projectId, databaseId };
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

  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  return { valid: true, normalizedUrl: `${parsed.origin}${cleanPath}/` };
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
    `<tr><td align="left" style="text-align:left;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;margin:0;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">` +
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
  return handlePromotionWithDeps(event);
}

export async function handlePromotionWithDeps(
  event: HandlerEvent,
  deps?: PromotionHandlerDeps
): Promise<HandlerResponse> {
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

  const fb = deps?.db
    ? {
        app: null as unknown as App,
        db: deps.db,
        projectId: deps.projectId || DEFAULT_FIREBASE_PROJECT_ID,
        databaseId: deps.databaseId || DEFAULT_FIRESTORE_DATABASE_ID,
      }
    : getFirebaseAdmin();

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
    decodedToken = deps?.verifyIdToken
      ? await deps.verifyIdToken(idToken)
      : await getAuth(fb.app).verifyIdToken(idToken);
  } catch {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "error", code: "INVALID_TOKEN", message: "Invalid or expired Firebase ID token" }),
    };
  }

  const isAdmin = deps?.verifyAdmin
    ? await deps.verifyAdmin(fb.db, decodedToken.uid, decodedToken.email, decodedToken.email_verified)
    : await verifyAdminCaller(fb.db, decodedToken.uid, decodedToken.email, decodedToken.email_verified);

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

  if (!deps?.skipRateLimit && !checkInMemoryRateLimit(decodedToken.uid)) {
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

  // --- ACTION 0: SAFE ADMIN CAMPAIGN DELETE (DOES NOT REQUIRE GAS ENV) ---
  if (action === "delete_campaign") {
    const campaignId = sanitizeHeaderString(bodyData.campaignId, 128);
    if (!campaignId || campaignId.includes("/") || campaignId.includes("..")) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "MISSING_CAMPAIGN_ID",
          message: "Valid campaignId is required",
        }),
      };
    }

    if (bodyData.adminConfirmed !== true) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "CONFIRMATION_REQUIRED",
          message: "Explicit Admin confirmation (adminConfirmed=true) is required before deleting a campaign.",
        }),
      };
    }

    const evaluateDeletionAllowed = (
      cData: Record<string, any>,
      recipientDocs?: Array<{ status?: unknown }>,
      options?: { ignoreLock?: boolean }
    ): { allowed: boolean; code?: string; reason?: string } => {
      const cStatus = String(cData.status || "").trim();
      if (cStatus === "completed" || cStatus === "completed_with_issues") {
        return {
          allowed: false,
          code: "CAMPAIGN_COMPLETED_PROTECTED",
          reason: "แคมเปญที่ส่งเสร็จสิ้นแล้วถูกเก็บรักษาเป็นประวัติการส่ง ไม่สามารถลบได้",
        };
      }
      if (cStatus === "sending") {
        return {
          allowed: false,
          code: "CAMPAIGN_SENDING",
          reason: "แคมเปญกำลังอยู่ระหว่างการจัดส่ง (sending) ไม่สามารถลบได้",
        };
      }
      if (cStatus !== "draft" && cStatus !== "ready" && cStatus !== "paused") {
        return {
          allowed: false,
          code: "CAMPAIGN_STATUS_BLOCKED",
          reason: `สถานะแคมเปญ (${cStatus || "unknown"}) ไม่อนุญาตให้ลบ`,
        };
      }
      if (!options?.ignoreLock) {
        const lockUntilMs = cData.activeLockUntil ? new Date(cData.activeLockUntil).getTime() : 0;
        if (Number.isFinite(lockUntilMs) && lockUntilMs > Date.now()) {
          return {
            allowed: false,
            code: "CAMPAIGN_LOCKED",
            reason: "แคมเปญมี Lock การประมวลผลค้างอยู่ชั่วคราว กรุณารอให้การทำงานเสร็จสิ้นก่อน",
          };
        }
      }
      const hasSentDoc = Array.isArray(recipientDocs) && recipientDocs.some((r) => String(r.status || "") === "sent");
      if ((Number(cData.sentCount) || 0) > 0 || hasSentDoc) {
        return {
          allowed: false,
          code: "CAMPAIGN_HAS_SENT",
          reason: "แคมเปญนี้มีรายชื่อที่ส่งอีเมลแล้ว จึงถูกเก็บรักษาเป็นประวัติและไม่สามารถลบได้",
        };
      }
      const hasUnknownDoc =
        Array.isArray(recipientDocs) && recipientDocs.some((r) => String(r.status || "") === "unknown");
      if ((Number(cData.unknownCount) || 0) > 0 || hasUnknownDoc) {
        return {
          allowed: false,
          code: "CAMPAIGN_HAS_UNKNOWN",
          reason: "แคมเปญนี้มีรายชื่อสถานะ Unknown ที่ต้องตรวจสอบก่อน จึงไม่สามารถลบได้",
        };
      }
      const hasProcessingDoc =
        Array.isArray(recipientDocs) && recipientDocs.some((r) => String(r.status || "") === "processing");
      if (hasProcessingDoc) {
        return {
          allowed: false,
          code: "CAMPAIGN_HAS_PROCESSING",
          reason: "มีรายชื่อผู้รับกำลังอยู่ในสถานะ Processing ไม่สามารถลบได้",
        };
      }
      return { allowed: true };
    };

    const campaignRef = fb.db.collection("promotion_campaigns").doc(campaignId);
    const recipientsColl = campaignRef.collection("recipients");

    let txOutcome: { ok: boolean; statusCode?: number; code?: string; message?: string; cData?: Record<string, any> };
    try {
      txOutcome = await fb.db.runTransaction(async (tx: any) => {
        const cSnap = await tx.get(campaignRef);
        if (!cSnap.exists) {
          return {
            ok: false,
            statusCode: 404,
            code: "CAMPAIGN_NOT_FOUND",
            message: "ไม่พบแคมเปญที่ต้องการลบในฐานข้อมูล (อาจถูกลบไปแล้ว)",
          };
        }
        const cData = cSnap.data() || {};
        const preCheck = evaluateDeletionAllowed(cData);
        if (!preCheck.allowed) {
          return {
            ok: false,
            statusCode: 409,
            code: preCheck.code,
            message: preCheck.reason,
          };
        }
        const nowIso = new Date().toISOString();
        const lockUntil = new Date(Date.now() + 30_000).toISOString();
        tx.update(campaignRef, {
          activeLockUntil: lockUntil,
          updatedAt: nowIso,
        });
        return { ok: true, cData };
      });
    } catch (err: any) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "DELETE_PRECHECK_FAILED",
          message: err?.message || "ไม่สามารถตรวจสอบสถานะแคมเปญก่อนลบได้",
        }),
      };
    }

    if (!txOutcome.ok) {
      return {
        statusCode: txOutcome.statusCode || 409,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: txOutcome.code || "CAMPAIGN_DELETE_BLOCKED",
          message: txOutcome.message || "ไม่สามารถลบแคมเปญได้",
        }),
      };
    }

    let deletedRecipientsCount = 0;
    try {
      const recipientsSnap = await recipientsColl.get();
      const recipientDocsData = recipientsSnap.docs.map((d: any) => d.data() || {});
      const deepCheck = evaluateDeletionAllowed(txOutcome.cData || {}, recipientDocsData, { ignoreLock: true });

      if (!deepCheck.allowed) {
        // Release lock & sync accurate counts from subcollection so UI stays truthful
        let sentCount = 0;
        let failedCount = 0;
        let pendingCount = 0;
        let unknownCount = 0;
        let skippedCount = 0;
        recipientDocsData.forEach((r: any) => {
          const s = String(r?.status || "pending");
          if (s === "sent") sentCount++;
          else if (s === "failed") failedCount++;
          else if (s === "unknown" || s === "processing") unknownCount++;
          else if (s === "skipped") skippedCount++;
          else pendingCount++;
        });
        await campaignRef.update({
          activeLockUntil: "",
          totalRecipients: recipientDocsData.length,
          sentCount,
          failedCount,
          pendingCount,
          unknownCount,
          skippedCount,
          updatedAt: new Date().toISOString(),
        });
        return {
          statusCode: 409,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            status: "error",
            code: deepCheck.code,
            message: deepCheck.reason,
          }),
        };
      }

      // Delete all subcollection recipient documents in safe chunks BEFORE deleting parent doc
      const CHUNK_SIZE = 380;
      for (let i = 0; i < recipientsSnap.docs.length; i += CHUNK_SIZE) {
        const slice = recipientsSnap.docs.slice(i, i + CHUNK_SIZE);
        const delBatch = fb.db.batch();
        for (const rDoc of slice) {
          delBatch.delete(rDoc.ref);
        }
        await delBatch.commit();
        deletedRecipientsCount += slice.length;
      }

      // Double-check subcollection is empty before deleting parent campaign document
      const leftoverSnap = await recipientsColl.limit(1).get();
      if (!leftoverSnap.empty) {
        throw new Error("Recipient subcollection still contains documents after batch cleanup");
      }

      await campaignRef.delete();

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "success",
          campaignId,
          deletedRecipientsCount,
          message: `ลบแคมเปญ และรายชื่อผู้รับ ${deletedRecipientsCount} รายการเรียบร้อยแล้ว`,
        }),
      };
    } catch (err: any) {
      // Partial failure recovery: release lock & recalculate remaining counts on parent doc
      let remainingRecipientsCount: number | undefined;
      try {
        const remainingSnap = await recipientsColl.get();
        remainingRecipientsCount = remainingSnap.docs.length;
        let failedCount = 0;
        let pendingCount = 0;
        let skippedCount = 0;
        remainingSnap.docs.forEach((d: any) => {
          const s = String(d.data()?.status || "pending");
          if (s === "failed") failedCount++;
          else if (s === "skipped") skippedCount++;
          else pendingCount++;
        });
        await campaignRef.update({
          activeLockUntil: "",
          totalRecipients: remainingRecipientsCount,
          failedCount,
          pendingCount,
          skippedCount,
          updatedAt: new Date().toISOString(),
        });
      } catch (rescueErr) {
        console.error("[send-course-promotion] Delete rescue lock release failed:", rescueErr);
      }

      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "DELETE_PARTIAL_FAILURE",
          partialFailure: true,
          campaignId,
          deletedRecipientsCount,
          remainingRecipientsCount,
          message:
            `การลบแคมเปญขัดข้องกลางทาง (${err?.message || "Batch delete error"}) — ลบผู้รับไปแล้ว ${deletedRecipientsCount} รายการ` +
            (typeof remainingRecipientsCount === "number" ? ` คงเหลือ ${remainingRecipientsCount} รายการ` : "") +
            " สามารถกดลองลบอีกครั้งได้อย่างปลอดภัย",
        }),
      };
    }
  }

  const gasUrl = (deps?.gasUrl ?? process.env.GAS_PROMOTION_URL ?? "").trim();
  const gasSecret = (deps?.gasSecret ?? process.env.GAS_PROMOTION_SECRET ?? "").trim();
  const fetchFn = deps?.fetchFn || fetch;

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
      const gasRes = await fetchFn(gasUrl, {
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
      const gasRes = await fetchFn(gasUrl, {
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

  const campaignId = sanitizeHeaderString(bodyData.campaignId, 128);
  const requestedBatchSize = Math.min(
    MAX_BATCH_SIZE,
    Math.max(1, Number(bodyData.batchSize) || DEFAULT_BATCH_SIZE)
  );

  if (!campaignId || campaignId.includes("/") || campaignId.includes("..")) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "MISSING_CAMPAIGN_ID",
        message: "Valid campaignId is required",
      }),
    };
  }

  const campaignRef = fb.db.collection("promotion_campaigns").doc(campaignId);
  const campaignSnap = await campaignRef.get();
  if (!campaignSnap.exists) {
    console.warn(
      `[send-course-promotion] CAMPAIGN_NOT_FOUND project=${fb.projectId} db=${fb.databaseId} campaignId=${campaignId}`
    );
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "CAMPAIGN_NOT_FOUND",
        message: `ไม่พบแคมเปญในฐานข้อมูล (campaignId: ${campaignId}, db: ${fb.databaseId})`,
      }),
    };
  }

  const campaignData = campaignSnap.data() || {};
  const courseId = String(campaignData.courseId || "").trim();
  const language: "th" | "en" = campaignData.language === "en" ? "en" : "th";

  if (!courseId || courseId.includes("/") || courseId.includes("..")) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "COURSE_NOT_FOUND",
        message: "Campaign document is missing a valid courseId",
      }),
    };
  }

  const courseSnap = await fb.db.collection("courses").doc(courseId).get();
  if (!courseSnap.exists) {
    console.warn(
      `[send-course-promotion] COURSE_NOT_FOUND project=${fb.projectId} db=${fb.databaseId} campaignId=${campaignId} courseId=${courseId}`
    );
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "COURSE_NOT_FOUND",
        message: `ไม่พบหลักสูตรเป้าหมายในฐานข้อมูล (courseId: ${courseId})`,
      }),
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
  suppressionSnap.docs.forEach((d: any) => {
    const email = String(d.data()?.email || "").trim().toLowerCase();
    if (email) suppressedEmails.add(email);
  });

  // Acquire campaign batch lock & claim up to `requestedBatchSize` confirmed `pending` recipients transactionally
  const recipientsColl = campaignRef.collection("recipients");
  const batchLockResult = await fb.db.runTransaction(async (tx: any) => {
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
  let preSendRejectedCode = "";
  let lastBatchError = "";

  const recomputeAndFinalizeCampaign = async (errNote?: string) => {
    const allRecipientsSnap = await recipientsColl.get();
    let totalSent = 0;
    let totalFailed = 0;
    let totalPending = 0;
    let totalUnknown = 0;
    let totalSkipped = 0;

    allRecipientsSnap.docs.forEach((d: any) => {
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
      registrationUrl: regCheck.normalizedUrl,
      activeLockUntil: "",
      totalRecipients: allRecipientsSnap.docs.length,
      sentCount: totalSent,
      failedCount: totalFailed,
      pendingCount: totalPending,
      unknownCount: totalUnknown,
      skippedCount: totalSkipped,
      remainingQuota: remainingDailyQuota,
      lastProcessedAt: nowDone,
      ...(errNote ? { lastBatchError: errNote } : {}),
      updatedAt: nowDone,
    });

    return {
      totalSent,
      totalFailed,
      totalPending,
      totalUnknown,
      totalSkipped,
      nextCampaignStatus,
    };
  };

  try {
    if (claimed.length > 0) {
      const messages = claimed.map((rec: any) => {
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
        gasRes = await fetchFn(gasUrl, {
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
        // Request timed out or upstream returned non-JSON/error after send attempt -> mark claimed recipients UNKNOWN (never blindly resend)
        lastBatchError =
          lastBatchError ||
          `Upstream GAS gateway error (HTTP ${gasRes?.status || 502}) — explicit Admin review required`;
        for (const rec of claimed) {
          updateBatch.update(rec.ref, {
            status: "unknown",
            error: lastBatchError,
            updatedAt: nowIso,
          });
          unknownCountDelta++;
        }
      } else if (gasJson.status === "error" && (!Array.isArray(gasJson.results) || gasJson.results.length === 0)) {
        // Complete pre-send rejection (e.g. bad GAS secret, quota 0 before first send, lock timeout)
        const isQuotaError = gasJson.code === "QUOTA_EXHAUSTED";
        if (isQuotaError) quotaExhausted = true;
        else preSendRejectedCode = String(gasJson.code || "UPSTREAM_ERROR");
        lastBatchError = gasJson.message || "GAS rejected batch before sending";
        for (const rec of claimed) {
          // Revert only newly claimed recipients to pending safely since zero emails were attempted!
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

    const summary = await recomputeAndFinalizeCampaign(lastBatchError || undefined);
    const hasAmbiguousBatchFailure =
      claimed.length > 0 && unknownCountDelta === claimed.length && Boolean(lastBatchError);
    const hasPreSendUpstreamError = Boolean(preSendRejectedCode);

    return {
      statusCode: hasAmbiguousBatchFailure || hasPreSendUpstreamError ? 502 : 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: hasAmbiguousBatchFailure || hasPreSendUpstreamError ? "error" : "success",
        ...(hasAmbiguousBatchFailure
          ? { code: "UPSTREAM_ERROR" }
          : hasPreSendUpstreamError
          ? { code: preSendRejectedCode }
          : {}),
        processedCount: claimed.length,
        sentCount: sentCountDelta,
        failedCount: failedCountDelta,
        unknownCount: unknownCountDelta,
        skippedCount: skippedCountDelta,
        remainingPending: summary.totalPending,
        remainingDailyQuota,
        quotaExhausted,
        campaignStatus: summary.nextCampaignStatus,
        message: quotaExhausted
          ? "โควตาการส่งอีเมลรายวันของ Google Apps Script หมดแล้ว ระบบหยุดชั่วคราวโดยคงผู้รับที่เหลือเป็น Pending เพื่อส่งต่อได้ภายหลัง"
          : lastBatchError || "ประมวลผลชุดข้อมูลเรียบร้อยแล้ว",
      }),
    };
  } catch (err: any) {
    // Unexpected post-claim failure: never reset claimed processing rows to pending; mark Unknown and release lock
    const errMsg = err?.message || "Unexpected server error after claiming recipients";
    const nowErr = new Date().toISOString();
    try {
      if (claimed.length > 0) {
        const rescueBatch = fb.db.batch();
        for (const rec of claimed) {
          rescueBatch.update(rec.ref, {
            status: "unknown",
            error: `Post-claim server error (${errMsg}) — explicit Admin review required`,
            updatedAt: nowErr,
          });
        }
        await rescueBatch.commit();
      }
      await recomputeAndFinalizeCampaign(errMsg);
    } catch (rescueErr) {
      console.error("[send-course-promotion] Rescue lock release error:", rescueErr);
    }

    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "UPSTREAM_ERROR",
        processedCount: claimed.length,
        unknownCount: claimed.length,
        message: `เกิดข้อผิดพลาดระหว่างจัดส่งชุดข้อมูล (${errMsg}) — ผู้รับในชุดนี้ถูกทำเครื่องหมายเป็น Unknown เพื่อป้องกันการส่งซ้ำ`,
      }),
    };
  }
}
