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

/**
 * Initializes Firebase Admin lazily with environment variables.
 * Fails closed if service credentials are not configured.
 */
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
      // Check for Google Application Default Credentials
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

/**
 * Escapes characters for HTML templates safely.
 */
function escapeHtml(str: string | undefined | null): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const EN_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Safely parses date string into year, month, day, and day-of-week
 * avoiding timezone shift bugs.
 */
function parseDatePartsSafe(dateStr: string | undefined | null): {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
} | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    // Use noon local time to guarantee immunity from UTC/DST day-shift
    const d = new Date(year, month - 1, day, 12, 0, 0);
    return {
      year,
      month,
      day,
      dayOfWeek: d.getDay(),
    };
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    dayOfWeek: d.getDay(),
  };
}

/**
 * Gregorian English Date Formatter:
 * 2026-11-12 -> Thursday, November 12, 2026
 */
function formatDateEn(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  const parts = parseDatePartsSafe(dateStr);
  if (!parts) return String(dateStr);
  const weekday = EN_WEEKDAYS[parts.dayOfWeek] || "";
  const month = EN_MONTHS[parts.month - 1] || "";
  return `${weekday}, ${month} ${parts.day}, ${parts.year}`;
}

/**
 * 12-hour AM/PM Time Formatter:
 * "09:00" -> "9:00 AM"
 * "16:00" -> "4:00 PM"
 */
function formatTime12Hour(timeStr: string | undefined | null): string {
  if (!timeStr) return "";
  const trimmed = String(timeStr).trim();
  const parts = trimmed.split(":");
  if (parts.length >= 2) {
    const rawH = parseInt(parts[0], 10);
    const m = parts[1].padStart(2, "0");
    if (!isNaN(rawH)) {
      const ampm = rawH >= 12 ? "PM" : "AM";
      const h12 = rawH % 12 === 0 ? 12 : rawH % 12;
      return `${h12}:${m} ${ampm}`;
    }
  }
  return trimmed;
}

/**
 * English Time Range Formatter with en-dash:
 * "09:00", "16:00" -> "9:00 AM – 4:00 PM"
 */
function formatTimeRangeEn(startTime?: string, endTime?: string): string {
  const s = formatTime12Hour(startTime || "09:00");
  const e = formatTime12Hour(endTime || "16:00");
  if (s && e) {
    return `${s} – ${e}`;
  }
  return s || e || "";
}

/**
 * English Session Label Formatter:
 * Maps generic Thai labels ("วันที่ 1", "วันที่ 2") to "Day 1", "Day 2".
 * Preserves custom English session titles while maintaining day numbering.
 */
function formatSessionNameEn(sessionName: string | undefined | null, index: number): string {
  const dayNum = index + 1;
  if (!sessionName || typeof sessionName !== "string") {
    return `Day ${dayNum}`;
  }
  const trimmed = sessionName.trim();
  // Generic Thai session labels: "วันที่ 1", "วันที่ 2", "วัน 1", etc.
  if (trimmed.startsWith("วันที่") || /^วัน(?:ที่)?\s*\d+/i.test(trimmed)) {
    const match = trimmed.match(/\d+/);
    const num = match ? match[0] : dayNum;
    return `Day ${num}`;
  }
  // Already in English Day format: "Day 1", "Day 2", etc.
  if (/^Day\s*\d+/i.test(trimmed)) {
    return trimmed;
  }
  // Specific custom title: prepend Day number for clarity
  return `Day ${dayNum}: ${trimmed}`;
}

/**
 * Strips Thai prefixes from English name or speaker name.
 */
function cleanEnglishName(name: string | undefined | null): string {
  if (!name) return "";
  let cleaned = String(name).trim();
  // Strip Thai prefixes: เรียน, คุณ, อาจารย์, อ., ดร., ผศ., รศ., ศ.
  cleaned = cleaned.replace(/^(?:เรียน|คุณ|อาจารย์|อ\.|ดร\.|ผศ\.|รศ\.|ศ\.)\s*/i, "").trim();
  // Strip "Dear " if erroneously prefixed
  cleaned = cleaned.replace(/^Dear\s+/i, "").trim();
  return cleaned;
}

/**
 * Strips generic Thai prefixes from speaker name while preserving title.
 */
function cleanSpeakerNameEn(name: string | undefined | null): string {
  if (!name) return "";
  let s = String(name).trim();
  s = s.replace(/^(?:อาจารย์|อ\.\s*|คุณ\s*)/i, "").trim();
  return s;
}

/**
 * Formats multi-session schedule for English notifications with
 * Gregorian dates, 12-hour AM/PM times, and Day N numbering.
 */
function formatEnglishSchedule(
  sessions: any[],
  defaultLocation: string = "On-site"
): { plainText: string; html: string } {
  if (!sessions || sessions.length === 0) {
    return { plainText: "", html: "" };
  }

  if (sessions.length === 1) {
    const s = sessions[0];
    const formattedDate = formatDateEn(s.date);
    const formattedTime = formatTimeRangeEn(s.startTime, s.endTime);
    const venue = s.locationDetail || defaultLocation || "On-site";

    const plainText = `Date & Time: ${formattedDate} (${formattedTime})\nVenue: ${venue}`;
    const html = `<p style="margin: 8px 0;"><b>Date &amp; Time:</b> ${escapeHtml(formattedDate)} (${escapeHtml(formattedTime)})</p>
<p style="margin: 8px 0;"><b>Venue:</b> ${escapeHtml(venue)}</p>`;
    return { plainText, html };
  }

  const plainText = sessions
    .map((s, idx) => {
      const sName = formatSessionNameEn(s.sessionName, idx);
      const fDate = formatDateEn(s.date);
      const fTime = formatTimeRangeEn(s.startTime, s.endTime);
      const venue = s.locationDetail || defaultLocation || "On-site";
      return `  • ${sName}: ${fDate} (${fTime})\n    Venue: ${venue}`;
    })
    .join("\n");

  const listItems = sessions
    .map((s, idx) => {
      const sName = formatSessionNameEn(s.sessionName, idx);
      const fDate = formatDateEn(s.date);
      const fTime = formatTimeRangeEn(s.startTime, s.endTime);
      const venue = s.locationDetail || defaultLocation || "On-site";
      return (
        `<li><strong>${escapeHtml(sName)}:</strong> ${escapeHtml(fDate)} (${escapeHtml(fTime)})<br>` +
        `<span style="color: #64748b; font-size: 13px;">Venue: ${escapeHtml(venue)}</span></li>`
      );
    })
    .join("");

  const html = `
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
      <p style="margin: 0 0 8px 0; font-weight: 700; color: #0f172a; font-size: 14px;">Training Schedule (${sessions.length} Days):</p>
      <ul style="margin: 0; padding-left: 20px; color: #334155; font-size: 14px; line-height: 1.8;">
        ${listItems}
      </ul>
    </div>
  `;

  return { plainText, html };
}

/**
 * Main Netlify Function Handler.
 * Authenticates caller, verifies registration, authorizes language, tracks state, and dispatches to GAS.
 */
export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  // 1. CORS Pre-flight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  // 2. HTTP Method Check
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

  // 3. Payload Size Limitation (10 KB)
  if (event.body && event.body.length > 10240) {
    return {
      statusCode: 413,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "PAYLOAD_TOO_LARGE",
        message: "Request payload exceeds size limit (10KB)",
      }),
    };
  }

  // 4. Token Extraction
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "UNAUTHORIZED",
        message: "Missing or malformed Authorization header. Expected Bearer token.",
      }),
    };
  }
  const idToken = authHeader.substring(7).trim();

  // 5. Initialize Firebase Admin
  const fb = getFirebaseAdmin();
  if (!fb) {
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "SERVER_MISCONFIGURED",
        message:
          "Firebase Admin credentials are not configured in the server environment. Please configure FIREBASE_SERVICE_ACCOUNT or individual credentials.",
      }),
    };
  }

  // 6. Verify Firebase ID Token Server-Side
  let verifiedUid: string;
  let verifiedEmail: string | undefined;
  try {
    const decodedToken = await getAuth(fb.app).verifyIdToken(idToken);
    verifiedUid = decodedToken.uid;
    verifiedEmail = decodedToken.email;
  } catch (tokenErr: any) {
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

  // 7. Parse Request Body (Derive only courseId and optional sessionId)
  let requestData: { courseId?: string; sessionId?: string } = {};
  try {
    requestData = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "INVALID_JSON",
        message: "Failed to parse JSON body",
      }),
    };
  }

  const courseId = (requestData.courseId || "").trim();
  const requestedSessionId = (requestData.sessionId || "").trim();

  if (!courseId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "MISSING_COURSE_ID",
        message: "courseId is required",
      }),
    };
  }

  const db = fb.db;

  try {
    // 8. Authoritative Registration Verification
    // Query registrations collection where courseId == courseId AND userId == verifiedUid
    const regQuery = await db
      .collection("registrations")
      .where("courseId", "==", courseId)
      .where("userId", "==", verifiedUid)
      .limit(1)
      .get();

    if (regQuery.empty) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "REGISTRATION_NOT_FOUND",
          message:
            "No active registration document found for the authenticated user and course.",
        }),
      };
    }

    const regDoc = regQuery.docs[0];
    const registration = regDoc.data();

    // 9. Authoritative Course Verification
    const courseDoc = await db.collection("courses").doc(courseId).get();
    if (!courseDoc.exists) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "COURSE_NOT_FOUND",
          message: "Course record not found in database.",
        }),
      };
    }
    const course = courseDoc.data()!;

    // 10. Strict Language Enforcement (Rule 7)
    // English gateway only processes courses where course.language === 'en'
    if (course.language !== "en") {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "INVALID_COURSE_LANGUAGE",
          message:
            "This gateway only accepts English courses (course.language === 'en'). Thai courses must use the standard Thai notification service.",
        }),
      };
    }

    // 11. Authoritative Recipient & Schedule Data
    // Recipient email derived strictly from verified record, NEVER from client
    const recipientEmail = (registration.userEmail || verifiedEmail || "").trim().toLowerCase();
    if (!recipientEmail || !recipientEmail.includes("@")) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "INVALID_RECIPIENT_EMAIL",
          message: "Registration does not contain a valid recipient email address.",
        }),
      };
    }

    // Strict University Domain Restriction
    const isBuDomain =
      recipientEmail.endsWith("@bu.ac.th") || recipientEmail.endsWith(".bu.ac.th");
    if (!isBuDomain) {
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "DOMAIN_RESTRICTED",
          message: "Recipient email address must belong to the approved university domain (@bu.ac.th).",
        }),
      };
    }

    // Authoritative verification of caller identity
    if (verifiedEmail) {
      const isVerifiedBu =
        verifiedEmail.toLowerCase().endsWith("@bu.ac.th") ||
        verifiedEmail.toLowerCase().endsWith(".bu.ac.th");
      if (!isVerifiedBu) {
        return {
          statusCode: 403,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            status: "error",
            code: "UNAUTHORIZED_IDENTITY",
            message: "Authenticated account is not an authorized Bangkok University account.",
          }),
        };
      }
    }

    // 11. Authoritative English Recipient Name Resolution (Requirement 5)
    // ONLY resolve from trusted instructor identity record; never trust client registration flags.
    let verifiedEnglishName: string | null = null;
    try {
      let instData: any = null;
      // 1. Check instructor document by verifiedUid
      const instDoc = await db.collection("instructors").doc(verifiedUid).get();
      if (instDoc.exists) {
        instData = instDoc.data();
      } else {
        // 2. Query by verified university email
        const emailSnap = await db
          .collection("instructors")
          .where("email", "==", recipientEmail)
          .limit(1)
          .get();
        if (!emailSnap.empty) {
          instData = emailSnap.docs[0].data();
        } else if (registration.instructorId) {
          // 3. Fallback query by id, confirming email matches
          const idSnap = await db
            .collection("instructors")
            .where("id", "==", registration.instructorId)
            .limit(1)
            .get();
          if (!idSnap.empty && idSnap.docs[0].data().email === recipientEmail) {
            instData = idSnap.docs[0].data();
          }
        }
      }

      if (instData) {
        const rawEn = (instData.englishFullName || "").trim();
        // Strictly require verified status (englishNameVerified === true) and no Thai characters
        if (rawEn && !/[\u0E00-\u0E7F]/.test(rawEn)) {
          if (instData.englishNameVerified === true) {
            verifiedEnglishName = cleanEnglishName(rawEn);
          }
        }
      }
    } catch (instLookupErr) {
      console.warn("Authoritative instructor lookup error for English name:", instLookupErr);
    }

    // Strictly enforce neutral fallback: if verified English name is absent or unverified, use "Faculty Member"
    // Thai characters, Thai prefixes, or forged client snapshots are NEVER used.
    const recipientName = verifiedEnglishName || "Faculty Member";

    // 11B. Authoritative Speaker English Name Resolution (Requirement 6)
    // Do NOT infer or fabricate English speaker names from Thai names.
    // Use a verified English speaker name only if actually available, otherwise omit the speaker line.
    let verifiedSpeakerName: string | null = null;
    const rawSpeaker = (course.instructorName || "").trim();

    if (course.instructorId) {
      try {
        let speakerDoc = await db.collection("instructors").doc(course.instructorId).get();
        let speakerData = speakerDoc.exists ? speakerDoc.data() : null;
        if (!speakerData) {
          const speakerSnap = await db
            .collection("instructors")
            .where("id", "==", course.instructorId)
            .limit(1)
            .get();
          if (!speakerSnap.empty) {
            speakerData = speakerSnap.docs[0].data();
          }
        }
        if (speakerData && speakerData.englishFullName && speakerData.englishNameVerified === true) {
          const sEn = String(speakerData.englishFullName).trim();
          if (sEn && !/[\u0E00-\u0E7F]/.test(sEn)) {
            verifiedSpeakerName = cleanEnglishName(sEn);
          }
        }
      } catch (spkErr) {
        console.warn("Speaker lookup error for English name:", spkErr);
      }
    }

    // If not found via instructorId, but course.instructorName is already purely Latin/English
    if (!verifiedSpeakerName && rawSpeaker) {
      if (/^[A-Za-z\s.,'-]+$/.test(rawSpeaker)) {
        verifiedSpeakerName = cleanSpeakerNameEn(rawSpeaker);
      }
    }

    const courseTitle = course.title || "Academic Workshop";

    const rawSessions: any[] = course.sessions || [];
    const isMulti = rawSessions.length > 1;

    const targetSessionId =
      requestedSessionId || registration.sessionId || rawSessions[0]?.sessionId || "default";

    const targetSession =
      rawSessions.find((s) => s.sessionId === targetSessionId) ||
      rawSessions[0] || {
        date: course.date || "",
        startTime: course.startTime || "09:00",
        endTime: course.endTime || "16:00",
        locationDetail: course.locationDetail || "On-site",
      };

    const effectiveSessions = rawSessions.length > 0 ? rawSessions : [targetSession];
    const schedule = formatEnglishSchedule(effectiveSessions, course.locationDetail || "On-site");

    const enrichedSessions = effectiveSessions.map((s, idx) => ({
      ...s,
      sessionName: formatSessionNameEn(s.sessionName, idx),
      formattedDate: formatDateEn(s.date),
      formattedTime: formatTimeRangeEn(s.startTime, s.endTime),
      locationDetail: s.locationDetail || course.locationDetail || "On-site",
    }));

    // 12. Durable Notification Tracking & Atomic Locking (Phase 2B.1.3A)
    const notifId = `notif_${courseId}_${targetSessionId}_${verifiedUid}`;
    const notifRef = db.collection("notification_records").doc(notifId);

    const lockResult = await db.runTransaction(async (transaction) => {
      const existingDoc = await transaction.get(notifRef);
      let skipCalendar = false;
      let existingCalendarEventId: string | null = null;

      if (existingDoc.exists) {
        const existingData = existingDoc.data()!;
        existingCalendarEventId = existingData.calendarEventId || null;

        // Fully sent: both Calendar and Email succeeded previously
        if (existingData.status === "sent") {
          return {
            proceed: false,
            alreadySent: true,
            status: "sent",
            calendarStatus: existingData.calendarStatus || "sent",
            emailStatus: existingData.emailStatus || "sent",
            calendarEventId: existingData.calendarEventId,
          };
        }

        // Partial success: Calendar succeeded, but Email failed
        if (existingData.calendarStatus === "sent" && existingData.emailStatus === "failed") {
          skipCalendar = true; // DO NOT recreate calendar event on retry
        }

        if (existingData.status === "processing") {
          const lastAttempt = existingData.lastAttemptAt
            ? new Date(existingData.lastAttemptAt).getTime()
            : 0;
          const elapsed = Date.now() - lastAttempt;
          // 60-second atomic processing lock
          if (elapsed < 60000) {
            return {
              proceed: false,
              inProgress: true,
              message: "Notification dispatch currently in progress.",
            };
          }
          // If lock expired (>60s), preserve existing calendar event if created
          if (existingData.calendarEventId) {
            skipCalendar = true;
          }
        }
      }

      const existingAttempts = existingDoc.exists ? existingDoc.data()?.attempts || 0 : 0;
      const currentAttempt = existingAttempts + 1;
      const attemptId = `${notifId}_att${currentAttempt}_${Date.now()}`;

      transaction.set(
        notifRef,
        {
          id: notifId,
          registrationId: regDoc.id,
          courseId,
          sessionId: targetSessionId,
          userId: verifiedUid,
          recipientEmail,
          language: "en",
          status: "processing",
          calendarStatus: existingDoc.exists ? existingDoc.data()?.calendarStatus || "pending" : "pending",
          emailStatus: existingDoc.exists ? existingDoc.data()?.emailStatus || "pending" : "pending",
          calendarEventId: existingCalendarEventId,
          attempts: currentAttempt,
          lastAttemptId: attemptId,
          lastAttemptAt: new Date().toISOString(),
          createdAt: existingDoc.exists
            ? existingDoc.data()?.createdAt || new Date().toISOString()
            : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      return {
        proceed: true,
        skipCalendar,
        existingCalendarEventId,
        attemptId,
      };
    });

    if (!lockResult.proceed) {
      if (lockResult.alreadySent) {
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            status: "success",
            alreadySent: true,
            calendarStatus: lockResult.calendarStatus,
            emailStatus: lockResult.emailStatus,
            calendarEventId: lockResult.calendarEventId,
            message: "Notification already sent for this registration.",
          }),
        };
      }

      if (lockResult.inProgress) {
        return {
          statusCode: 429,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            status: "error",
            code: "DISPATCH_IN_PROGRESS",
            message: "A notification request for this workshop is already being processed.",
          }),
        };
      }
    }

    // 13. Server-to-Server GAS Dispatch
    const gasUrl = (process.env.GAS_EN_URL || "").trim();
    const gasSecret = (process.env.GAS_EN_SECRET || "").trim();

    if (!gasUrl || !gasSecret) {
      await notifRef.update({
        status: "failed",
        error: "GAS_EN_URL or GAS_EN_SECRET is not configured in server environment.",
        updatedAt: new Date().toISOString(),
      });

      return {
        statusCode: 503,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "error",
          code: "GATEWAY_UNCONFIGURED",
          message:
            "English GAS webhook URL or shared secret is not configured in Netlify environment variables.",
        }),
      };
    }

    // Authoritative English Email Subject & Body
    const emailSubject = `Registration Confirmation: ${courseTitle}`;
    const emailBody =
      `Dear ${recipientName},\n\n` +
      `You have successfully registered for the workshop "${courseTitle}".\n` +
      (verifiedSpeakerName ? `Speaker: ${verifiedSpeakerName}\n` : "") +
      (isMulti ? `Training Schedule:\n${schedule.plainText}\n\n` : `${schedule.plainText}\n\n`) +
      (isMulti
        ? `A Google Calendar invitation has been attached for the first session. Please add remaining sessions to your personal calendar.\n\n`
        : `A Google Calendar invitation has been attached. Please check your calendar.\n\n`) +
      `Learning Development Office\nBangkok University`;

    const emailHtmlBody =
      `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 620px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;">` +
      `<div style="border-bottom: 2px solid #8b0000; padding-bottom: 12px; margin-bottom: 20px;">` +
      `<span style="font-size: 11px; font-weight: 700; color: #8b0000; text-transform: uppercase; letter-spacing: 1px;">Bangkok University • Learning Development Office</span>` +
      `<h2 style="color: #0f172a; margin: 6px 0 0 0; font-size: 18px;">Registration Confirmation</h2>` +
      `</div>` +
      `<p style="font-size: 15px; margin-top: 0;">Dear <b>${escapeHtml(recipientName)}</b>,</p>` +
      `<p>You have successfully registered for the workshop: <strong style="color: #0f172a;">&ldquo;${escapeHtml(courseTitle)}&rdquo;</strong></p>` +
      (verifiedSpeakerName ? `<p style="margin: 8px 0;"><b>Speaker:</b> ${escapeHtml(verifiedSpeakerName)}</p>` : "") +
      schedule.html +
      (isMulti
        ? `<p style="color: #475569; margin-top: 18px; font-size: 13px; line-height: 1.5; background-color: #fffbeb; padding: 10px 14px; border-radius: 8px; border-left: 3px solid #f59e0b;">` +
          `A Google Calendar invitation has been attached for the first session. Please add remaining sessions to your personal calendar.</p>`
        : `<p style="color: #475569; margin-top: 16px; font-size: 13px;">A Google Calendar invitation has been attached. Please check your calendar.</p>`) +
      `<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9;">` +
      `<p style="margin: 0; font-weight: bold; color: #8b0000;">Learning Development Office</p>` +
      `<p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b;">Bangkok University</p>` +
      `</div>` +
      `</div>`;

    const gasPayload = {
      secretToken: gasSecret,
      idempotencyKey: notifId,
      attemptId: lockResult.attemptId,
      skipCalendar: lockResult.skipCalendar,
      existingCalendarEventId: lockResult.existingCalendarEventId,
      courseTitle,
      description: course.description || "",
      location: targetSession.locationDetail || course.locationDetail || "On-site",
      guestEmail: recipientEmail,
      recipientName,
      instructorName: verifiedSpeakerName || "",
      date: targetSession.date || course.date,
      startTime: targetSession.startTime || course.startTime || "09:00",
      endTime: targetSession.endTime || course.endTime || "16:00",
      language: "en",
      isMultiDay: isMulti,
      sessions: enrichedSessions,
      emailSubject,
      emailBody,
      emailHtmlBody,
      scheduleText: schedule.plainText,
      senderName: "Learning Development Office",
    };

    // 14. Server-to-Server Fetch (handles GAS 302 redirect properly)
    let gasResponse: Response;
    try {
      gasResponse = await fetch(gasUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(gasPayload),
        redirect: "follow",
      });
    } catch (networkErr: any) {
      // Ambiguous outcome: network dropped after request was sent
      await notifRef.update({
        status: "unknown",
        error: `Network error or timeout contacting GAS: ${networkErr?.message || networkErr}`,
        updatedAt: new Date().toISOString(),
      });

      return {
        statusCode: 504,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "unknown",
          code: "GAS_TIMEOUT",
          message:
            "Timeout or network error communicating with Google Apps Script. Registration is intact, but notification status is unconfirmed.",
        }),
      };
    }

    const gasText = await gasResponse.text();
    let gasJson: any = null;
    try {
      gasJson = JSON.parse(gasText);
    } catch {
      await notifRef.update({
        status: "unknown",
        error: `Invalid non-JSON response from GAS: ${gasText.substring(0, 200)}`,
        updatedAt: new Date().toISOString(),
      });

      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "unknown",
          code: "GAS_NON_JSON_RESPONSE",
          message: "Upstream Google Apps Script returned a non-JSON response.",
        }),
      };
    }

    // Granular response handling
    if (gasJson && gasJson.status === "success") {
      const finalCalendarId = gasJson.eventId || lockResult.existingCalendarEventId || null;
      await notifRef.update({
        status: "sent",
        calendarStatus: gasJson.calendarStatus || "sent",
        emailStatus: gasJson.emailStatus || "sent",
        calendarEventId: finalCalendarId,
        sentAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: null,
      });

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "success",
          calendarStatus: gasJson.calendarStatus || "sent",
          emailStatus: gasJson.emailStatus || "sent",
          calendarEventId: finalCalendarId,
          message: "English confirmation email and calendar invitation dispatched successfully.",
        }),
      };
    }

    if (gasJson && gasJson.status === "partial_success") {
      const finalCalendarId = gasJson.eventId || lockResult.existingCalendarEventId || null;
      await notifRef.update({
        status: "partial_success",
        calendarStatus: gasJson.calendarStatus || (gasJson.calendarCreated ? "sent" : "failed"),
        emailStatus: gasJson.emailStatus || (gasJson.emailSent ? "sent" : "failed"),
        calendarEventId: finalCalendarId,
        error: gasJson.error || "Partial delivery: only Calendar or Email succeeded",
        updatedAt: new Date().toISOString(),
      });

      return {
        statusCode: 207, // Multi-Status / Partial Delivery
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "partial_success",
          calendarStatus: gasJson.calendarStatus || (gasJson.calendarCreated ? "sent" : "failed"),
          emailStatus: gasJson.emailStatus || (gasJson.emailSent ? "sent" : "failed"),
          calendarEventId: finalCalendarId,
          message: "Partial delivery: " + (gasJson.error || "only Calendar or Email succeeded"),
        }),
      };
    }

    // Upstream error reported by GAS
    await notifRef.update({
      status: "failed",
      calendarStatus: gasJson?.calendarStatus || "failed",
      emailStatus: gasJson?.emailStatus || "failed",
      error: gasJson?.message || gasJson?.error || "Upstream Google Apps Script reported an error",
      updatedAt: new Date().toISOString(),
    });

    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "GAS_UPSTREAM_ERROR",
        message: gasJson?.message || gasJson?.error || "Upstream Google Apps Script reported an error",
      }),
    };
  } catch (err: any) {
    console.error("Unhandled error in notify-registration-en:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "error",
        code: "INTERNAL_SERVER_ERROR",
        message: err?.message || "An unexpected error occurred",
      }),
    };
  }
}
