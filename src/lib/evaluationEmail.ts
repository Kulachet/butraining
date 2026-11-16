import { Course } from "../types";
import { resolveCourseLang } from "../contexts/LanguageContext";
import { EvaluationLanguage } from "./evaluationI18n";
import { buildEvaluationEmailUrl } from "./appUrl";
import { escapeHtml } from "./registrationEmail";

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

export const EVALUATION_PROMPT_TH = "กรุณาคลิกลิงก์ด้านล่างเพื่อประเมินผลการอบรม";
export const EVALUATION_PROMPT_EN = "Please click the link below to complete the training evaluation.";

/**
 * Builds the bilingual (`th` / `en`) evaluation invitation payload for Google Apps Script.
 * Strictly validates the configured public base URL via `buildEvaluationEmailUrl` so
 * temporary AI Studio Preview / localhost URLs are never emitted in external emails.
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
      name: (r?.name || "").trim() || (isEn ? "Participant" : "ผู้เข้าร่วมอบรม"),
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
  const safeTitle = escapeHtml(courseTitle);
  const safeEvalLink = escapeHtml(evalLink);

  if (isEn) {
    const emailSubject = `[BU Training] Course Evaluation: ${courseTitle}`;
    const emailBody =
      `Dear Participant,\n\n` +
      `Thank you for participating in "${courseTitle}".\n` +
      `We appreciate your valuable feedback to help improve our future faculty development programs.\n\n` +
      `${EVALUATION_PROMPT_EN}\n` +
      `${evalLink}\n\n` +
      `Best regards,\n` +
      `Learning Development Office\nBangkok University`;

    const emailHtmlBody =
      `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;">` +
      `<div style="border-bottom: 2px solid #8b0000; padding-bottom: 12px; margin-bottom: 20px;">` +
      `<span style="font-size: 11px; font-weight: 700; color: #8b0000; text-transform: uppercase; letter-spacing: 1px;">Bangkok University • Learning Development Office</span>` +
      `<h2 style="color: #0f172a; margin: 6px 0 0 0; font-size: 18px;">Course Satisfaction Evaluation</h2>` +
      `</div>` +
      `<p style="margin-top: 0;">Thank you for participating in <b>&ldquo;${safeTitle}&rdquo;</b>.</p>` +
      `<p>${escapeHtml(EVALUATION_PROMPT_EN)}</p>` +
      `<div style="margin: 28px 0; text-align: center;">` +
      `<a href="${safeEvalLink}" style="background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 10px; display: inline-block; font-weight: bold; font-size: 15px;">Complete Course Evaluation</a>` +
      `</div>` +
      `<p style="font-size: 13px; color: #64748b; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 14px;">` +
      `If the button above does not work, please copy and open this link:<br>` +
      `<a href="${safeEvalLink}" style="color: #2563eb; word-break: break-all;">${safeEvalLink}</a>` +
      `</p>` +
      `<div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #f1f5f9;">` +
      `<p style="margin: 0; font-weight: bold; color: #8b0000;">Learning Development Office</p>` +
      `<p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b;">Bangkok University</p>` +
      `</div>` +
      `</div>`;

    return {
      action: "send_evaluations",
      language,
      courseId: course.id,
      courseTitle,
      evalLink,
      evaluationUrl: evalLink,
      recipients: sanitizedRecipients,
      emailSubject,
      emailBody,
      emailHtmlBody,
      senderName: "Learning Development Office",
    };
  }

  const emailSubject = `[BU Training] ขอความอนุเคราะห์ทำแบบประเมิน: ${courseTitle}`;
  const emailBody =
    `เรียน ผู้เข้าร่วมอบรม\n\n` +
    `ขอขอบคุณที่ท่านสละเวลาเข้าร่วมการอบรมหลักสูตร "${courseTitle}"\n` +
    `เพื่อให้การจัดการอบรมในครั้งต่อไปดียิ่งขึ้น ${EVALUATION_PROMPT_TH}\n\n` +
    `${evalLink}\n\n` +
    `สำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ`;

  const emailHtmlBody =
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;">` +
    `<div style="border-bottom: 2px solid #8b0000; padding-bottom: 12px; margin-bottom: 20px;">` +
    `<span style="font-size: 11px; font-weight: 700; color: #8b0000; text-transform: uppercase; letter-spacing: 1px;">มหาวิทยาลัยกรุงเทพ • สำนักพัฒนาการเรียนรู้</span>` +
    `<h2 style="color: #0f172a; margin: 6px 0 0 0; font-size: 18px;">แบบประเมินความพึงพอใจการอบรม</h2>` +
    `</div>` +
    `<p style="margin-top: 0;">ขอขอบคุณที่ท่านสละเวลาเข้าร่วมการอบรมหลักสูตร <b>&ldquo;${safeTitle}&rdquo;</b></p>` +
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
    action: "send_evaluations",
    language,
    courseId: course.id,
    courseTitle,
    evalLink,
    evaluationUrl: evalLink,
    recipients: sanitizedRecipients,
    emailSubject,
    emailBody,
    emailHtmlBody,
    senderName: "สำนักพัฒนาการเรียนรู้",
  };
}
