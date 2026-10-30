import { Course } from "../types";
import { RegistrationEmailPayload } from "./registrationEmail";

/**
 * Default deployed Thai Google Apps Script Web App URL.
 * Preserves 100% backward compatibility for all Thai courses and legacy registrations.
 */
export const DEFAULT_THAI_GAS_URL =
  "https://script.google.com/macros/s/AKfycbyk4505Uis2F-0fKsX7X9iuDsrOfB7aPyD_TO00JUq_BMi9ZDUBzjSKFOFsNHrSVVxN/exec";

/**
 * Secure Netlify Function endpoint for English course notifications.
 */
export const SECURE_EN_GATEWAY_ENDPOINT = "/api/notify-registration-en";

export type SupportedLanguage = "th" | "en";

export interface WebhookRouteResult {
  url: string | null;
  language: SupportedLanguage;
  isConfigured: boolean;
  isSecureGateway: boolean;
  reason?: string;
}

export interface DispatchWebhookOptions {
  idToken?: string;
  sessionId?: string;
}

export interface DispatchWebhookResponse {
  success: boolean;
  status: "dispatched" | "partial_success" | "unconfigured" | "error";
  language: SupportedLanguage;
  message?: string;
  alreadySent?: boolean;
  calendarEventId?: string | null;
}

/**
 * Resolves the presentation/service language for a course.
 * Defaults strictly to 'th' when missing, empty, or unassigned.
 */
export function resolveWebhookLanguage(
  course?: Partial<Course> | null
): SupportedLanguage {
  if (!course) return "th";
  return course.language === "en" ? "en" : "th";
}

/**
 * Resolves the notification webhook route based on course language.
 *
 * ROUTING ARCHITECTURE (Phase 2B.1.3):
 * 1. English Courses (course.language === 'en'):
 *    - Routed strictly through the server-side Netlify Function (/api/notify-registration-en).
 *    - Direct browser-to-GAS calls are completely removed for English courses.
 *    - Requires valid Firebase ID token for authentication.
 * 2. Thai Courses (course.language === 'th' or missing/legacy):
 *    - 100% preserved legacy dispatch directly to the Thai GAS URL.
 */
export function resolveRegistrationWebhook(
  course?: Partial<Course> | null
): WebhookRouteResult {
  const language = resolveWebhookLanguage(course);

  if (language === "en") {
    return {
      url: SECURE_EN_GATEWAY_ENDPOINT,
      language: "en",
      isConfigured: true,
      isSecureGateway: true,
    };
  }

  // Thai or legacy fallback
  const thUrl = (
    import.meta.env?.VITE_GAS_TH_URL || DEFAULT_THAI_GAS_URL
  ).trim();

  return {
    url: thUrl || DEFAULT_THAI_GAS_URL,
    language: "th",
    isConfigured: true,
    isSecureGateway: false,
  };
}

/**
 * Dispatches the registration notification.
 *
 * - English courses: calls the secure Netlify Function /api/notify-registration-en
 *   with the user's Firebase ID token. The server verifies the registration in Firestore
 *   and issues a server-to-server call to GAS with a shared secret.
 * - Thai courses: dispatches directly to the deployed Thai GAS endpoint using no-cors.
 */
export async function dispatchRegistrationWebhook(
  course: Course,
  payload: RegistrationEmailPayload,
  options?: DispatchWebhookOptions
): Promise<DispatchWebhookResponse> {
  const route = resolveRegistrationWebhook(course);

  // --- ENGLISH SECURE GATEWAY ROUTE ---
  if (route.language === "en") {
    if (!options?.idToken) {
      console.warn("English notification requires Firebase user ID token.");
      return {
        success: false,
        status: "error",
        language: "en",
        message: "Authentication token required for English notification dispatch.",
      };
    }

    try {
      const response = await fetch(SECURE_EN_GATEWAY_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.idToken}`,
        },
        body: JSON.stringify({
          courseId: course.id,
          sessionId: options.sessionId,
        }),
      });

      const responseText = await response.text();
      let responseJson: any = null;
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        // Non-JSON response
      }

      if (response.status === 503) {
        return {
          success: false,
          status: "unconfigured",
          language: "en",
          message:
            responseJson?.message ||
            "English automated email and calendar service is not yet configured in server environment.",
        };
      }

      if (response.status === 207 || responseJson?.status === "partial_success") {
        return {
          success: true,
          status: "partial_success",
          language: "en",
          calendarEventId: responseJson?.calendarEventId,
          message:
            responseJson?.message ||
            "Partial delivery: Calendar event created, but confirmation email could not be sent.",
        };
      }

      if (response.ok) {
        return {
          success: true,
          status: "dispatched",
          language: "en",
          alreadySent: responseJson?.alreadySent,
          calendarEventId: responseJson?.calendarEventId,
          message: responseJson?.message,
        };
      }

      if (response.status === 429) {
        // Concurrency lock in progress
        return {
          success: true,
          status: "dispatched",
          language: "en",
          message: "Notification is currently being processed.",
        };
      }

      return {
        success: false,
        status: "error",
        language: "en",
        message:
          responseJson?.message ||
          `Failed to dispatch English notification (HTTP ${response.status})`,
      };
    } catch (err: any) {
      console.error("Secure English notification gateway fetch error:", err);
      return {
        success: false,
        status: "error",
        language: "en",
        message: err?.message || "Network error contacting notification gateway",
      };
    }
  }

  // --- THAI PRESERVED DIRECT ROUTE ---
  if (!route.url) {
    return {
      success: false,
      status: "unconfigured",
      language: "th",
      message: "Thai webhook endpoint is unconfigured",
    };
  }

  try {
    await fetch(route.url, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    return {
      success: true,
      status: "dispatched",
      language: "th",
    };
  } catch (err: any) {
    console.error("Failed to dispatch Thai registration webhook:", err);
    return {
      success: false,
      status: "error",
      language: "th",
      message: err?.message || "Network error while dispatching Thai webhook",
    };
  }
}
