import { GoogleGenAI } from "@google/genai";
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

export const DEFAULT_TRANSLATION_MODEL = "gemini-3.1-flash-lite";
export const MAX_TRANSLATE_REQUEST_BYTES = 128 * 1024; // 128 KB
export const MAX_SOURCE_TEXT_CHARS = 6000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_CALLS_PER_WINDOW = 20;
const DEFAULT_AI_TIMEOUT_MS = 20_000;

const DEFAULT_FIREBASE_PROJECT_ID = "my-bu-app-2026-d4620";
const DEFAULT_FIRESTORE_DATABASE_ID = "(default)";

const ADMIN_EMAIL_ALLOWLIST = new Set([
  "kulachet.l@bu.ac.th",
  "napaporn.pu@bu.ac.th",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const adminRateBuckets = new Map<string, number[]>();

export type GeminiErrorCategory =
  | "timeout"
  | "quota_exhausted"
  | "model_not_found"
  | "api_key_authentication"
  | "project_permission_error"
  | "api_restriction_error"
  | "invalid_request"
  | "upstream_unavailable";

export interface ClassifiedGeminiError {
  httpStatus: number;
  responseCode:
    | "AI_TIMEOUT"
    | "AI_QUOTA_EXHAUSTED"
    | "AI_MODEL_NOT_FOUND"
    | "AI_KEY_INVALID"
    | "AI_PERMISSION_DENIED"
    | "AI_BAD_REQUEST"
    | "AI_TRANSLATION_FAILED";
  category: GeminiErrorCategory;
  upstreamHttpStatus: number | null;
  upstreamGrpcStatus: string | null;
  upstreamReason: string | null;
  sanitizedDetail: string;
  userMessage: string;
}

export interface TranslateHandlerDeps {
  db?: any;
  projectId?: string;
  databaseId?: string;
  verifyIdToken?: (token: string) => Promise<{ uid: string; email?: string; email_verified?: boolean }>;
  verifyAdmin?: (db: any, uid: string, email?: string, emailVerified?: boolean) => Promise<boolean>;
  geminiApiKey?: string;
  translationModel?: string;
  generateContentFn?: (params: {
    model: string;
    contents: string;
    systemInstruction: string;
  }) => Promise<{ text?: string }>;
  timeoutMs?: number;
  skipRateLimit?: boolean;
  logErrorFn?: (prefix: string, diagnosticPayloadJson: string) => void;
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

    if (!credential) return null;

    const app = initializeApp({ credential, projectId });
    return { app, db: getFirestore(app, databaseId), projectId, databaseId };
  } catch (err) {
    console.error("Firebase Admin initialization error (translate):", err instanceof Error ? err.message : "unknown");
    return null;
  }
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

export function resolveTranslationModel(explicitModel?: string): {
  valid: boolean;
  model: string;
  source: "override" | "env" | "default";
} {
  const fromOverride = typeof explicitModel === "string" ? explicitModel.trim() : "";
  const fromEnv = typeof process.env.GEMINI_TRANSLATION_MODEL === "string"
    ? process.env.GEMINI_TRANSLATION_MODEL.trim()
    : "";

  const source: "override" | "env" | "default" = fromOverride
    ? "override"
    : fromEnv
    ? "env"
    : "default";

  const candidateRaw = fromOverride || fromEnv || DEFAULT_TRANSLATION_MODEL;
  const normalized = candidateRaw.replace(/^models\//i, "").trim();

  if (!normalized || normalized.length > 100 || !/^[a-zA-Z0-9._-]+$/.test(normalized)) {
    return { valid: false, model: normalized || DEFAULT_TRANSLATION_MODEL, source };
  }

  return { valid: true, model: normalized, source };
}

export function sanitizeDiagnosticText(raw: string, secretsToRedact: string[] = []): string {
  let cleaned = String(raw || "");
  for (const secret of secretsToRedact) {
    if (secret && secret.length >= 6) {
      cleaned = cleaned.split(secret).join("[REDACTED]");
    }
  }
  cleaned = cleaned.replace(/([?&](?:key|api_key|token|access_token)=)[^&\s"']+/gi, "$1[REDACTED]");
  cleaned = cleaned.replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  cleaned = cleaned.replace(/\bAIza[0-9A-Za-z_-]{15,}\b/g, "[REDACTED_GOOGLE_KEY]");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 260);
}

function extractGoogleErrorMetadata(err: any): {
  upstreamHttpStatus: number | null;
  grpcStatus: string | null;
  reason: string | null;
  messageText: string;
} {
  const rawMessage = typeof err?.message === "string" ? err.message : String(err || "");
  let parsedJson: any = null;

  const jsonStart = rawMessage.indexOf("{");
  if (jsonStart !== -1) {
    try {
      parsedJson = JSON.parse(rawMessage.slice(jsonStart));
    } catch {
      parsedJson = null;
    }
  } else if (err?.error && typeof err.error === "object") {
    parsedJson = { error: err.error };
  }

  const errObj = parsedJson?.error || parsedJson || {};
  const statusCandidate = Number(
    err?.status ?? err?.statusCode ?? errObj?.code ?? err?.response?.status ?? 0
  );
  const upstreamHttpStatus =
    Number.isFinite(statusCandidate) && statusCandidate >= 100 && statusCandidate <= 599
      ? statusCandidate
      : null;

  const grpcStatus =
    typeof errObj?.status === "string"
      ? errObj.status.trim()
      : typeof err?.statusText === "string"
      ? err.statusText.trim()
      : null;

  let reason: string | null = typeof err?.reason === "string" ? err.reason.trim() : null;
  const details = Array.isArray(errObj?.details) ? errObj.details : [];
  for (const d of details) {
    if (!reason && typeof d?.reason === "string" && d.reason.trim()) {
      reason = d.reason.trim();
    }
  }

  const messageText =
    typeof errObj?.message === "string" && errObj.message.trim()
      ? errObj.message.trim()
      : rawMessage;

  return { upstreamHttpStatus, grpcStatus, reason, messageText };
}

export function classifyGeminiApiError(
  err: unknown,
  modelId: string,
  secretsToRedact: string[] = []
): ClassifiedGeminiError {
  const meta = extractGoogleErrorMetadata(err);
  const rawErrCode = String((err as any)?.code || "").trim();
  const combinedSignals = [
    rawErrCode,
    meta.grpcStatus || "",
    meta.reason || "",
    meta.messageText || "",
    String((err as any)?.message || ""),
  ]
    .filter(Boolean)
    .join(" | ");
  const sanitizedDetail = sanitizeDiagnosticText(meta.messageText || combinedSignals, secretsToRedact);

  // 1. Timeout / Abort
  if (rawErrCode === "AI_TIMEOUT" || /timeout|ETIMEDOUT|ABORT/i.test(combinedSignals)) {
    return {
      httpStatus: 504,
      responseCode: "AI_TIMEOUT",
      category: "timeout",
      upstreamHttpStatus: meta.upstreamHttpStatus,
      upstreamGrpcStatus: meta.grpcStatus,
      upstreamReason: meta.reason,
      sanitizedDetail,
      userMessage:
        "AI translation service timed out. Please retry or edit the English Course Overview manually.",
    };
  }

  // 2. Quota / Rate limit (429 / RESOURCE_EXHAUSTED)
  if (
    meta.upstreamHttpStatus === 429 ||
    meta.grpcStatus === "RESOURCE_EXHAUSTED" ||
    /RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|QUOTA_EXCEEDED|\bquota\b|rate limit/i.test(combinedSignals)
  ) {
    return {
      httpStatus: 429,
      responseCode: "AI_QUOTA_EXHAUSTED",
      category: "quota_exhausted",
      upstreamHttpStatus: meta.upstreamHttpStatus,
      upstreamGrpcStatus: meta.grpcStatus,
      upstreamReason: meta.reason,
      sanitizedDetail,
      userMessage:
        "AI translation rate or quota limit reached temporarily. Please wait a moment or type the English description manually.",
    };
  }

  // 3. Model not found / unsupported for generateContent (404 / NOT_FOUND / model error messages)
  if (
    meta.upstreamHttpStatus === 404 ||
    meta.grpcStatus === "NOT_FOUND" ||
    /models\/[^\s]+.*(?:not found|not supported|deprecated)|is not found for api version|not supported for generateContent|model.*does not exist|unknown model/i.test(
      combinedSignals
    )
  ) {
    return {
      httpStatus: 502,
      responseCode: "AI_MODEL_NOT_FOUND",
      category: "model_not_found",
      upstreamHttpStatus: meta.upstreamHttpStatus,
      upstreamGrpcStatus: meta.grpcStatus,
      upstreamReason: meta.reason,
      sanitizedDetail,
      userMessage:
        `Configured translation model (${modelId}) is unavailable or unsupported on the AI API. You can edit the English Course Overview manually while an admin updates GEMINI_TRANSLATION_MODEL.`,
    };
  }

  // 4. Actual API Key Authentication failure (ONLY explicit auth/key errors, NEVER bare HTTP 403)
  if (
    meta.upstreamHttpStatus === 401 ||
    meta.grpcStatus === "UNAUTHENTICATED" ||
    meta.reason === "API_KEY_INVALID" ||
    meta.reason === "API_KEY_EXPIRED" ||
    /API_KEY_INVALID|API_KEY_EXPIRED|API key not valid|invalid api key|expired api key|API key expired|UNAUTHENTICATED/i.test(
      combinedSignals
    )
  ) {
    return {
      httpStatus: 503,
      responseCode: "AI_KEY_INVALID",
      category: "api_key_authentication",
      upstreamHttpStatus: meta.upstreamHttpStatus,
      upstreamGrpcStatus: meta.grpcStatus,
      upstreamReason: meta.reason,
      sanitizedDetail,
      userMessage:
        "AI translation API authentication failed on the server. Manual English entry remains available.",
    };
  }

  // 5. Project permission, API not enabled, or HTTP referrer / IP key restriction (HTTP 403 / PERMISSION_DENIED)
  if (
    meta.upstreamHttpStatus === 403 ||
    meta.grpcStatus === "PERMISSION_DENIED" ||
    /PERMISSION_DENIED|SERVICE_DISABLED|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED|API_KEY_SERVICE_BLOCKED|has not been used in project|it is disabled|does not have permission|location is not supported/i.test(
      combinedSignals
    )
  ) {
    const isRestriction =
      meta.reason === "API_KEY_HTTP_REFERRER_BLOCKED" ||
      meta.reason === "API_KEY_IP_ADDRESS_BLOCKED" ||
      meta.reason === "API_KEY_SERVICE_BLOCKED" ||
      /REFERRER_BLOCKED|IP_ADDRESS_BLOCKED|referer|HTTP referrer|API_KEY_SERVICE_BLOCKED/i.test(
        combinedSignals
      );

    return {
      httpStatus: 503,
      responseCode: "AI_PERMISSION_DENIED",
      category: isRestriction ? "api_restriction_error" : "project_permission_error",
      upstreamHttpStatus: meta.upstreamHttpStatus,
      upstreamGrpcStatus: meta.grpcStatus,
      upstreamReason: meta.reason,
      sanitizedDetail,
      userMessage: isRestriction
        ? "AI translation request was blocked by Google API key restrictions (HTTP referrer, IP, or API restriction) on the server. Manual English entry remains available."
        : "Google Cloud project permission or Generative Language API access blocked this translation request. Manual English entry remains available.",
    };
  }

  // 6. Other client argument errors (HTTP 400 / INVALID_ARGUMENT)
  if (meta.upstreamHttpStatus === 400 || meta.grpcStatus === "INVALID_ARGUMENT") {
    return {
      httpStatus: 400,
      responseCode: "AI_BAD_REQUEST",
      category: "invalid_request",
      upstreamHttpStatus: meta.upstreamHttpStatus,
      upstreamGrpcStatus: meta.grpcStatus,
      upstreamReason: meta.reason,
      sanitizedDetail,
      userMessage:
        "Translation request parameters were rejected by the AI service. Manual English entry remains available.",
    };
  }

  // 7. Generic upstream availability/network failure
  return {
    httpStatus: 502,
    responseCode: "AI_TRANSLATION_FAILED",
    category: "upstream_unavailable",
    upstreamHttpStatus: meta.upstreamHttpStatus,
    upstreamGrpcStatus: meta.grpcStatus,
    upstreamReason: meta.reason,
    sanitizedDetail,
    userMessage:
      "Unable to translate course description automatically right now. Please try again or edit manually.",
  };
}

export function containsThaiCharactersServer(raw: unknown): boolean {
  if (!raw || typeof raw !== "string") return false;
  return /[\u0E00-\u0E7F]/.test(raw);
}

export function containsUnsafeMarkupServer(raw: unknown): boolean {
  if (!raw || typeof raw !== "string") return false;
  return (
    /<\s*(script|iframe|object|embed|form)\b/i.test(raw) ||
    /\bon[a-z]+\s*=/i.test(raw) ||
    /javascript\s*:/i.test(raw)
  );
}

export function computeDescriptionHashServer(text: unknown): string {
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

export function sanitizeTranslatedPlainText(raw: string): string {
  let text = String(raw || "").replace(/\r\n/g, "\n").trim();
  // Strip accidental wrapping markdown code fences
  text = text.replace(/^```(?:text|markdown|plain|en)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  // Strip common conversational prefix if any
  text = text.replace(/^(?:Here is the English translation|English Translation|Translated Description)\s*:\s*\n*/i, "").trim();
  // Collapse excessive blank lines while preserving paragraph breaks
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

const TRANSLATION_SYSTEM_INSTRUCTION = [
  "You are the official bilingual academic translator for the Learning Development Office (LDO), Bangkok University.",
  "Translate the provided Thai academic training course description into clear, natural, professional academic English suitable for an institutional promotional email's 'Course Overview' section.",
  "STRICT OUTPUT RULES:",
  "1. Output ONLY the translated plain English text. Never add commentary, greetings, labels, markdown headings, code fences, or HTML tags.",
  "2. Preserve all factual meaning, learning outcomes, numbers, dates, times, venues, seat counts, URLs, and fees accurately without inventing or omitting information.",
  "3. Keep established technical terms and proper English phrases intact when appropriate (e.g., Generative AI, AI-Assisted Development, AI API, No-Code/Low-Code, Functional Prototype, Bangkok University, Learning Development Office).",
  "4. Preserve paragraph breaks cleanly so the email layout remains well-structured and readable.",
].join("\n");

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  return handleTranslateWithDeps(event);
}

export async function handleTranslateWithDeps(
  event: HandlerEvent,
  deps?: TranslateHandlerDeps
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

  if (event.body && Buffer.byteLength(event.body, "utf8") > MAX_TRANSLATE_REQUEST_BYTES) {
    return {
      statusCode: 413,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "PAYLOAD_TOO_LARGE",
        message: "Translation request payload exceeds 128 KB limit",
      }),
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
        message: "Administrator permission is required to translate course descriptions.",
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
        message: "Too many translation requests in a short period. Please wait a moment.",
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

  const targetLanguage = String(bodyData.targetLanguage || "en").trim().toLowerCase();
  if (targetLanguage !== "en") {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "UNSUPPORTED_TARGET_LANGUAGE",
        message: "Only English ('en') target translation is supported by this endpoint.",
      }),
    };
  }

  const rawSourceText = typeof bodyData.sourceText === "string" ? bodyData.sourceText : "";
  const sourceText = rawSourceText.replace(/\r\n/g, "\n").trim();
  const courseTitle = typeof bodyData.courseTitle === "string"
    ? bodyData.courseTitle.replace(/[\r\n]+/g, " ").trim().slice(0, 300)
    : "";

  if (!sourceText) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "EMPTY_SOURCE_TEXT",
        message: "Course description is empty; nothing to translate.",
      }),
    };
  }

  if (sourceText.length > MAX_SOURCE_TEXT_CHARS) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "SOURCE_TEXT_TOO_LONG",
        message: `Course description exceeds maximum ${MAX_SOURCE_TEXT_CHARS} characters for translation.`,
      }),
    };
  }

  if (containsUnsafeMarkupServer(sourceText) || containsUnsafeMarkupServer(courseTitle)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "UNSAFE_CONTENT",
        message: "Source text contains disallowed HTML script tags or event handlers.",
      }),
    };
  }

  const sourceHash = computeDescriptionHashServer(sourceText);

  // If source contains zero Thai characters, return trimmed text safely without consuming AI quota
  if (!containsThaiCharactersServer(sourceText)) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "success",
        translatedText: sourceText,
        targetLanguage: "en",
        sourceHash,
        model: "passthrough-non-thai",
      }),
    };
  }

  const apiKey = (deps?.geminiApiKey ?? process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey && !deps?.generateContentFn) {
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "AI_TRANSLATION_UNCONFIGURED",
        message:
          "Server AI translation key (GEMINI_API_KEY) is not configured. You can type or paste the English Course Overview manually.",
      }),
    };
  }

  const logError =
    deps?.logErrorFn ||
    ((prefix: string, detailsJson: string) => {
      console.error(prefix, detailsJson);
    });

  const modelResolution = resolveTranslationModel(deps?.translationModel);
  if (!modelResolution.valid) {
    logError(
      "[translate-course-description] Invalid GEMINI_TRANSLATION_MODEL configuration",
      JSON.stringify({
        upstreamHttpStatus: null,
        errorCategory: "invalid_model_config",
        modelId: sanitizeDiagnosticText(modelResolution.model, [apiKey, idToken]),
        modelSource: modelResolution.source,
      })
    );
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "AI_MODEL_CONFIG_INVALID",
        message:
          "Server GEMINI_TRANSLATION_MODEL configuration is invalid. You can type or paste the English Course Overview manually.",
      }),
    };
  }
  const activeModel = modelResolution.model;

  const userPrompt = [
    courseTitle ? `Course title (context only, do not prepend as heading unless part of description): ${courseTitle}` : "",
    "Thai course description to translate into academic English:",
    sourceText,
  ]
    .filter(Boolean)
    .join("\n\n");

  const timeoutMs = deps?.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  let timerHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const runGeneration = async (): Promise<{ text?: string }> => {
      if (deps?.generateContentFn) {
        return await deps.generateContentFn({
          model: activeModel,
          contents: userPrompt,
          systemInstruction: TRANSLATION_SYSTEM_INSTRUCTION,
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      return await ai.models.generateContent({
        model: activeModel,
        contents: userPrompt,
        config: {
          systemInstruction: TRANSLATION_SYSTEM_INSTRUCTION,
        },
      });
    };

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timerHandle = setTimeout(() => {
        const timeoutErr: any = new Error("AI translation timed out");
        timeoutErr.code = "AI_TIMEOUT";
        reject(timeoutErr);
      }, timeoutMs);
    });

    const result = await Promise.race([runGeneration(), timeoutPromise]);
    const cleaned = sanitizeTranslatedPlainText(result?.text || "");

    if (!cleaned) {
      logError(
        "[translate-course-description] Gemini returned empty text",
        JSON.stringify({
          upstreamHttpStatus: 200,
          errorCategory: "empty_output",
          modelId: activeModel,
        })
      );
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "AI_EMPTY_OUTPUT",
          category: "empty_output",
          model: activeModel,
          message: "AI translation returned an empty response. Please try again or edit the English description manually.",
        }),
      };
    }

    if (containsThaiCharactersServer(cleaned)) {
      logError(
        "[translate-course-description] Incomplete translation output contained Thai characters",
        JSON.stringify({
          upstreamHttpStatus: 200,
          errorCategory: "incomplete_translation",
          modelId: activeModel,
        })
      );
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "AI_INCOMPLETE_TRANSLATION",
          category: "incomplete_translation",
          model: activeModel,
          message: "AI translation output still contained Thai characters. Please try again or edit manually.",
        }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "success",
        translatedText: cleaned,
        targetLanguage: "en",
        sourceHash,
        model: activeModel,
      }),
    };
  } catch (err: any) {
    const classified = classifyGeminiApiError(err, activeModel, [apiKey, idToken]);

    logError(
      "[translate-course-description] Gemini request failed",
      JSON.stringify({
        upstreamHttpStatus: classified.upstreamHttpStatus,
        upstreamGrpcStatus: classified.upstreamGrpcStatus,
        upstreamReason: classified.upstreamReason,
        errorCategory: classified.category,
        responseCode: classified.responseCode,
        modelId: activeModel,
        sanitizedDetail: classified.sanitizedDetail,
      })
    );

    return {
      statusCode: classified.httpStatus,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: classified.responseCode,
        category: classified.category,
        model: activeModel,
        message: classified.userMessage,
      }),
    };
  } finally {
    if (timerHandle) clearTimeout(timerHandle);
  }
}
