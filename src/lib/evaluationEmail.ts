import { Course } from "../types";
import { resolveCourseLang } from "../contexts/LanguageContext";
import { EvaluationLanguage } from "./evaluationI18n";
import { buildEvaluationEmailUrl } from "./appUrl";
import { escapeHtml } from "./registrationEmail";
import { formatInstructorName } from "./utils";

export interface EvaluationEmailRecipient {
  email: string;
  name: string;
}

export interface EvaluationEmailPayload {
  action: "send_evaluations";
  language: EvaluationLanguage;
  courseId: string;
  courseTitle: string;
  evalLink: string;
  evaluationUrl: string;
  recipients: EvaluationEmailRecipient[];
  emailSubject: string;
  emailBody: string;
  emailHtmlBody: string;
  senderName: string;
}

export interface BuildEvaluationEmailParams {
  baseUrl: string;
  course: Partial<Course> & { id: string };
  recipients: EvaluationEmailRecipient[];
}

export interface ResolveEvalRecipientNameParams {
  language: EvaluationLanguage;
  userName?: string;
  instructorId?: string;
  userPosition?: string;
  englishFullName?: string;
  englishNameVerified?: boolean;
}

export interface RenderedEvaluationEmailContent {
  language: EvaluationLanguage;
  subject: string;
  body: string;
  htmlBody: string;
  senderName: string;
}

export const EVALUATION_PROMPT_TH = "กรุณาคลิกลิงก์ด้านล่างเพื่อประเมินผลการอบรม";
export const EVALUATION_PROMPT_EN =
  "Please take a few moments to complete the training evaluation by clicking the link below.";

/**
 * Resolves participant display name according to evaluation email language.
 * - For English courses (`en`): prefers verified `englishFullName`, falls back to Latin-script name
 *   preserving academic titles, and uses `"Participant"` when unavailable or Thai-only without verified EN name.
 * - For Thai courses (`th`): preserves standard Thai academic title formatting.
 */
export function resolveEvaluationRecipientName({
  language,
  userName,
  instructorId,
  userPosition,
  englishFullName,
  englishNameVerified,
}: ResolveEvalRecipientNameParams): string {
  const rawName = (userName || "").trim();

  if (language === "en") {
    const verifiedEn = (englishFullName || "").trim();
    if (verifiedEn && englishNameVerified === true && !/[\u0E00-\u0E7F]/.test(verifiedEn)) {
      return verifiedEn;
    }

    if (rawName && !/[\u0E00-\u0E7F]/.test(rawName) && /[A-Za-z]/.test(rawName)) {
      const formattedEn = formatInstructorName(rawName, instructorId, userPosition, "en").trim();
      if (formattedEn && !/[\u0E00-\u0E7F]/.test(formattedEn)) {
        return formattedEn;
      }
    }

    return "Participant";
  }

  const formattedTh = formatInstructorName(rawName, instructorId, userPosition, "th").trim();
  return formattedTh || "ผู้เข้าร่วมอบรม";
}

function normalizeGreetingName(rawName: string | undefined | null, language: EvaluationLanguage): string {
  let cleaned = (rawName || "").trim();
  if (cleaned.startsWith("เรียน ")) {
    cleaned = cleaned.substring(5).trim();
  } else if (cleaned.startsWith("Dear ")) {
    cleaned = cleaned.substring(5).trim();
  }

  if (language === "en") {
    if (!cleaned || /[\u0E00-\u0E7F]/.test(cleaned)) {
      return "Participant";
    }
    return cleaned;
  }

  return cleaned || "ผู้เข้าร่วมอบรม";
}

/**
 * Renders localized Plain Text and HTML content for an evaluation invitation email.
 * Used both for GAS fallback payload fields and for offline preview verification.
 */
export function renderEvaluationEmailContent(params: {
  language: EvaluationLanguage;
  courseTitle: string;
  evalLink: string;
  recipientName?: string;
}): RenderedEvaluationEmailContent {
  const { language, courseTitle, evalLink, recipientName } = params;
  const isEn = language === "en";
  const safeTitle = escapeHtml(courseTitle);
  const safeEvalLink = escapeHtml(evalLink);
  const greetingName = normalizeGreetingName(recipientName, language);
  const safeGreeting = escapeHtml(greetingName);

  if (isEn) {
    const subject = `[BU Training] Training Evaluation Request: ${courseTitle}`;
    const body =
      `Dear ${greetingName},\n\n` +
      `Thank you for attending "${courseTitle}".\n\n` +
      `Your feedback is valuable in helping us improve the quality of our future training programs.\n` +
      `${EVALUATION_PROMPT_EN}\n\n` +
      `Complete Evaluation:\n` +
      `${evalLink}\n\n` +
      `If the button does not work, please copy and paste the following link into your browser:\n` +
      `${evalLink}\n\n` +
      `Thank you for your time and valuable feedback.\n\n` +
      `Learning Development Office (LDO)\n` +
      `Bangkok University`;

    const htmlBody =
      `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;">` +
      `<div style="border-bottom: 2px solid #8b0000; padding-bottom: 12px; margin-bottom: 20px;">` +
      `<span style="font-size: 11px; font-weight: 700; color: #8b0000; text-transform: uppercase; letter-spacing: 1px;">Bangkok University • Learning Development Office</span>` +
      `<h2 style="color: #0f172a; margin: 6px 0 0 0; font-size: 18px;">Training Evaluation</h2>` +
      `</div>` +
      `<p style="margin-top: 0;">Dear <b>${safeGreeting}</b>,</p>` +
      `<p>Thank you for attending <b>&ldquo;${safeTitle}&rdquo;</b>.</p>` +
      `<p>Your feedback is valuable in helping us improve the quality of our future training programs.</p>` +
      `<p>${escapeHtml(EVALUATION_PROMPT_EN)}</p>` +
      `<div style="margin: 28px 0; text-align: center;">` +
      `<a href="${safeEvalLink}" style="background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 10px; display: inline-block; font-weight: bold; font-size: 15px;">Complete Evaluation</a>` +
      `</div>` +
      `<p style="font-size: 13px; color: #64748b; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 14px;">` +
      `If the button does not work, please copy and paste the following link into your browser:<br>` +
      `<a href="${safeEvalLink}" style="color: #2563eb; word-break: break-all;">${safeEvalLink}</a>` +
      `</p>` +
      `<p style="margin-top: 20px;">Thank you for your time and valuable feedback.</p>` +
      `<div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid #f1f5f9;">` +
      `<p style="margin: 0; font-weight: bold; color: #8b0000;">Learning Development Office (LDO)</p>` +
      `<p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b;">Bangkok University</p>` +
      `</div>` +
      `</div>`;

    return {
      language,
      subject,
      body,
      htmlBody,
      senderName: "Learning Development Office",
    };
  }

  // Preserved existing Thai email wording, subject, branding, layout, and styling
  const subject = `[BU Training] ขอความอนุเคราะห์ทำแบบประเมิน: ${courseTitle}`;
  const body =
    `เรียน ${greetingName}\n\n` +
    `ขอขอบคุณที่ท่านสละเวลาเข้าร่วมการอบรมหลักสูตร "${courseTitle}"\n` +
    `เพื่อให้การจัดการอบรมในครั้งต่อไปดียิ่งขึ้น ${EVALUATION_PROMPT_TH}\n\n` +
    `${evalLink}\n\n` +
    `สำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ`;

  const htmlBody =
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;">` +
    `<div style="border-bottom: 2px solid #8b0000; padding-bottom: 12px; margin-bottom: 20px;">` +
    `<span style="font-size: 11px; font-weight: 700; color: #8b0000; text-transform: uppercase; letter-spacing: 1px;">มหาวิทยาลัยกรุงเทพ • สำนักพัฒนาการเรียนรู้</span>` +
    `<h2 style="color: #0f172a; margin: 6px 0 0 0; font-size: 18px;">แบบประเมินความพึงพอใจการอบรม</h2>` +
    `</div>` +
    `<p style="margin-top: 0;">เรียน <b>${safeGreeting}</b>,</p>` +
    `<p>ขอขอบคุณที่ท่านสละเวลาเข้าร่วมการอบรมหลักสูตร <b>&ldquo;${safeTitle}&rdquo;</b></p>` +
    `<p>${escapeHtml(EVALUATION_PROMPT_TH)}</p>` +
    `<div style="margin: 28px 0; text-align: center;">` +
    `<a href="${safeEvalLink}" style="background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 10px; display: inline-block; font-weight: bold; font-size: 15px;">เริ่มทำแบบประเมินผล</a>` +
    `</div>` +
    `<p style="font-size: 13px; color: #64748b; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 14px;">` +
    `หากปุ่มด้านบนไม่ทำงาน ท่านสามารถคลิกที่ลิงก์นี้แทน:<br>` +
    `<a href="${safeEvalLink}" style="color: #2563eb; word-break: break-all;">${safeEvalLink}</a>` +
    `</p>` +
    `<div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #f1f5f9;">` +
    `<p style="margin: 0; font-weight: bold; color: #8b0000;">สำนักพัฒนาการเรียนรู้ (Learning Development Office)</p>` +
    `<p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b;">มหาวิทยาลัยกรุงเทพ</p>` +
    `</div>` +
    `</div>`;

  return {
    language,
    subject,
    body,
    htmlBody,
    senderName: "สำนักพัฒนาการเรียนรู้",
  };
}

/**
 * Builds the bilingual (`th` / `en`) evaluation invitation payload for Google Apps Script.
 * Language is determined strictly from `course.language` via `resolveCourseLang(course)`.
 */
export function buildEvaluationEmailPayload({
  baseUrl,
  course,
  recipients,
}: BuildEvaluationEmailParams): EvaluationEmailPayload {
  const language: EvaluationLanguage = resolveCourseLang(course);
  const isEn = language === "en";

  const courseTitle =
    (course.title || "").trim() || (isEn ? "Training Workshop" : "หลักสูตรอบรม");

  const sanitizedRecipients = (recipients || [])
    .map((r) => ({
      email: (r?.email || "").trim(),
      name: normalizeGreetingName(r?.name, language),
    }))
    .filter((r) => Boolean(r.email));

  if (sanitizedRecipients.length === 0) {
    throw new Error(
      isEn
        ? "At least one valid recipient email is required."
        : "ไม่มีอีเมลผู้รับที่ถูกต้องสำหรับการส่งแบบประเมิน"
    );
  }

  // Validates published public HTTPS URL, preserves `#/evaluate/{courseId}`, encodes query safely
  const evalLink = buildEvaluationEmailUrl(baseUrl, course.id, courseTitle);

  const rendered = renderEvaluationEmailContent({
    language,
    courseTitle,
    evalLink,
    recipientName:
      sanitizedRecipients.length === 1
        ? sanitizedRecipients[0].name
        : isEn
        ? "Participant"
        : "ผู้เข้าร่วมอบรม",
  });

  return {
    action: "send_evaluations",
    language,
    courseId: course.id,
    courseTitle,
    evalLink,
    evaluationUrl: evalLink,
    recipients: sanitizedRecipients,
    emailSubject: rendered.subject,
    emailBody: rendered.body,
    emailHtmlBody: rendered.htmlBody,
    senderName: rendered.senderName,
  };
}
