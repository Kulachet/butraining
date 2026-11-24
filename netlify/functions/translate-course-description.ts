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

export const DEFAULT_TRANSLATION_MODEL = "gemini-4-hydrogen";
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

export interface TranslateHandlerDeps {
  db?: any;
  projectId?: string;
  databaseId?: string;
  verifyIdToken?: (token: string) => Promise<{ uid: string; email?: string; email_verified?: boolean }>;
  verifyAdmin?: (db: any, uid: string, email?: string, emailVerified?: boolean) => Promise<boolean>;
  geminiApiKey?: string;
  generateContentFn?: (params: {
    model: string;
    contents: string;
    systemInstruction: string;
  }) => Promise<{ text?: string }>;
  timeoutMs?: number;
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
          model: DEFAULT_TRANSLATION_MODEL,
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
        model: DEFAULT_TRANSLATION_MODEL,
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
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "AI_EMPTY_OUTPUT",
          message: "AI translation returned an empty response. Please try again or edit the English description manually.",
        }),
      };
    }

    if (containsThaiCharactersServer(cleaned)) {
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "AI_INCOMPLETE_TRANSLATION",
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
        model: DEFAULT_TRANSLATION_MODEL,
      }),
    };
  } catch (err: any) {
    const rawMsg = String(err?.message || "");
    const statusNum = Number(err?.status || err?.statusCode || 0);

    if (err?.code === "AI_TIMEOUT" || /timeout|ETIMEDOUT|ABORT/i.test(rawMsg)) {
      return {
        statusCode: 504,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "AI_TIMEOUT",
          message: "AI translation service timed out. Please retry or edit the English Course Overview manually.",
        }),
      };
    }

    if (statusNum === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(rawMsg)) {
      return {
        statusCode: 429,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "AI_QUOTA_EXHAUSTED",
          message: "AI translation rate/quota limit reached temporarily. Please wait a moment or type the English description manually.",
        }),
      };
    }

    if (statusNum === 401 || statusNum === 403 || /API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(rawMsg)) {
      return {
        statusCode: 503,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "AI_KEY_INVALID",
          message: "AI translation credentials are invalid or restricted on the server. Manual English entry remains available.",
        }),
      };
    }

    console.error("[translate-course-description] AI error:", rawMsg.slice(0, 200));
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "AI_TRANSLATION_FAILED",
        message: "Unable to translate course description automatically right now. Please try again or edit manually.",
      }),
    };
  } finally {
    if (timerHandle) clearTimeout(timerHandle);
  }
}
