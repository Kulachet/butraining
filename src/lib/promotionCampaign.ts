import Papa from "papaparse";
import { Course, Instructor } from "../types";
import {
  formatDateEn,
  formatDateThai,
  formatInstructorName,
  formatSessionName,
  formatSessionTime,
  getCourseSessions,
} from "./utils";
import { escapeHtml } from "./registrationEmail";
import {
  buildCourseRegistrationUrl,
  isDisallowedPreviewOrLocalHostname,
  validatePublicAppUrl,
} from "./appUrl";
import { resolveCourseLang } from "../contexts/LanguageContext";
import { sanitizeCsvTextCell } from "./trainingReport";

export type CampaignLanguage = "th" | "en";

export type CampaignStatus =
  | "draft"
  | "ready"
  | "sending"
  | "paused"
  | "completed"
  | "completed_with_issues";

export type RecipientDeliveryStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "unknown"
  | "skipped";

export type RecipientSource = "paste" | "csv" | "instructor";

export type PosterMode = "course_url" | "custom_url" | "inline_cid" | "none";

export const PROMOTION_GATEWAY_ENDPOINT = "/api/send-course-promotion";
export const PROMOTION_GATEWAY_FALLBACK_ENDPOINT = "/.netlify/functions/send-course-promotion";
export const TRANSLATE_DESCRIPTION_ENDPOINT = "/api/translate-course-description";
export const TRANSLATE_DESCRIPTION_FALLBACK_ENDPOINT = "/.netlify/functions/translate-course-description";
export const MAX_TRANSLATION_SOURCE_CHARS = 6000;
export const DEFAULT_PROMOTION_BATCH_SIZE = 20;
export const MAX_PROMOTION_BATCH_SIZE = 25;
export const MAX_POSTER_BYTES = 800 * 1024; // 800 KB raw decoded limit for CID inline image
export const MAX_POSTER_RAW_FILE_BYTES = 5 * 1024 * 1024; // 5 MB pre-compression file upload cap

export interface PosterConfig {
  mode: PosterMode;
  publicUrl?: string;
  inlineBase64?: string;
  inlineMimeType?: string;
  inlineFilename?: string;
  width?: number;
  height?: number;
  byteSize?: number;
  blockedReason?: string;
}

export interface TranslationMetadata {
  sourceHash?: string;
  translatedAt?: string;
  model?: string;
  editedByAdmin?: boolean;
}

export interface TranslationCacheEntry {
  courseId: string;
  sourceHash: string;
  targetLanguage: CampaignLanguage;
  translatedText: string;
  editedByAdmin: boolean;
  translatedAt: string;
  model?: string;
}

export interface PromotionTemplateData {
  language: CampaignLanguage;
  subject: string;
  greetingPrefix: string;
  neutralGreetingName: string;
  headline: string;
  invitationMessage: string;
  ctaLabel: string;
  signatureTitle: string;
  signatureOrg: string;
  footerNote: string;
  includeDescription: boolean;
  customDescription?: string;
  translationMeta?: TranslationMetadata;
}

export interface RawRecipientCandidate {
  email: string;
  name?: string;
  department?: string;
  source: RecipientSource;
}

export interface ValidatedRecipient {
  id: string;
  email: string;
  name: string;
  department: string;
  source: RecipientSource;
}

export interface RejectedRecipient {
  email: string;
  rawInput: string;
  source: RecipientSource;
  reason: "invalid_format" | "unauthorized_domain" | "duplicate" | "suppressed";
  detail: string;
}

export interface RecipientReconciliationResult {
  eligible: ValidatedRecipient[];
  duplicates: RejectedRecipient[];
  invalid: RejectedRecipient[];
  suppressed: RejectedRecipient[];
  stats: {
    totalImported: number;
    uniqueValid: number;
    duplicateCount: number;
    invalidCount: number;
    suppressedCount: number;
    eligibleCount: number;
  };
}

export interface PromotionCampaignDoc {
  id: string;
  courseId: string;
  courseTitle: string;
  language: CampaignLanguage;
  subject: string;
  template: PromotionTemplateData;
  languageDrafts?: Partial<Record<CampaignLanguage, PromotionTemplateData>>;
  translationCache?: Partial<Record<CampaignLanguage, TranslationCacheEntry>>;
  registrationUrl: string;
  posterMode: PosterMode;
  posterUrl?: string;
  posterMeta?: {
    mimeType?: string;
    filename?: string;
    width?: number;
    height?: number;
    byteSize?: number;
  };
  status: CampaignStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  unknownCount: number;
  skippedCount: number;
  suppressedCount: number;
  batchSize: number;
  remainingQuota?: number | null;
  activeLockUntil?: string;
  lastProcessedAt?: string;
  lastBatchError?: string;
  createdByAdminUid: string;
  createdByAdminEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionRecipientDoc {
  id: string;
  campaignId: string;
  email: string;
  name: string;
  department: string;
  source: RecipientSource;
  status: RecipientDeliveryStatus;
  sentAt?: string;
  error?: string;
  attempts?: number;
  updatedAt: string;
}

export interface SuppressionEntry {
  id: string;
  email: string;
  reason: string;
  addedByAdminUid: string;
  addedByAdminEmail?: string;
  createdAt: string;
}

export interface CsvPreviewRow {
  rowIndex: number;
  email: string;
  name: string;
  department: string;
  isValidDomain: boolean;
}

export interface CsvParsePreviewResult {
  rows: CsvPreviewRow[];
  detectedColumns: {
    emailColumn: string | null;
    nameColumn: string | null;
    departmentColumn: string | null;
  };
  totalRawRows: number;
  warnings: string[];
}

const STRICT_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const BU_DOMAIN_REGEX = /^[a-zA-Z0-9._%+-]+@bu\.ac\.th$/i;

export function normalizeEmailAddress(raw: string | undefined | null): string {
  if (!raw || typeof raw !== "string") return "";
  return raw.trim().replace(/^mailto:/i, "").toLowerCase();
}

export function isValidEmailSyntax(email: string | undefined | null): boolean {
  const clean = normalizeEmailAddress(email);
  if (!clean || clean.length > 254) return false;
  return STRICT_EMAIL_REGEX.test(clean);
}

export function isAuthorizedUniversityEmail(email: string | undefined | null): boolean {
  const clean = normalizeEmailAddress(email);
  if (!clean || clean.length > 254) return false;
  return BU_DOMAIN_REGEX.test(clean);
}

/**
 * Generates a deterministic Firestore-safe document ID matching `^[a-zA-Z0-9_-]+$` (max 128 chars)
 * for campaign recipients so retries and double-clicks never create duplicate recipient rows.
 */
export function buildCampaignRecipientDocId(campaignId: string, rawEmail: string): string {
  const cleanEmail = normalizeEmailAddress(rawEmail);
  let hash = 2166136261;
  for (let i = 0; i < cleanEmail.length; i++) {
    hash ^= cleanEmail.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hexHash = (hash >>> 0).toString(16).padStart(8, "0");
  const slug = cleanEmail
    .replace(/@bu\.ac\.th$/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 48);
  const campaignPrefix = (campaignId || "camp").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return `${campaignPrefix}_${slug}_${hexHash}`.slice(0, 128);
}

export function buildSuppressionDocId(rawEmail: string): string {
  const cleanEmail = normalizeEmailAddress(rawEmail);
  let hash = 2166136261;
  for (let i = 0; i < cleanEmail.length; i++) {
    hash ^= cleanEmail.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hexHash = (hash >>> 0).toString(16).padStart(8, "0");
  const slug = cleanEmail.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return `${slug}_${hexHash}`.slice(0, 128);
}

/**
 * Validates external poster URLs:
 * - Must be HTTPS
 * - Must NOT be temporary AI Studio/Netlify preview or localhost
 * - Must NOT be a Google Drive private share/view URL (`drive.google.com`, `docs.google.com`)
 */
export function validateExternalPosterUrl(rawUrl: string | undefined | null): {
  valid: boolean;
  normalizedUrl?: string;
  isGoogleDriveUrl?: boolean;
  reason?: string;
} {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!trimmed) {
    return { valid: false, reason: "ยังไม่ได้ระบุ URL รูปโปสเตอร์" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: "รูปแบบ URL รูปโปสเตอร์ไม่ถูกต้อง" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "URL รูปโปสเตอร์ต้องใช้โปรโตคอล https:// เท่านั้น" };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "drive.google.com" ||
    host.endsWith(".drive.google.com") ||
    host === "docs.google.com"
  ) {
    return {
      valid: false,
      isGoogleDriveUrl: true,
      reason:
        "ไม่อนุญาตให้ใช้ลิงก์ Google Drive ส่วนตัวเป็นรูปภาพในอีเมลโดยตรง กรุณาอัปโหลดไฟล์โปสเตอร์เพื่อแนบแบบ Inline CID หรือใช้ Public HTTPS Image URL",
    };
  }

  if (isDisallowedPreviewOrLocalHostname(host)) {
    return {
      valid: false,
      reason: "ไม่อนุญาตให้ใช้ URL ชั่วคราว (*.run.app หรือ localhost) เป็นสินทรัพย์รูปภาพในอีเมล",
    };
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

/**
 * Extracts initial campaign poster configuration from an existing course record
 * without exposing private Google Drive URLs or huge unvalidated payloads.
 */
export function deriveInitialPosterFromCourse(course: Partial<Course> | null | undefined): PosterConfig {
  if (!course) return { mode: "none" };

  if (typeof course.bannerImageBase64 === "string" && course.bannerImageBase64.startsWith("data:image/")) {
    const commaIdx = course.bannerImageBase64.indexOf(",");
    const header = commaIdx > -1 ? course.bannerImageBase64.slice(0, commaIdx) : "";
    const base64 = commaIdx > -1 ? course.bannerImageBase64.slice(commaIdx + 1) : "";
    const mimeMatch = header.match(/^data:(image\/(?:jpeg|jpg|png|gif|webp));base64$/i);
    if (mimeMatch && base64) {
      const approxBytes = Math.floor((base64.length * 3) / 4);
      if (approxBytes <= MAX_POSTER_BYTES) {
        return {
          mode: "inline_cid",
          inlineBase64: base64,
          inlineMimeType: mimeMatch[1].toLowerCase() === "image/jpg" ? "image/jpeg" : mimeMatch[1].toLowerCase(),
          inlineFilename: "course_poster.jpg",
          byteSize: approxBytes,
        };
      }
      return {
        mode: "none",
        blockedReason: `ภาพแบนเนอร์เดิมของหลักสูตรมีขนาดใหญ่เกิน ${Math.round(MAX_POSTER_BYTES / 1024)} KB สำหรับแนบในอีเมล กรุณาอัปโหลดใหม่เพื่อบีบอัดอัตโนมัติ`,
      };
    }
  }

  if (typeof course.imageUrl === "string" && course.imageUrl.trim()) {
    const check = validateExternalPosterUrl(course.imageUrl);
    if (check.valid && check.normalizedUrl) {
      return {
        mode: "course_url",
        publicUrl: check.normalizedUrl,
      };
    }
    return {
      mode: "none",
      blockedReason: check.reason,
    };
  }

  return { mode: "none" };
}

/**
 * Validates and compresses an uploaded poster image file in browser using Canvas
 * while strictly preserving natural aspect ratio and checking file type & dimensions.
 */
export async function processUploadedPosterFile(file: File): Promise<PosterConfig> {
  const allowedMimes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);
  const fileMime = (file.type || "").toLowerCase();
  if (!allowedMimes.has(fileMime)) {
    throw new Error("รองรับเฉพาะไฟล์รูปภาพ PNG, JPEG, WebP หรือ GIF เท่านั้น");
  }

  if (file.size > MAX_POSTER_RAW_FILE_BYTES) {
    throw new Error("ไฟล์ต้นฉบับมีขนาดเกิน 5 MB กรุณาเลือกไฟล์ขนาดเล็กลง");
  }

  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("ไม่สามารถอ่านไฟล์รูปภาพได้"));
    reader.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("ไฟล์รูปภาพไม่สมบูรณ์หรือเสียหาย"));
    el.src = dataUrl;
  });

  if (img.width < 200 || img.height < 150) {
    throw new Error(`ความละเอียดภาพเล็กเกินไป (${img.width}x${img.height}px) กรุณาใช้ภาพอย่างน้อย 200x150 พิกเซล`);
  }
  if (img.width > 5000 || img.height > 5000) {
    throw new Error("ความละเอียดภาพสูงเกิน 5000px กรุณาลดขนาดภาพก่อนอัปโหลด");
  }

  const MAX_DIM = 960;
  let targetWidth = img.width;
  let targetHeight = img.height;

  if (targetWidth > MAX_DIM || targetHeight > MAX_DIM) {
    const scale = Math.min(MAX_DIM / targetWidth, MAX_DIM / targetHeight);
    targetWidth = Math.max(1, Math.round(targetWidth * scale));
    targetHeight = Math.max(1, Math.round(targetHeight * scale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("เบราว์เซอร์ไม่รองรับการประมวลผลภาพ Canvas");
  }
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  const outputMime = fileMime === "image/png" ? "image/png" : "image/jpeg";
  let compressedDataUrl = canvas.toDataURL(outputMime, 0.82);
  let base64 = compressedDataUrl.split(",")[1] || "";
  let byteSize = Math.floor((base64.length * 3) / 4);

  // If PNG is still larger than MAX_POSTER_BYTES, fall back to JPEG progressive compression
  if (byteSize > MAX_POSTER_BYTES) {
    for (const quality of [0.8, 0.68, 0.55]) {
      compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
      base64 = compressedDataUrl.split(",")[1] || "";
      byteSize = Math.floor((base64.length * 3) / 4);
      if (byteSize <= MAX_POSTER_BYTES) break;
    }
  }

  if (byteSize > MAX_POSTER_BYTES) {
    throw new Error(
      `ไม่สามารถย่อขนาดรูปภาพให้ต่ำกว่า ${Math.round(MAX_POSTER_BYTES / 1024)} KB ได้ กรุณาใช้ภาพที่มีขนาดเล็กลง`
    );
  }

  const finalMime = compressedDataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";
  const ext = finalMime === "image/png" ? "png" : "jpg";
  const safeName = (file.name || `poster.${ext}`).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);

  return {
    mode: "inline_cid",
    inlineBase64: base64,
    inlineMimeType: finalMime,
    inlineFilename: safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`,
    width: targetWidth,
    height: targetHeight,
    byteSize,
  };
}

/**
 * Parses multiline pasted email text separated by newlines, commas, semicolons, or whitespace.
 * Handles angled display names like `Name <user@bu.ac.th>` gracefully and supports 1,000+ entries.
 */
export function parseEmailAddressesText(rawText: string): RawRecipientCandidate[] {
  if (!rawText || typeof rawText !== "string") return [];
  const results: RawRecipientCandidate[] = [];

  // First split by newline, comma, semicolon to preserve optional "Name <email>" segments
  const roughTokens = rawText
    .split(/[\r\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const segment of roughTokens) {
    const angleMatch = segment.match(/^(.*?)<\s*([^>\s]+)\s*>$/);
    if (angleMatch) {
      const possibleName = angleMatch[1].trim().replace(/^["']+|["']+$/g, "").trim();
      const email = normalizeEmailAddress(angleMatch[2]);
      if (email) {
        results.push({
          email,
          name: possibleName || undefined,
          source: "paste",
        });
      }
      continue;
    }

    // Split remaining tokens by whitespace (space/tab)
    const spaceTokens = segment.split(/\s+/).filter(Boolean);
    for (const token of spaceTokens) {
      const cleaned = normalizeEmailAddress(token.replace(/^[<"']+|[>"']+$/g, ""));
      if (cleaned) {
        results.push({
          email: cleaned,
          source: "paste",
        });
      }
    }
  }

  return results;
}

/**
 * Parses CSV content (supporting UTF-8 and UTF-8 BOM `\uFEFF`) for preview before import.
 */
export function parseRecipientsCsvContent(csvText: string): CsvParsePreviewResult {
  const cleanText = typeof csvText === "string" ? csvText.replace(/^\uFEFF/, "") : "";
  const parsed = Papa.parse<Record<string, any>>(cleanText, {
    header: true,
    skipEmptyLines: true,
  });

  const warnings: string[] = [];
  if (parsed.errors && parsed.errors.length > 0) {
    warnings.push(`พบข้อผิดพลาดการอ่านบางบรรทัด (${parsed.errors.length} รายการ)`);
  }

  const fields = parsed.meta?.fields || [];
  const normalizedFields = fields.map((f) => ({
    original: f,
    clean: f.replace(/^\uFEFF/, "").trim().toLowerCase(),
  }));

  const pickHeader = (candidates: string[]): string | null => {
    for (const c of candidates) {
      const exact = normalizedFields.find((f) => f.clean === c);
      if (exact) return exact.original;
    }
    for (const c of candidates) {
      const partial = normalizedFields.find((f) => f.clean.includes(c));
      if (partial) return partial.original;
    }
    return null;
  };

  const emailCol = pickHeader(["email", "e-mail", "อีเมล", "mail", "university email"]);
  const nameCol = pickHeader(["name", "fullname", "full name", "ชื่อ-นามสกุล", "ชื่อ", "อาจารย์"]);
  const deptCol = pickHeader(["department", "faculty", "หน่วยงาน", "คณะ", "ภาควิชา", "สังกัด"]);

  if (!emailCol) {
    warnings.push("ไม่พบคอลัมน์อีเมลในไฟล์ CSV (รองรับชื่อหัวตาราง: email, อีเมล)");
  }

  const rows: CsvPreviewRow[] = [];
  (parsed.data || []).forEach((row, idx) => {
    const rawEmail = emailCol ? String(row[emailCol] ?? "").trim() : "";
    const email = normalizeEmailAddress(rawEmail);
    const name = nameCol ? String(row[nameCol] ?? "").trim() : "";
    const department = deptCol ? String(row[deptCol] ?? "").trim() : "";
    if (!email && !name) return;
    rows.push({
      rowIndex: idx + 1,
      email: email || rawEmail,
      name,
      department,
      isValidDomain: isAuthorizedUniversityEmail(email),
    });
  });

  return {
    rows,
    detectedColumns: {
      emailColumn: emailCol,
      nameColumn: nameCol,
      departmentColumn: deptCol,
    },
    totalRawRows: rows.length,
    warnings,
  };
}

/**
 * Reconciles, normalizes, deduplicates case-insensitively, checks @bu.ac.th policy,
 * filters suppressed recipients, and computes live summary counts.
 */
export function reconcileAndValidateRecipients(params: {
  campaignId: string;
  candidates: RawRecipientCandidate[];
  suppressedEmails: Set<string>;
  requireBuDomain?: boolean;
}): RecipientReconciliationResult {
  const { campaignId, candidates, suppressedEmails, requireBuDomain = true } = params;

  const seenEmails = new Map<string, ValidatedRecipient>();
  const duplicates: RejectedRecipient[] = [];
  const invalid: RejectedRecipient[] = [];
  const suppressed: RejectedRecipient[] = [];

  for (const cand of candidates) {
    const rawInput = (cand.email || "").trim();
    const email = normalizeEmailAddress(rawInput);

    if (!isValidEmailSyntax(email)) {
      invalid.push({
        email: email || rawInput,
        rawInput,
        source: cand.source,
        reason: "invalid_format",
        detail: "รูปแบบอีเมลไม่ถูกต้อง",
      });
      continue;
    }

    if (requireBuDomain && !isAuthorizedUniversityEmail(email)) {
      invalid.push({
        email,
        rawInput,
        source: cand.source,
        reason: "unauthorized_domain",
        detail: "ไม่อยู่ในโดเมนมหาวิทยาลัย (@bu.ac.th)",
      });
      continue;
    }

    if (suppressedEmails.has(email)) {
      suppressed.push({
        email,
        rawInput,
        source: cand.source,
        reason: "suppressed",
        detail: "อยู่ในรายการงดรับข่าวสาร (Suppression List)",
      });
      continue;
    }

    const existing = seenEmails.get(email);
    if (existing) {
      // Enrich missing name/department if a later record has richer metadata (e.g. instructor master)
      if (!existing.name && cand.name?.trim()) {
        existing.name = cand.name.trim();
      }
      if (!existing.department && cand.department?.trim()) {
        existing.department = cand.department.trim();
      }
      duplicates.push({
        email,
        rawInput,
        source: cand.source,
        reason: "duplicate",
        detail: "อีเมลซ้ำ (ตัดออกอัตโนมัติ)",
      });
      continue;
    }

    seenEmails.set(email, {
      id: buildCampaignRecipientDocId(campaignId, email),
      email,
      name: (cand.name || "").trim(),
      department: (cand.department || "").trim(),
      source: cand.source,
    });
  }

  const eligible = Array.from(seenEmails.values());
  return {
    eligible,
    duplicates,
    invalid,
    suppressed,
    stats: {
      totalImported: candidates.length,
      uniqueValid: eligible.length + suppressed.length,
      duplicateCount: duplicates.length,
      invalidCount: invalid.length,
      suppressedCount: suppressed.length,
      eligibleCount: eligible.length,
    },
  };
}

export function containsThaiCharacters(text: unknown): boolean {
  if (!text || typeof text !== "string") return false;
  return /[\u0E00-\u0E7F]/.test(text);
}

export function computeDescriptionHash(text: unknown): string {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c + i) & 0xffff;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `fnv_${h1.toString(16).padStart(8, "0")}_${h2.toString(16).padStart(8, "0")}_${normalized.length}`;
}

export function buildTranslationCacheKey(
  courseId: string,
  sourceHash: string,
  targetLanguage: CampaignLanguage = "en"
): string {
  return `${(courseId || "").trim()}::${targetLanguage}::${(sourceHash || "").trim()}`;
}

export function isCachedTranslationStale(
  entry: TranslationCacheEntry | undefined,
  currentCourseDescription: string
): boolean {
  if (!entry || !entry.sourceHash) return false;
  const trimmedSource = (currentCourseDescription || "").trim();
  if (!trimmedSource) return false;
  return entry.sourceHash !== computeDescriptionHash(trimmedSource);
}

export function resolveEnglishDescriptionGuard(params: {
  language: CampaignLanguage;
  includeDescription: boolean;
  customDescription?: string;
  courseDescription?: string;
}): { blocked: boolean; code?: "UNTRANSLATED_ENGLISH_DESCRIPTION"; reason?: string } {
  if (params.language !== "en" || !params.includeDescription) {
    return { blocked: false };
  }
  const effectiveDesc =
    params.customDescription !== undefined
      ? params.customDescription.trim()
      : !containsThaiCharacters(params.courseDescription)
      ? (params.courseDescription || "").trim()
      : "";

  if (containsThaiCharacters(effectiveDesc)) {
    return {
      blocked: true,
      code: "UNTRANSLATED_ENGLISH_DESCRIPTION",
      reason:
        "รายละเอียดหลักสูตรภาษาอังกฤษ (Course Overview) ยังมีข้อความภาษาไทย กรุณาแปลหรือแก้ไขเป็นภาษาอังกฤษก่อนส่งอีเมล",
    };
  }
  return { blocked: false };
}

export function evaluateEnglishAutoTranslation(params: {
  language: CampaignLanguage;
  courseId?: string;
  courseDescription: string;
  currentDraft?: PromotionTemplateData;
  cacheEntry?: TranslationCacheEntry;
}): {
  action: "noop" | "translate" | "reuse_cache" | "stale_warning";
  reuseText?: string;
  cacheEntry?: TranslationCacheEntry;
  isStale: boolean;
  reason: string;
} {
  if (params.language !== "en") {
    return { action: "noop", isStale: false, reason: "language_not_en" };
  }
  const trimmedSource = (params.courseDescription || "").trim();
  if (!trimmedSource) {
    return { action: "noop", isStale: false, reason: "empty_source" };
  }
  if (!containsThaiCharacters(trimmedSource)) {
    return { action: "noop", isStale: false, reason: "source_already_non_thai" };
  }

  const currentHash = computeDescriptionHash(trimmedSource);
  const cacheMatchesCourse = Boolean(
    params.cacheEntry &&
      params.cacheEntry.targetLanguage === "en" &&
      (!params.courseId || params.cacheEntry.courseId === params.courseId) &&
      params.cacheEntry.translatedText.trim()
  );

  const draftDesc = (params.currentDraft?.customDescription || "").trim();
  const draftEditedManually = Boolean(params.currentDraft?.translationMeta?.editedByAdmin);

  // If Admin already edited the English draft directly and it contains valid non-Thai text, preserve it
  if (draftEditedManually && draftDesc && !containsThaiCharacters(draftDesc)) {
    const staleByDraft = Boolean(
      params.currentDraft?.translationMeta?.sourceHash &&
        params.currentDraft.translationMeta.sourceHash !== currentHash
    );
    const staleByCache = cacheMatchesCourse && params.cacheEntry!.sourceHash !== currentHash;
    return {
      action: staleByDraft || staleByCache ? "stale_warning" : "noop",
      isStale: staleByDraft || staleByCache,
      reason: "manual_edit_preserved",
    };
  }

  // Check cached entry
  if (cacheMatchesCourse && params.cacheEntry) {
    const stale = params.cacheEntry.sourceHash !== currentHash;
    if (!stale) {
      return {
        action: "reuse_cache",
        reuseText: params.cacheEntry.translatedText,
        cacheEntry: params.cacheEntry,
        isStale: false,
        reason: "cache_hit",
      };
    }
    // Stale cache (source Thai description changed after earlier translation/manual edit): never overwrite silently
    return {
      action: "stale_warning",
      reuseText: params.cacheEntry.translatedText,
      cacheEntry: params.cacheEntry,
      isStale: true,
      reason: params.cacheEntry.editedByAdmin ? "stale_manual_edit_preserved" : "stale_cache_detected",
    };
  }

  // If the current EN draft already has non-empty non-Thai text with matching or missing source hash
  if (draftDesc && !containsThaiCharacters(draftDesc)) {
    const staleByMeta = Boolean(
      params.currentDraft?.translationMeta?.sourceHash &&
        params.currentDraft.translationMeta.sourceHash !== currentHash
    );
    return {
      action: staleByMeta ? "stale_warning" : "noop",
      isStale: staleByMeta,
      reason: staleByMeta ? "stale_template_meta" : "existing_english_draft",
    };
  }

  return { action: "translate", isStale: false, reason: "needs_ai_translation" };
}

export function applyAsyncTranslationResultIfEligible(params: {
  requestSeq: number;
  latestRequestSeq: number;
  requestCourseId: string;
  activeCourseId?: string;
  activeLanguage: CampaignLanguage;
  requestSourceHash: string;
  currentCourseDescription: string;
  currentTemplate: PromotionTemplateData;
  manualEditEpochAtStart: number;
  currentManualEditEpoch: number;
  translatedText: string;
  model?: string;
  translatedAt?: string;
}): { applied: boolean; reason: string; template?: PromotionTemplateData } {
  if (params.requestSeq !== params.latestRequestSeq) {
    return { applied: false, reason: "superseded_request" };
  }
  if (params.activeLanguage !== "en") {
    return { applied: false, reason: "language_switched_away" };
  }
  if ((params.activeCourseId || "") !== params.requestCourseId) {
    return { applied: false, reason: "course_changed" };
  }
  if (computeDescriptionHash(params.currentCourseDescription) !== params.requestSourceHash) {
    return { applied: false, reason: "source_changed_mid_flight" };
  }
  if (params.currentManualEditEpoch !== params.manualEditEpochAtStart) {
    return { applied: false, reason: "manual_edit_occurred_mid_flight" };
  }

  const cleanTranslated = params.translatedText.trim();
  const translatedAt = params.translatedAt || new Date().toISOString();
  return {
    applied: true,
    reason: "applied",
    template: {
      ...params.currentTemplate,
      language: "en",
      customDescription: cleanTranslated,
      translationMeta: {
        sourceHash: params.requestSourceHash,
        translatedAt,
        model: params.model,
        editedByAdmin: false,
      },
    },
  };
}

export function resolveInitialCampaignLanguage(course?: Partial<Course> | null): CampaignLanguage {
  return resolveCourseLang(course) === "en" ? "en" : "th";
}

export function getDefaultPromotionTemplate(
  course: Partial<Course> & { id?: string; title?: string },
  language: CampaignLanguage
): PromotionTemplateData {
  const title = (course?.title || "").trim() || (language === "en" ? "Training Workshop" : "หลักสูตรอบรม");
  const rawDescription = (course?.description || "").trim();

  if (language === "en") {
    // NEVER copy untranslated Thai description directly into an English email template
    const safeInitialEnDesc = containsThaiCharacters(rawDescription) ? "" : rawDescription;
    return {
      language: "en",
      subject: `[BU Training Invitation] ${title}`,
      greetingPrefix: "Dear",
      neutralGreetingName: "Colleague",
      headline: "You Are Invited to Join Our Upcoming Workshop",
      invitationMessage:
        "The Learning Development Office (LDO), Bangkok University, cordially invites faculty members and academic staff to join this upcoming professional development workshop. Seats are limited—please reserve your seat in advance.",
      ctaLabel: "Register Now",
      signatureTitle: "Learning Development Office (LDO)",
      signatureOrg: "Bangkok University",
      footerNote:
        "This course announcement is sent to Bangkok University faculty and staff. To opt out of future promotional announcements, please reply or contact LDO.",
      includeDescription: true,
      customDescription: safeInitialEnDesc,
    };
  }

  return {
    language: "th",
    subject: `[ขอเชิญเข้าร่วมอบรม] ${title}`,
    greetingPrefix: "เรียน",
    neutralGreetingName: "คณาจารย์และบุคลากรทุกท่าน",
    headline: "ขอเชิญเข้าร่วมการอบรมเชิงปฏิบัติการ",
    invitationMessage:
      "สำนักพัฒนาการเรียนรู้ (Learning Development Office) มหาวิทยาลัยกรุงเทพ ขอเชิญชวนคณาจารย์และบุคลากรที่สนใจเข้าร่วมการอบรมเพื่อพัฒนาศักยภาพทางวิชาการและการจัดการเรียนการสอน ทั้งนี้รับจำนวนจำกัด กรุณาลงทะเบียนล่วงหน้าผ่านระบบ",
    ctaLabel: "ลงทะเบียนเข้าอบรม",
    signatureTitle: "สำนักพัฒนาการเรียนรู้ (Learning Development Office)",
    signatureOrg: "มหาวิทยาลัยกรุงเทพ",
    footerNote:
      "อีเมลฉบับนี้เป็นข่าวสารประชาสัมพันธ์หลักสูตรอบรมสำหรับคณาจารย์และบุคลากรมหาวิทยาลัยกรุงเทพ หากท่านไม่ประสงค์รับข่าวสารประชาสัมพันธ์หลักสูตร กรุณาติดต่อสำนักพัฒนาการเรียนรู้",
    includeDescription: true,
    customDescription: rawDescription,
  };
}

function formatSpeakerForCampaign(course: Partial<Course>, lang: CampaignLanguage): string {
  const raw = (course.instructorName || "").trim();
  if (!raw) return "";
  if (lang === "en") {
    if (/[\u0E00-\u0E7F]/.test(raw)) {
      // Never print untranslated Thai speaker string inside an English email unless there is Latin text
      return "";
    }
    return raw.replace(/^(?:อาจารย์|อ\.\s*|คุณ\s*)/i, "").trim();
  }
  return formatInstructorName(raw, course.instructorId, undefined, "th");
}

function resolveCampaignScheduleRows(course: Partial<Course>, lang: CampaignLanguage) {
  const sessions = getCourseSessions(course, lang);
  if (sessions.length === 0) {
    return [
      {
        label: lang === "en" ? "Date" : "วันที่อบรม",
        dateText: course.date
          ? lang === "en"
            ? formatDateEn(course.date)
            : formatDateThai(course.date)
          : lang === "en"
          ? "To be announced"
          : "รอประกาศกำหนดการ",
        timeText: formatSessionTime(course.startTime, course.endTime, lang) || (lang === "en" ? "TBA" : "ตามกำหนดการ"),
        venueText: course.locationDetail || (lang === "en" ? "Bangkok University" : "มหาวิทยาลัยกรุงเทพ"),
      },
    ];
  }

  return sessions.map((s, idx) => ({
    label:
      sessions.length > 1
        ? formatSessionName(s.sessionName, idx, lang)
        : lang === "en"
        ? "Schedule"
        : "วันเวลาอบรม",
    dateText: lang === "en" ? formatDateEn(s.date) : formatDateThai(s.date),
    timeText: formatSessionTime(s.startTime, s.endTime, lang),
    venueText: s.locationDetail || course.locationDetail || (lang === "en" ? "Bangkok University" : "มหาวิทยาลัยกรุงเทพ"),
  }));
}

export function resolveGreetingForRecipient(
  recipientName: string | undefined | null,
  template: PromotionTemplateData
): string {
  const trimmed = (recipientName || "").trim();
  if (!trimmed) {
    return `${template.greetingPrefix} ${template.neutralGreetingName}`;
  }
  if (template.language === "en" && /[\u0E00-\u0E7F]/.test(trimmed)) {
    return `${template.greetingPrefix} ${template.neutralGreetingName}`;
  }
  return `${template.greetingPrefix} ${trimmed}`;
}

export interface RenderedPromotionEmail {
  subject: string;
  htmlBody: string;
  textBody: string;
  senderName: string;
}

/**
 * Generates an email-client-compatible, table-based responsive HTML email + plain-text fallback.
 * Uses strictly inline CSS and zero scripts/external stylesheets.
 */
export function renderPromotionEmail(params: {
  course: Partial<Course> & { id?: string; title?: string };
  template: PromotionTemplateData;
  registrationUrl: string;
  recipientName?: string;
  posterSrc?: string; // Either `cid:coursePoster`, safe `https://` URL, or preview dataUrl (preview only)
  isTest?: boolean;
}): RenderedPromotionEmail {
  const { course, template, registrationUrl, recipientName, posterSrc, isTest = false } = params;
  const lang: CampaignLanguage = template.language === "en" ? "en" : "th";
  const isEn = lang === "en";

  const courseTitle = (course.title || "").trim() || (isEn ? "Training Workshop" : "หลักสูตรอบรม");
  const baseSubject = (template.subject || "").trim() || courseTitle;
  const finalSubject = isTest && !baseSubject.startsWith("[TEST]") ? `[TEST] ${baseSubject}` : baseSubject;

  const greetingLine = resolveGreetingForRecipient(recipientName, template);
  const speakerText = formatSpeakerForCampaign(course, lang);
  const scheduleRows = resolveCampaignScheduleRows(course, lang);
  const rawCourseDesc = (course.description || "").trim();
  const effectiveDescriptionSource =
    template.customDescription !== undefined
      ? template.customDescription
      : isEn && containsThaiCharacters(rawCourseDesc)
      ? ""
      : rawCourseDesc;
  const descriptionText = template.includeDescription ? effectiveDescriptionSource.trim() : "";

  const normalizedRegUrl = validatePublicAppUrl(registrationUrl).valid
    ? buildCourseRegistrationUrl(registrationUrl)
    : registrationUrl;

  const safeTitle = escapeHtml(courseTitle);
  const safeGreeting = escapeHtml(greetingLine);
  const safeHeadline = escapeHtml(template.headline);
  const safeInvitation = escapeHtml(template.invitationMessage).replace(/\n/g, "<br>");
  const safeDescription = escapeHtml(descriptionText).replace(/\n/g, "<br>");
  const safeSpeaker = escapeHtml(speakerText);
  const safeCtaLabel = escapeHtml(template.ctaLabel || (isEn ? "Register Now" : "ลงทะเบียนเข้าอบรม"));
  const safeRegUrl = escapeHtml(normalizedRegUrl);
  const safeSigTitle = escapeHtml(template.signatureTitle);
  const safeSigOrg = escapeHtml(template.signatureOrg);
  const safeFooter = escapeHtml(template.footerNote);

  const testBannerHtml = isTest
    ? `<tr><td style="background-color:#fef3c7;border-bottom:1px solid #f59e0b;padding:10px 24px;color:#92400e;font-size:12px;font-weight:bold;text-align:center;">[TEST EMAIL] Preview dispatch for Admin verification only — real campaign recipients were not contacted.</td></tr>`
    : "";

  const posterBlockHtml = posterSrc
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
        `</td>` +
        `</tr>`
    )
    .join("");

  const speakerRowHtml = safeSpeaker
    ? `<tr>` +
      `<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;width:130px;font-size:13px;font-weight:bold;color:#8b0000;">${isEn ? "Speaker" : "วิทยากร"}</td>` +
      `<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:13px;color:#1e293b;">${safeSpeaker}</td>` +
      `</tr>`
    : "";

  const htmlBody =
    `<!DOCTYPE html>` +
    `<html lang="${lang}">` +
    `<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>` +
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
    posterBlockHtml +
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
    `<a href="${safeRegUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#8b0000;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:8px;">${safeCtaLabel}</a>` +
    `</td></tr></table>` +
    `<p style="margin:0;padding:12px 14px;background-color:#f8fafc;border-radius:8px;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">` +
    `${isEn ? "Direct Registration Link:" : "ลิงก์ลงทะเบียนโดยตรง:"}<br>` +
    `<a href="${safeRegUrl}" target="_blank" rel="noopener noreferrer" style="color:#8b0000;text-decoration:underline;">${safeRegUrl}</a>` +
    `</p>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 24px 22px 24px;border-top:1px solid #e2e8f0;background-color:#ffffff;">` +
    `<p style="margin:0;font-size:14px;font-weight:bold;color:#8b0000;">${safeSigTitle}</p>` +
    `<p style="margin:2px 0 12px 0;font-size:13px;color:#475569;">${safeSigOrg}</p>` +
    `<p style="margin:0;font-size:11px;line-height:1.5;color:#94a3b8;">${safeFooter}</p>` +
    `</td></tr>` +
    `</table>` +
    `</td></tr>` +
    `</table>` +
    `</body>` +
    `</html>`;

  const schedulePlainLines = scheduleRows
    .map(
      (r) =>
        `• ${r.label}: ${r.dateText}${r.timeText ? ` (${r.timeText})` : ""} | ${
          isEn ? "Venue" : "สถานที่"
        }: ${r.venueText}`
    )
    .join("\n");

  const textBody =
    (isTest ? "[TEST EMAIL — ADMIN PREVIEW ONLY]\n\n" : "") +
    `${greetingLine}\n\n` +
    `${courseTitle}\n\n` +
    `${template.invitationMessage}\n\n` +
    (descriptionText ? `${isEn ? "Course Overview" : "รายละเอียดหลักสูตร"}:\n${descriptionText}\n\n` : "") +
    (speakerText ? `${isEn ? "Speaker" : "วิทยากร"}: ${speakerText}\n` : "") +
    `${schedulePlainLines}\n\n` +
    `${template.ctaLabel || (isEn ? "Register Now" : "ลงทะเบียนเข้าอบรม")}:\n${normalizedRegUrl}\n\n` +
    `${template.signatureTitle}\n${template.signatureOrg}\n\n` +
    `---\n${template.footerNote}`;

  const senderName = isEn
    ? "Learning Development Office (LDO)"
    : "สำนักพัฒนาการเรียนรู้ (LDO) มหาวิทยาลัยกรุงเทพ";

  return {
    subject: finalSubject,
    htmlBody,
    textBody,
    senderName,
  };
}

/**
 * Resolves the safe homepage registration link (`https://butraining.netlify.app/`) using `appUrl.ts`
 * so preview/localhost URLs are blocked and no course-specific hash or query parameters are added.
 */
export function buildCampaignRegistrationLink(baseUrl: string, _courseId?: string): string {
  return buildCourseRegistrationUrl(baseUrl);
}

/**
 * Generates UTF-8 BOM CSV export of campaign processing results.
 */
export function generateCampaignResultsCsv(
  campaign: Pick<PromotionCampaignDoc, "id" | "courseTitle" | "language">,
  recipients: PromotionRecipientDoc[]
): { csvContent: string; filename: string } {
  const rows = recipients.map((r, index) => ({
    "No": index + 1,
    "Email": sanitizeCsvTextCell(r.email, "-"),
    "Name": sanitizeCsvTextCell(r.name, "-"),
    "Department": sanitizeCsvTextCell(r.department, "-"),
    "Source": r.source,
    "Status": r.status,
    "ServiceAcceptedAt": r.sentAt ? new Date(r.sentAt).toISOString() : "-",
    "Attempts": r.attempts ?? 0,
    "NoteOrError": sanitizeCsvTextCell(r.error, "-"),
  }));

  const body =
    rows.length > 0
      ? Papa.unparse(rows)
      : Papa.unparse({
          fields: ["No", "Email", "Name", "Department", "Source", "Status", "ServiceAcceptedAt", "Attempts", "NoteOrError"],
          data: [],
        });

  const cleanTitle = (campaign.courseTitle || "campaign")
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .slice(0, 60);

  return {
    csvContent: "\ufeff" + body,
    filename: `promotion_results_${cleanTitle}_${campaign.id.slice(0, 8)}.csv`,
  };
}

function extractSafeErrorMessage(json: any, status: number, rawText: string, defaultMsg: string): string {
  if (json && typeof json.message === "string" && json.message.trim()) {
    return json.message.trim();
  }
  const contentPreview = rawText ? rawText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) : "";
  if (status === 404) {
    return `ไม่พบปลายทาง Promotion Gateway (HTTP 404)${contentPreview ? ` — ${contentPreview}` : ""}`;
  }
  return `${defaultMsg} (HTTP ${status})${contentPreview ? ` — ${contentPreview}` : ""}`;
}

async function postPromotionGateway(params: {
  idToken: string;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<{
  res: Response;
  json: any;
  rawText: string;
  endpointUsed: string;
  isNonJsonRouting404: boolean;
}> {
  const fetcher = params.fetchImpl || fetch;
  const doPost = async (endpoint: string) => {
    const res = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.idToken}`,
      },
      body: JSON.stringify(params.payload),
    });
    const rawText = await res.text().catch(() => "");
    let json: any = null;
    if (rawText) {
      try {
        json = JSON.parse(rawText);
      } catch {
        json = null;
      }
    }
    const contentType = (res.headers?.get?.("content-type") || "").toLowerCase();
    const isHtmlFallback =
      contentType.includes("text/html") || /^\s*<(?:!doctype|html)\b/i.test(rawText);
    const isNonJsonRouting404 =
      (!json && res.status === 404) || (!json && res.status === 200 && isHtmlFallback);
    return { res, json, rawText, endpointUsed: endpoint, isNonJsonRouting404 };
  };

  const primary = await doPost(PROMOTION_GATEWAY_ENDPOINT);
  // Only fall back to direct /.netlify/functions/* path if /api/* clearly never reached the function (non-JSON 404 or SPA HTML)
  if (primary.isNonJsonRouting404) {
    return await doPost(PROMOTION_GATEWAY_FALLBACK_ENDPOINT);
  }
  return primary;
}

export async function fetchPromotionQuota(
  idToken: string,
  fetchImpl?: typeof fetch
): Promise<{
  ok: boolean;
  httpStatus?: number;
  code?: string;
  remainingDailyQuota?: number | null;
  message?: string;
}> {
  try {
    const { res, json, rawText, isNonJsonRouting404 } = await postPromotionGateway({
      idToken,
      payload: { action: "check_quota" },
      fetchImpl,
    });
    if (!res.ok || !json || json.status === "error") {
      const code = isNonJsonRouting404
        ? "ENDPOINT_NOT_FOUND"
        : typeof json?.code === "string"
        ? json.code
        : undefined;
      return {
        ok: false,
        httpStatus: isNonJsonRouting404 && res.status === 200 ? 404 : res.status,
        code,
        message: extractSafeErrorMessage(json, isNonJsonRouting404 && res.status === 200 ? 404 : res.status, rawText, "ไม่สามารถตรวจสอบโควตาการส่งอีเมลได้"),
      };
    }
    return {
      ok: true,
      httpStatus: res.status,
      remainingDailyQuota: typeof json.remainingDailyQuota === "number" ? json.remainingDailyQuota : null,
      message: json.message,
    };
  } catch (err: any) {
    return { ok: false, code: "NETWORK_ERROR", message: err?.message || "Network error checking MailApp quota" };
  }
}

export async function sendPromotionTestEmail(params: {
  idToken: string;
  courseId: string;
  campaignId?: string;
  testEmail: string;
  testName?: string;
  language: CampaignLanguage;
  registrationUrl: string;
  template: PromotionTemplateData;
  poster: PosterConfig;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; httpStatus?: number; code?: string; message: string; remainingDailyQuota?: number | null }> {
  try {
    const { res, json, rawText, isNonJsonRouting404 } = await postPromotionGateway({
      idToken: params.idToken,
      fetchImpl: params.fetchImpl,
      payload: {
        action: "send_test",
        courseId: params.courseId,
        campaignId: params.campaignId || "",
        testEmail: normalizeEmailAddress(params.testEmail),
        testName: (params.testName || "").trim(),
        language: params.language,
        registrationUrl: params.registrationUrl,
        template: params.template,
        poster: {
          mode: params.poster.mode,
          publicUrl: params.poster.publicUrl,
          inlineBase64: params.poster.inlineBase64,
          inlineMimeType: params.poster.inlineMimeType,
          inlineFilename: params.poster.inlineFilename,
        },
      },
    });

    const effectiveStatus = isNonJsonRouting404 && res.status === 200 ? 404 : res.status;
    if (!res.ok || !json || json.status === "error") {
      const code = isNonJsonRouting404
        ? "ENDPOINT_NOT_FOUND"
        : typeof json?.code === "string"
        ? json.code
        : undefined;
      return {
        ok: false,
        httpStatus: effectiveStatus,
        code,
        message: extractSafeErrorMessage(json, effectiveStatus, rawText, "ส่งอีเมลทดสอบไม่สำเร็จ"),
      };
    }
    return {
      ok: true,
      httpStatus: res.status,
      message: json.message || "ส่งอีเมลทดสอบ [TEST] เรียบร้อยแล้ว",
      remainingDailyQuota: typeof json.remainingDailyQuota === "number" ? json.remainingDailyQuota : null,
    };
  } catch (err: any) {
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: err?.message || "ไม่สามารถติดต่อ Promotion Gateway สำหรับส่งอีเมลทดสอบได้",
    };
  }
}

export interface BatchDispatchResponse {
  ok: boolean;
  httpStatus?: number;
  code?: string;
  outcomeAmbiguous?: boolean;
  message: string;
  processedCount?: number;
  sentCount?: number;
  failedCount?: number;
  unknownCount?: number;
  skippedCount?: number;
  remainingPending?: number;
  remainingDailyQuota?: number | null;
  campaignStatus?: CampaignStatus;
  quotaExhausted?: boolean;
}

export async function dispatchPromotionBatch(params: {
  idToken: string;
  campaignId: string;
  batchSize?: number;
  poster?: PosterConfig;
  fetchImpl?: typeof fetch;
}): Promise<BatchDispatchResponse> {
  try {
    const { res, json, rawText, isNonJsonRouting404 } = await postPromotionGateway({
      idToken: params.idToken,
      fetchImpl: params.fetchImpl,
      payload: {
        action: "dispatch_batch",
        campaignId: params.campaignId,
        batchSize: Math.min(MAX_PROMOTION_BATCH_SIZE, Math.max(1, params.batchSize || DEFAULT_PROMOTION_BATCH_SIZE)),
        poster: params.poster
          ? {
              mode: params.poster.mode,
              publicUrl: params.poster.publicUrl,
              inlineBase64: params.poster.inlineBase64,
              inlineMimeType: params.poster.inlineMimeType,
              inlineFilename: params.poster.inlineFilename,
            }
          : undefined,
      },
    });

    if (isNonJsonRouting404) {
      return {
        ok: false,
        httpStatus: 404,
        code: "ENDPOINT_NOT_FOUND",
        outcomeAmbiguous: false,
        message:
          "ไม่พบปลายทางส่งอีเมลประชาสัมพันธ์บนเซิร์ฟเวอร์ (HTTP 404 — Function Endpoint Not Found) กรุณาตรวจสอบการ deploy ฟังก์ชัน Netlify ก่อนลองใหม่",
      };
    }

    if (!json) {
      return {
        ok: false,
        httpStatus: res.status,
        code: res.status >= 500 ? "UPSTREAM_ERROR" : "AMBIGUOUS_RESPONSE",
        outcomeAmbiguous: true,
        message: `เซิร์ฟเวอร์ตอบกลับไม่สมบูรณ์ (HTTP ${res.status}) — สถานะการจัดส่งยังไม่แน่ชัด (Unknown) กรุณาตรวจสอบรายชื่อผู้รับในระบบก่อนส่งซ้ำ${rawText ? "" : ""}`,
      };
    }

    const ok = res.ok && json.status !== "error";
    const unknownCount = typeof json.unknownCount === "number" ? json.unknownCount : undefined;
    const outcomeAmbiguous = Boolean(!ok && (json.code === "UPSTREAM_ERROR" || json.code === "GAS_TIMEOUT" || (unknownCount ?? 0) > 0));

    return {
      ok,
      httpStatus: res.status,
      code: typeof json.code === "string" ? json.code : !ok ? `HTTP_${res.status}` : undefined,
      outcomeAmbiguous,
      message: json.message || (ok ? "ส่งชุดข้อมูลเรียบร้อยแล้ว" : `การส่งชุดข้อมูลขัดข้อง (HTTP ${res.status})`),
      processedCount: json.processedCount,
      sentCount: json.sentCount,
      failedCount: json.failedCount,
      unknownCount,
      skippedCount: json.skippedCount,
      remainingPending: json.remainingPending,
      remainingDailyQuota: typeof json.remainingDailyQuota === "number" ? json.remainingDailyQuota : null,
      campaignStatus: json.campaignStatus,
      quotaExhausted: Boolean(json.quotaExhausted),
    };
  } catch (err: any) {
    return {
      ok: false,
      code: "UPSTREAM_ERROR",
      outcomeAmbiguous: true,
      message: `การเชื่อมต่อขาดหายระหว่างส่งชุดข้อมูล (${err?.message || "Network timeout"}) — สถานะการจัดส่งอาจเป็น Unknown กรุณาตรวจสอบสถานะผู้รับในแดชบอร์ดก่อนส่งต่อ`,
    };
  }
}

export interface CampaignDeletionEligibility {
  allowed: boolean;
  code?:
    | "CAMPAIGN_COMPLETED_PROTECTED"
    | "CAMPAIGN_SENDING"
    | "CAMPAIGN_STATUS_BLOCKED"
    | "CAMPAIGN_LOCKED"
    | "CAMPAIGN_HAS_SENT"
    | "CAMPAIGN_HAS_UNKNOWN"
    | "CAMPAIGN_HAS_PROCESSING";
  reason?: string;
}

const DELETABLE_CAMPAIGN_STATUSES = new Set<string>(["draft", "ready", "paused"]);

/**
 * Shared guard determining whether a promotion campaign is safe for ordinary Admin cleanup.
 * Only `draft`, `ready`, and clean `paused` campaigns with ZERO `sent`, `unknown`, or `processing`
 * recipients and no active dispatch lock may be deleted.
 */
export function evaluateCampaignDeletionEligibility(
  campaign: Pick<PromotionCampaignDoc, "status" | "sentCount" | "unknownCount" | "activeLockUntil">,
  recipients?: Array<Pick<PromotionRecipientDoc, "status">>,
  nowMs: number = Date.now()
): CampaignDeletionEligibility {
  const status = String(campaign.status || "").trim();

  if (status === "completed" || status === "completed_with_issues") {
    return {
      allowed: false,
      code: "CAMPAIGN_COMPLETED_PROTECTED",
      reason: "แคมเปญที่ส่งเสร็จสิ้นแล้วถูกเก็บรักษาเป็นประวัติการส่ง ไม่สามารถลบได้",
    };
  }

  if (status === "sending") {
    return {
      allowed: false,
      code: "CAMPAIGN_SENDING",
      reason: "แคมเปญกำลังอยู่ระหว่างการจัดส่ง (sending) ไม่สามารถลบได้",
    };
  }

  if (!DELETABLE_CAMPAIGN_STATUSES.has(status)) {
    return {
      allowed: false,
      code: "CAMPAIGN_STATUS_BLOCKED",
      reason: `สถานะแคมเปญ (${status || "unknown"}) ไม่อนุญาตให้ลบ`,
    };
  }

  const lockUntilMs = campaign.activeLockUntil ? new Date(campaign.activeLockUntil).getTime() : 0;
  if (Number.isFinite(lockUntilMs) && lockUntilMs > nowMs) {
    return {
      allowed: false,
      code: "CAMPAIGN_LOCKED",
      reason: "แคมเปญมี Lock การประมวลผลค้างอยู่ชั่วคราว กรุณารอให้การทำงานเสร็จสิ้นก่อน",
    };
  }

  const hasSentRecipient = Array.isArray(recipients) && recipients.some((r) => r.status === "sent");
  if ((Number(campaign.sentCount) || 0) > 0 || hasSentRecipient) {
    return {
      allowed: false,
      code: "CAMPAIGN_HAS_SENT",
      reason: "แคมเปญนี้มีผู้รับที่ส่งอีเมลแล้ว จึงถูกเก็บรักษาเป็นประวัติและไม่สามารถลบได้",
    };
  }

  const hasUnknownRecipient = Array.isArray(recipients) && recipients.some((r) => r.status === "unknown");
  if ((Number(campaign.unknownCount) || 0) > 0 || hasUnknownRecipient) {
    return {
      allowed: false,
      code: "CAMPAIGN_HAS_UNKNOWN",
      reason: "แคมเปญนี้มีรายชื่อสถานะ Unknown ที่ต้องตรวจสอบก่อน จึงไม่สามารถลบได้",
    };
  }

  const hasProcessingRecipient = Array.isArray(recipients) && recipients.some((r) => r.status === "processing");
  if (hasProcessingRecipient) {
    return {
      allowed: false,
      code: "CAMPAIGN_HAS_PROCESSING",
      reason: "มีรายชื่อผู้รับกำลังอยู่ในสถานะ Processing ไม่สามารถลบได้",
    };
  }

  return { allowed: true };
}

export interface DeleteCampaignResponse {
  ok: boolean;
  httpStatus?: number;
  code?: string;
  message: string;
  campaignId?: string;
  deletedRecipientsCount?: number;
  remainingRecipientsCount?: number;
  partialFailure?: boolean;
}

export async function deletePromotionCampaign(params: {
  idToken: string;
  campaignId: string;
  adminConfirmed: boolean;
  fetchImpl?: typeof fetch;
}): Promise<DeleteCampaignResponse> {
  if (!params.adminConfirmed) {
    return {
      ok: false,
      httpStatus: 400,
      code: "CONFIRMATION_REQUIRED",
      message: "ต้องได้รับการยืนยันจากผู้ดูแลระบบก่อนลบแคมเปญ",
    };
  }

  try {
    const { res, json, rawText, isNonJsonRouting404 } = await postPromotionGateway({
      idToken: params.idToken,
      fetchImpl: params.fetchImpl,
      payload: {
        action: "delete_campaign",
        campaignId: params.campaignId,
        adminConfirmed: true,
      },
    });

    if (isNonJsonRouting404) {
      return {
        ok: false,
        httpStatus: 404,
        code: "ENDPOINT_NOT_FOUND",
        message: "ไม่พบปลายทางลบแคมเปญบนเซิร์ฟเวอร์ (HTTP 404 — Function Endpoint Not Found)",
      };
    }

    if (!json) {
      return {
        ok: false,
        httpStatus: res.status,
        code: "AMBIGUOUS_RESPONSE",
        partialFailure: true,
        message: `เซิร์ฟเวอร์ตอบกลับไม่สมบูรณ์ระหว่างลบแคมเปญ (HTTP ${res.status}) — กรุณารีเฟรชรายการเพื่อตรวจสอบว่าแคมเปญถูกลบครบถ้วนแล้วหรือไม่${rawText ? "" : ""}`,
      };
    }

    const ok = res.ok && json.status !== "error";
    return {
      ok,
      httpStatus: res.status,
      code: typeof json.code === "string" ? json.code : !ok ? `HTTP_${res.status}` : undefined,
      message:
        json.message ||
        (ok ? "ลบแคมเปญและรายชื่อผู้รับเรียบร้อยแล้ว" : `ลบแคมเปญไม่สำเร็จ (HTTP ${res.status})`),
      campaignId: json.campaignId || params.campaignId,
      deletedRecipientsCount:
        typeof json.deletedRecipientsCount === "number" ? json.deletedRecipientsCount : undefined,
      remainingRecipientsCount:
        typeof json.remainingRecipientsCount === "number" ? json.remainingRecipientsCount : undefined,
      partialFailure: Boolean(json.partialFailure || json.code === "DELETE_PARTIAL_FAILURE"),
    };
  } catch (err: any) {
    return {
      ok: false,
      code: "NETWORK_ERROR",
      partialFailure: true,
      message: `เกิดข้อผิดพลาดระหว่างติดต่อเซิร์ฟเวอร์เพื่อลบแคมเปญ (${err?.message || "Network error"}) — กรุณารีเฟรชและลองลบอีกครั้งหากแคมเปญยังคงอยู่`,
    };
  }
}

export interface TranslateDescriptionResponse {
  ok: boolean;
  httpStatus?: number;
  code?: string;
  translatedText?: string;
  sourceHash?: string;
  model?: string;
  message: string;
}

export async function translateCourseDescription(params: {
  idToken: string;
  courseId?: string;
  courseTitle?: string;
  sourceText: string;
  targetLanguage?: "en";
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<TranslateDescriptionResponse> {
  const fetcher = params.fetchImpl || fetch;
  const payload = {
    courseId: params.courseId || "",
    courseTitle: params.courseTitle || "",
    sourceText: params.sourceText,
    targetLanguage: params.targetLanguage || "en",
  };

  const doPost = async (endpoint: string) => {
    const res = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.idToken}`,
      },
      body: JSON.stringify(payload),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    const rawText = await res.text().catch(() => "");
    let json: any = null;
    if (rawText) {
      try {
        json = JSON.parse(rawText);
      } catch {
        json = null;
      }
    }
    const contentType = (res.headers?.get?.("content-type") || "").toLowerCase();
    const isHtmlFallback =
      contentType.includes("text/html") || /^\s*<(?:!doctype|html)\b/i.test(rawText);
    const isNonJsonRouting404 =
      (!json && res.status === 404) || (!json && res.status === 200 && isHtmlFallback);
    return { res, json, rawText, isNonJsonRouting404 };
  };

  try {
    let outcome = await doPost(TRANSLATE_DESCRIPTION_ENDPOINT);
    if (outcome.isNonJsonRouting404) {
      outcome = await doPost(TRANSLATE_DESCRIPTION_FALLBACK_ENDPOINT);
    }

    const effectiveStatus = outcome.isNonJsonRouting404 && outcome.res.status === 200 ? 404 : outcome.res.status;
    if (!outcome.res.ok || !outcome.json || outcome.json.status === "error") {
      const code = outcome.isNonJsonRouting404
        ? "ENDPOINT_NOT_FOUND"
        : typeof outcome.json?.code === "string"
        ? outcome.json.code
        : undefined;
      return {
        ok: false,
        httpStatus: effectiveStatus,
        code,
        message: extractSafeErrorMessage(
          outcome.json,
          effectiveStatus,
          outcome.rawText,
          "ไม่สามารถแปลรายละเอียดหลักสูตรเป็นภาษาอังกฤษได้"
        ),
      };
    }

    return {
      ok: true,
      httpStatus: outcome.res.status,
      translatedText: typeof outcome.json.translatedText === "string" ? outcome.json.translatedText : "",
      sourceHash: typeof outcome.json.sourceHash === "string" ? outcome.json.sourceHash : computeDescriptionHash(params.sourceText),
      model: typeof outcome.json.model === "string" ? outcome.json.model : undefined,
      message: "แปลรายละเอียดหลักสูตรเป็นภาษาอังกฤษเรียบร้อยแล้ว",
    };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return {
        ok: false,
        code: "ABORTED",
        message: "ยกเลิกคำขอแปลภาษาก่อนหน้าแล้ว",
      };
    }
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: `ไม่สามารถติดต่อบริการแปลภาษาได้ (${err?.message || "Network error"}) — สามารถพิมพ์หรือวางรายละเอียดภาษาอังกฤษด้วยตนเองได้`,
    };
  }
}

