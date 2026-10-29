import { Course, Instructor, Session, CourseSession } from "../types";
import { 
  formatInstructorName, 
  formatDateThai, 
  formatDateEn, 
  formatSessionTime, 
  getCourseSessions 
} from "./utils";

/**
 * Escapes characters for safe inclusion in HTML email templates.
 */
export function escapeHtml(str: string | undefined | null): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface LocalizedSessionItem {
  id: string;
  sessionName: string;
  date: string;
  startTime: string;
  endTime: string;
  locationDetail: string;
  formattedDate: string;
  formattedTime: string;
}

export interface RegistrationEmailPayload {
  // Legacy fields (100% backward compatible with existing deployed GAS script)
  courseTitle: string;
  description: string;
  instructorName: string;
  location: string;
  guestEmail: string;
  guestName: string;
  recipientName: string;
  guestId: string;
  guestPosition: string;
  date: string;
  startTime: string;
  endTime: string;

  // Modern bilingual and multi-day fields
  language: 'th' | 'en';
  isMultiDay: boolean;
  emailSubject: string;
  subject: string;
  emailBody: string;
  body: string;
  emailHtmlBody: string;
  htmlBody: string;
  scheduleText: string;
  senderName: string;
  sessions: LocalizedSessionItem[];
}

export interface BuildEmailParams {
  course: Course;
  instructor: Instructor;
  session?: Session | CourseSession;
}

/**
 * Formats multi-session schedule for plain text email bodies.
 */
export function formatRegistrationScheduleText(
  sessions: LocalizedSessionItem[],
  lang: 'th' | 'en'
): string {
  if (sessions.length === 0) return "";
  if (sessions.length === 1) {
    const s = sessions[0];
    if (lang === 'en') {
      return `Date & Time: ${s.formattedDate} (${s.formattedTime})\nVenue: ${s.locationDetail}`;
    }
    return `วันเวลา: ${s.formattedDate} (${s.formattedTime})\nสถานที่: ${s.locationDetail}`;
  }

  // Multi-day
  if (lang === 'en') {
    return sessions
      .map(
        (s) =>
          `  • ${s.sessionName}: ${s.formattedDate} (${s.formattedTime})\n    Venue: ${s.locationDetail}`
      )
      .join("\n");
  }

  return sessions
    .map(
      (s) =>
        `  • ${s.sessionName}: ${s.formattedDate} (${s.formattedTime})\n    สถานที่: ${s.locationDetail}`
    )
    .join("\n");
}

/**
 * Constructs the localized plain-text email body.
 */
export function buildRegistrationEmailBody(params: {
  courseTitle: string;
  recipientName: string;
  speakerName?: string;
  sessions: LocalizedSessionItem[];
  lang: 'th' | 'en';
  isMultiDay: boolean;
}): string {
  const { courseTitle, recipientName, speakerName, sessions, lang, isMultiDay } = params;
  const scheduleText = formatRegistrationScheduleText(sessions, lang);

  if (lang === 'en') {
    const speakerLine = speakerName ? `Speaker: ${speakerName}\n` : "";
    const calNotice = isMultiDay
      ? "A Google Calendar invitation has been attached for the first session. Please add remaining sessions to your personal calendar."
      : "A Google Calendar invitation has been attached. Please check your calendar.";

    return (
      `Dear ${recipientName},\n\n` +
      `You have successfully registered for the workshop "${courseTitle}".\n` +
      speakerLine +
      (isMultiDay ? `Training Schedule:\n${scheduleText}\n\n` : `${scheduleText}\n\n`) +
      `${calNotice}\n\n` +
      `Learning Development Office\nBangkok University`
    );
  }

  // Thai
  const speakerLine = speakerName ? `วิทยากร: ${speakerName}\n` : "";
  const calNotice = isMultiDay
    ? "ระบบได้ส่งคำเชิญปฏิทินสำหรับวันอบรมแรกแล้ว กรุณาบันทึกวันอบรมถัดไปเพิ่มเติมลงในปฏิทินของท่าน"
    : "ท่านสามารถตรวจสอบคำเชิญในปฏิทิน Google Calendar ของท่านเพื่อบันทึกวันเวลาดังกล่าว";

  return (
    `เรียน ${recipientName}\n\n` +
    `ท่านได้ลงทะเบียนเข้าร่วมการอบรมหลักสูตร "${courseTitle}" เรียบร้อยแล้ว\n` +
    speakerLine +
    (isMultiDay ? `กำหนดการอบรม:\n${scheduleText}\n\n` : `${scheduleText}\n\n`) +
    `${calNotice}\n\n` +
    `สำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ`
  );
}

/**
 * Constructs the localized HTML email body with safe dynamic escaping.
 */
export function buildRegistrationEmailHtml(params: {
  courseTitle: string;
  recipientName: string;
  speakerName?: string;
  sessions: LocalizedSessionItem[];
  lang: 'th' | 'en';
  isMultiDay: boolean;
}): string {
  const { courseTitle, recipientName, speakerName, sessions, lang, isMultiDay } = params;

  const safeTitle = escapeHtml(courseTitle);
  const safeRecipient = escapeHtml(recipientName);
  const safeSpeaker = escapeHtml(speakerName);

  if (lang === 'en') {
    let scheduleHtml = "";
    if (isMultiDay) {
      scheduleHtml = `
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0; font-weight: 700; color: #0f172a; font-size: 14px;">Training Schedule (${sessions.length} Days):</p>
          <ul style="margin: 0; padding-left: 20px; color: #334155; font-size: 14px; line-height: 1.8;">
            ${sessions
              .map(
                (s) =>
                  `<li><strong>${escapeHtml(s.sessionName)}:</strong> ${escapeHtml(s.formattedDate)} ` +
                  `(${escapeHtml(s.formattedTime)})<br>` +
                  `<span style="color: #64748b; font-size: 13px;">Venue: ${escapeHtml(s.locationDetail)}</span></li>`
              )
              .join("")}
          </ul>
        </div>
      `;
    } else {
      const s = sessions[0];
      scheduleHtml = `
        <p style="margin: 8px 0;"><b>Date &amp; Time:</b> ${escapeHtml(s?.formattedDate || "")} (${escapeHtml(s?.formattedTime || "")})</p>
        <p style="margin: 8px 0;"><b>Venue:</b> ${escapeHtml(s?.locationDetail || "Not specified")}</p>
      `;
    }

    return (
      `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 620px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;">` +
      `<div style="border-bottom: 2px solid #8b0000; padding-bottom: 12px; margin-bottom: 20px;">` +
      `<span style="font-size: 11px; font-weight: 700; color: #8b0000; text-transform: uppercase; letter-spacing: 1px;">Bangkok University • Learning Development Office</span>` +
      `<h2 style="color: #0f172a; margin: 6px 0 0 0; font-size: 18px;">Registration Confirmation</h2>` +
      `</div>` +
      `<p style="font-size: 15px; margin-top: 0;">Dear <b>${safeRecipient}</b>,</p>` +
      `<p>You have successfully registered for the workshop: <strong style="color: #0f172a;">&ldquo;${safeTitle}&rdquo;</strong></p>` +
      (safeSpeaker ? `<p style="margin: 8px 0;"><b>Speaker:</b> ${safeSpeaker}</p>` : "") +
      scheduleHtml +
      (isMultiDay
        ? `<p style="color: #475569; margin-top: 18px; font-size: 13px; line-height: 1.5; background-color: #fffbeb; padding: 10px 14px; border-radius: 8px; border-left: 3px solid #f59e0b;">` +
          `A Google Calendar invitation has been attached for the first session. Please add remaining sessions to your personal calendar.</p>`
        : `<p style="color: #475569; margin-top: 16px; font-size: 13px;">A Google Calendar invitation has been attached. Please check your calendar.</p>`) +
      `<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9;">` +
      `<p style="margin: 0; font-weight: bold; color: #8b0000;">Learning Development Office</p>` +
      `<p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b;">Bangkok University</p>` +
      `</div>` +
      `</div>`
    );
  }

  // Thai
  let scheduleHtml = "";
  if (isMultiDay) {
    scheduleHtml = `
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-weight: 700; color: #0f172a; font-size: 14px;">กำหนดการอบรม (${sessions.length} วัน):</p>
        <ul style="margin: 0; padding-left: 20px; color: #334155; font-size: 14px; line-height: 1.8;">
          ${sessions
            .map(
              (s) =>
                `<li><strong>${escapeHtml(s.sessionName)}:</strong> ${escapeHtml(s.formattedDate)} ` +
                `(${escapeHtml(s.formattedTime)})<br>` +
                `<span style="color: #64748b; font-size: 13px;">สถานที่: ${escapeHtml(s.locationDetail)}</span></li>`
            )
            .join("")}
        </ul>
      </div>
    `;
  } else {
    const s = sessions[0];
    scheduleHtml = `
      <p style="margin: 8px 0;"><b>วันเวลา:</b> ${escapeHtml(s?.formattedDate || "")} (${escapeHtml(s?.formattedTime || "")})</p>
      <p style="margin: 8px 0;"><b>สถานที่:</b> ${escapeHtml(s?.locationDetail || "ไม่ระบุ")}</p>
    `;
  }

  return (
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 620px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;">` +
    `<div style="border-bottom: 2px solid #8b0000; padding-bottom: 12px; margin-bottom: 20px;">` +
    `<span style="font-size: 11px; font-weight: 700; color: #8b0000; text-transform: uppercase; letter-spacing: 1px;">มหาวิทยาลัยกรุงเทพ • สำนักพัฒนาการเรียนรู้</span>` +
    `<h2 style="color: #0f172a; margin: 6px 0 0 0; font-size: 18px;">ยืนยันการลงทะเบียนอบรม</h2>` +
    `</div>` +
    `<p style="font-size: 15px; margin-top: 0;">เรียน <b>${safeRecipient}</b>,</p>` +
    `<p>ท่านได้ลงทะเบียนเข้าร่วมการอบรมหลักสูตร <strong style="color: #0f172a;">&ldquo;${safeTitle}&rdquo;</strong> เรียบร้อยแล้ว</p>` +
    (safeSpeaker ? `<p style="margin: 8px 0;"><b>วิทยากร:</b> ${safeSpeaker}</p>` : "") +
    scheduleHtml +
    (isMultiDay
      ? `<p style="color: #475569; margin-top: 18px; font-size: 13px; line-height: 1.5; background-color: #fffbeb; padding: 10px 14px; border-radius: 8px; border-left: 3px solid #f59e0b;">` +
        `ระบบได้ส่งคำเชิญปฏิทินสำหรับวันอบรมแรกแล้ว กรุณาบันทึกวันอบรมถัดไปเพิ่มเติมลงในปฏิทินของท่าน</p>`
      : `<p style="color: #475569; margin-top: 16px; font-size: 13px;">ท่านสามารถตรวจสอบคำเชิญในปฏิทิน Google Calendar ของท่านเพื่อบันทึกวันเวลาดังกล่าว</p>`) +
    `<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9;">` +
    `<p style="margin: 0; font-weight: bold; color: #8b0000;">สำนักพัฒนาการเรียนรู้ (Learning Development Office)</p>` +
    `<p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b;">มหาวิทยาลัยกรุงเทพ</p>` +
    `</div>` +
    `</div>`
  );
}

/**
 * Builds the complete registration email payload for the Google Apps Script webhook.
 * 
 * BUSINESS RULES ENFORCED:
 * 1. course.language === 'en' -> English email subject and body.
 * 2. course.language === 'th' -> Thai email subject and body.
 * 3. Missing or invalid course.language -> Defaults to 'th' for 100% backward compatibility.
 * 4. Language strictly follows course.language, regardless of instructor nationality or employee ID.
 * 5. Preserves existing instructor name/title formatter (formatInstructorName) with academic titles.
 * 6. For multi-day courses, lists ALL training session dates and times in chronological order.
 * 7. Dates formatted using full English weekday/month/Gregorian year for EN, and full Thai weekday/month/BE year for TH.
 * 8. Dynamic HTML escaping against injection.
 * 9. Legacy fields (courseTitle, description, instructorName, location, guestEmail, guestName,
 *    recipientName, guestId, guestPosition, date, startTime, endTime) preserved completely.
 */
export function buildRegistrationEmailPayload({
  course,
  instructor,
  session,
}: BuildEmailParams): RegistrationEmailPayload {
  // 1. Language strictly derived from course.language (fallback to 'th')
  const courseLang: 'th' | 'en' = course?.language === 'en' ? 'en' : 'th';
  const isEn = courseLang === 'en';

  // 2. Instructor display name with academic title preserved
  const formattedGuestName = formatInstructorName(
    instructor.name,
    instructor.id,
    instructor.position,
    courseLang
  );
  const formattedSpeakerName = formatInstructorName(
    course.instructorName,
    course.instructorId,
    undefined,
    courseLang
  );

  // 3. Normalized sessions list in chronological order
  const rawSessions = getCourseSessions(course);
  const isMultiDay = rawSessions.length > 1;

  const localizedSessions: LocalizedSessionItem[] = rawSessions.map((s, idx) => {
    const formattedDate = isEn ? formatDateEn(s.date) : formatDateThai(s.date);
    const formattedTime = formatSessionTime(s.startTime, s.endTime, courseLang);
    const sessionName =
      s.sessionName || (isEn ? `Day ${idx + 1}` : `วันที่ ${idx + 1}`);
    const locationDetail =
      s.locationDetail || course.locationDetail || (isEn ? "On-site" : "ไม่ระบุ");

    return {
      id: s.id || `session_${idx + 1}`,
      sessionName,
      date: s.date || course.date || "",
      startTime: s.startTime || course.startTime || "09:00",
      endTime: s.endTime || course.endTime || "16:00",
      locationDetail,
      formattedDate,
      formattedTime,
    };
  });

  // Selected session or first session for Day 1 calendar invite
  const firstSession =
    session ||
    localizedSessions[0] || {
      date: course.date || "",
      startTime: course.startTime || "09:00",
      endTime: course.endTime || "16:00",
      locationDetail: course.locationDetail || (isEn ? "On-site" : "ไม่ระบุ"),
    };

  const legacyLocation =
    firstSession.locationDetail ||
    course.locationDetail ||
    (isEn ? "On-site" : "ไม่ระบุ");
  const legacyDate = firstSession.date || course.date || "";
  const legacyStartTime = firstSession.startTime || course.startTime || "09:00";
  const legacyEndTime = firstSession.endTime || course.endTime || "16:00";

  // 4. Localized subject line
  const emailSubject = isEn
    ? `Registration Confirmation: ${course.title}`
    : `ยืนยันการลงทะเบียน: ${course.title}`;

  // 5. Plain text schedule summary
  const scheduleText = formatRegistrationScheduleText(localizedSessions, courseLang);

  // 6. Localized email body (plain text)
  const emailBody = buildRegistrationEmailBody({
    courseTitle: course.title,
    recipientName: formattedGuestName,
    speakerName: formattedSpeakerName || course.instructorName,
    sessions: localizedSessions,
    lang: courseLang,
    isMultiDay,
  });

  // 7. Localized HTML email body
  const emailHtmlBody = buildRegistrationEmailHtml({
    courseTitle: course.title,
    recipientName: formattedGuestName,
    speakerName: formattedSpeakerName || course.instructorName,
    sessions: localizedSessions,
    lang: courseLang,
    isMultiDay,
  });

  const senderName = isEn ? "Learning Development Office" : "สำนักพัฒนาการเรียนรู้";

  return {
    // Legacy fields
    courseTitle: course.title,
    description: course.description || "",
    instructorName: formattedSpeakerName || course.instructorName || "",
    location: legacyLocation,
    guestEmail: instructor.email,
    guestName: formattedGuestName,
    recipientName: formattedGuestName,
    guestId: instructor.id,
    guestPosition: instructor.position || "",
    date: legacyDate,
    startTime: legacyStartTime,
    endTime: legacyEndTime,

    // Modern fields
    language: courseLang,
    isMultiDay,
    emailSubject,
    subject: emailSubject,
    emailBody,
    body: emailBody,
    emailHtmlBody,
    htmlBody: emailHtmlBody,
    scheduleText,
    senderName,
    sessions: localizedSessions,
  };
}
