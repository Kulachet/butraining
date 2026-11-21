/**
 * Centralized Published Application URL Configuration & Validation
 *
 * Ensures external evaluation invitation emails never embed temporary
 * AI Studio Preview URLs (e.g., ais-pre-*.run.app, ais-dev-*.run.app)
 * or localhost addresses that result in HTTP 404 / 403 for participants.
 */

export type PublicAppUrlErrorCode =
  | "EMPTY"
  | "PLACEHOLDER"
  | "INVALID_FORMAT"
  | "HTTPS_REQUIRED"
  | "CREDENTIALS_NOT_ALLOWED"
  | "INVALID_HOSTNAME"
  | "DISALLOWED_PREVIEW_OR_LOCAL_HOST";

export interface PublicAppUrlValidationResult {
  valid: boolean;
  normalizedBaseUrl?: string;
  code?: PublicAppUrlErrorCode;
  reason?: string;
}

export type PublicAppUrlResolutionSource =
  | "env"
  | "runtime_origin"
  | "invalid_env"
  | "unconfigured";

export interface PublicAppUrlResolution {
  url: string;
  source: PublicAppUrlResolutionSource;
  isConfigured: boolean;
  errorReason?: string;
}

const PLACEHOLDER_VALUES = new Set([
  "https://...",
  "http://...",
  "my_app_url",
  "your_published_app_url",
  "https://your-published-app-url",
]);

export function getConfiguredPublicAppUrl(): string {
  try {
    const raw = import.meta.env?.VITE_PUBLIC_APP_URL;
    return typeof raw === "string" ? raw.trim() : "";
  } catch {
    return "";
  }
}

export function isDisallowedPreviewOrLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;

  // Reject Google AI Studio / Cloud Run preview & dev hostnames
  if (
    /^ais-(pre|dev)-/i.test(host) ||
    host === "run.app" ||
    host.endsWith(".run.app")
  ) {
    return true;
  }

  // Reject temporary Netlify deploy previews
  if (/^deploy-preview-\d+--/i.test(host)) {
    return true;
  }

  // Reject loopback and local development hostnames
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".local")
  ) {
    return true;
  }

  return false;
}

export function validatePublicAppUrl(
  rawUrl: string | undefined | null
): PublicAppUrlValidationResult {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!trimmed) {
    return {
      valid: false,
      code: "EMPTY",
      reason:
        "ยังไม่ได้กำหนด Published Public App URL (กรุณาตั้งค่า VITE_PUBLIC_APP_URL หรือกรอก URL สาธารณะของระบบ)",
    };
  }

  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lower) || trimmed.includes("...")) {
    return {
      valid: false,
      code: "PLACEHOLDER",
      reason:
        "URL ที่ระบุเป็นค่าตัวอย่าง (Placeholder) กรุณากรอก URL สาธารณะที่ใช้งานได้จริง",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      code: "INVALID_FORMAT",
      reason: "รูปแบบ URL ไม่ถูกต้อง (ตัวอย่าง: https://your-portal.netlify.app)",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      code: "HTTPS_REQUIRED",
      reason: "Published Public App URL ต้องใช้โปรโตคอล https:// เท่านั้น",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      code: "CREDENTIALS_NOT_ALLOWED",
      reason: "URL ต้องไม่มีข้อมูล Username หรือ Password ฝังอยู่",
    };
  }

  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return {
      valid: false,
      code: "INVALID_HOSTNAME",
      reason: "Hostname ของ URL ไม่ถูกต้องสำหรับลิงก์ภายนอก",
    };
  }

  if (isDisallowedPreviewOrLocalHostname(parsed.hostname)) {
    return {
      valid: false,
      code: "DISALLOWED_PREVIEW_OR_LOCAL_HOST",
      reason:
        "ไม่อนุญาตให้ใช้ Preview URL ชั่วคราว (*.run.app / ais-pre-*) หรือ localhost สำหรับลิงก์อีเมลประเมินผล กรุณาใช้ Published Public URL จริง",
    };
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  return {
    valid: true,
    normalizedBaseUrl: `${parsed.origin}${cleanPath}`,
  };
}

/**
 * Resolves the initial public application base URL:
 * 1. Explicit VITE_PUBLIC_APP_URL (when valid)
 * 2. Current browser origin ONLY if it is already a valid, non-preview published HTTPS host
 * 3. Otherwise returns empty string + unconfigured reason (never silently falls back to preview hostnames)
 */
export function resolveInitialPublicAppUrl(
  currentOrigin?: string,
  configuredOverride?: string
): PublicAppUrlResolution {
  const envUrl =
    configuredOverride !== undefined
      ? configuredOverride.trim()
      : getConfiguredPublicAppUrl();

  if (envUrl) {
    const envCheck = validatePublicAppUrl(envUrl);
    if (envCheck.valid) {
      return {
        url: envCheck.normalizedBaseUrl,
        source: "env",
        isConfigured: true,
      };
    }
    return {
      url: "",
      source: "invalid_env",
      isConfigured: false,
      errorReason: `VITE_PUBLIC_APP_URL ไม่ถูกต้อง: ${envCheck.reason}`,
    };
  }

  if (currentOrigin) {
    const originCheck = validatePublicAppUrl(currentOrigin);
    if (originCheck.valid) {
      return {
        url: originCheck.normalizedBaseUrl,
        source: "runtime_origin",
        isConfigured: true,
      };
    }
  }

  return {
    url: "",
    source: "unconfigured",
    isConfigured: false,
    errorReason:
      "ไม่พบ Published Public App URL ที่ใช้งานได้ (กำลังใช้งานผ่าน Preview/Localhost) กรุณาตั้งค่า VITE_PUBLIC_APP_URL หรือกรอก URL สาธารณะของระบบก่อนส่งอีเมล",
  };
}

/**
 * Constructs a stable evaluation invitation URL preserving the HashRouter route `#/evaluate/{courseId}`
 * and safely encoding query parameters via Web Standard URL / URLSearchParams APIs.
 */
export function buildEvaluationEmailUrl(
  baseUrl: string,
  courseId: string,
  courseTitle?: string
): string {
  const validation = validatePublicAppUrl(baseUrl);
  if (!validation.valid || !validation.normalizedBaseUrl) {
    throw new Error(validation.reason || "Invalid published public application URL.");
  }

  const trimmedCourseId = typeof courseId === "string" ? courseId.trim() : "";
  if (
    !trimmedCourseId ||
    trimmedCourseId.includes("/") ||
    trimmedCourseId.includes("?") ||
    trimmedCourseId.includes("#")
  ) {
    throw new Error("Invalid courseId for evaluation email URL.");
  }

  const url = new URL(validation.normalizedBaseUrl);
  const cleanPath = url.pathname.replace(/\/+$/, "");
  url.pathname = cleanPath ? `${cleanPath}/` : "/";
  url.search = "";

  const params = new URLSearchParams();
  const cleanTitle = typeof courseTitle === "string" ? courseTitle.trim() : "";
  if (cleanTitle) {
    params.set("title", cleanTitle);
  }
  const queryString = params.toString();
  const encodedCourseId = encodeURIComponent(trimmedCourseId);

  url.hash = `#/evaluate/${encodedCourseId}${queryString ? `?${queryString}` : ""}`;
  return url.toString();
}

/**
 * Constructs a stable published course registration URL targeting the landing page
 * with a clean `?course={courseId}` hash query so participants land directly on the
 * live registration portal for the selected course.
 */
export function buildCourseRegistrationUrl(
  baseUrl: string,
  courseId: string
): string {
  const validation = validatePublicAppUrl(baseUrl);
  if (!validation.valid || !validation.normalizedBaseUrl) {
    throw new Error(validation.reason || "Invalid published public application URL.");
  }

  const trimmedCourseId = typeof courseId === "string" ? courseId.trim() : "";
  if (
    !trimmedCourseId ||
    trimmedCourseId.includes("/") ||
    trimmedCourseId.includes("?") ||
    trimmedCourseId.includes("#")
  ) {
    throw new Error("Invalid courseId for course registration URL.");
  }

  const url = new URL(validation.normalizedBaseUrl);
  const cleanPath = url.pathname.replace(/\/+$/, "");
  url.pathname = cleanPath ? `${cleanPath}/` : "/";
  url.search = "";

  const params = new URLSearchParams();
  params.set("course", trimmedCourseId);
  url.hash = `#/?${params.toString()}`;
  return url.toString();
}

