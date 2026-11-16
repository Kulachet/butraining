/** Parallel translations by stable question index; reporting still relies on 10 numeric slots. */
export type EvaluationLanguage = "th" | "en";
export const DEFAULT_QUESTIONS_TH = [
  "หัวข้อการอบรมมีความน่าสนใจและทันสมัย",
  "การอบรมครอบคลุมเนื้อหาได้ครบถ้วน",
  "เนื้อหาสาระ และกิจกรรมของการอบรม เหมาะสม",
  "สามารถนำความรู้ที่ได้ ไปประยุกต์ใช้ได้จริง",
  "วิทยากรมีความรู้ ประสบการณ์ และเชี่ยวชาญในหัวข้อที่อบรม",
  "วิทยากรถ่ายทอดความรู้ได้ดี และมีกิจกรรมที่เหมาะสมกับหัวข้ออบรม",
  "วิทยากรเปิดโอกาสให้มีส่วนร่วมและแสดงความคิดเห็นอย่างเพียงพอ",
  "วิทยากรสามารถตอบคำถามได้อย่างเข้าใจและตรงประเด็น",
  "ระยะเวลาในการอบรม เหมาะสมและสามารถครอบคลุมกิจกรรมต่างๆ",
  "ความรู้สึกพึงพอใจโดยรวมต่อการอบรมครั้งนี้"
];
export const DEFAULT_QUESTIONS_EN = [
  "The training topic was interesting and up to date.",
  "The training covered the intended content comprehensively.",
  "The training content and activities were appropriate.",
  "I can apply the knowledge gained from this training in practice.",
  "The trainer demonstrated knowledge, experience, and expertise in the topic.",
  "The trainer communicated effectively and provided activities appropriate to the topic.",
  "The trainer provided sufficient opportunities for participation and sharing opinions.",
  "The trainer answered questions clearly and relevantly.",
  "The training duration was appropriate for the planned activities.",
  "Overall, I am satisfied with this training."
];
export const EVALUATION_COUNT = 10;
export function validQuestions(value: unknown): value is string[] {
  return Array.isArray(value) && value.length === EVALUATION_COUNT &&
    value.every(v => typeof v === "string" && v.trim().length > 0);
}
export function getEvaluationQuestions(data: Record<string, any> | undefined, lang: EvaluationLanguage): string[] {
  if (lang === "en") return validQuestions(data?.questionsEn) ? data!.questionsEn : DEFAULT_QUESTIONS_EN;
  return validQuestions(data?.questions) ? data!.questions : DEFAULT_QUESTIONS_TH;
}
export const evaluationUi = {
  th: {
    loading: "กำลังโหลดข้อมูล...", missingCourse: "ไม่พบข้อมูลหลักสูตร", loadError: "ข้อผิดพลาดในการโหลดข้อมูล",
    errorTitle: "ไม่สามารถโหลดแบบประเมินได้",
    permissionDenied: "คุณไม่มีสิทธิ์เข้าถึงหรือส่งแบบประเมินนี้ กรุณาตรวจสอบบัญชีผู้ใช้งานของท่าน",
    networkError: "ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง",
    loginTitle: "กรุณาเข้าสู่ระบบ", loginBody: "ท่านจำเป็นต้องเข้าสู่ระบบด้วยอีเมล @bu.ac.th เพื่อทำแบบประเมินความพึงพอใจของหลักสูตรนี้",
    loginButton: "เข้าสู่ระบบเพื่อทำแบบประเมิน", thanks: "ขอบคุณสำหรับการประเมิน",
    already: "คุณได้ส่งแบบประเมินสำหรับหลักสูตรนี้แล้ว",
    duplicateSubmission: "ระบบได้รับแบบประเมินของคุณแล้ว ไม่สามารถส่งซ้ำได้",
    home: "กลับสู่หน้าหลัก", back: "ย้อนกลับ", title: "แบบประเมินความพึงพอใจ", course: "หลักสูตร:", topic: "หัวข้อประเมิน",
    scale: ["มากสุด", "มาก", "ปานกลาง", "น้อย", "น้อยสุด"], suggestion: "ข้อเสนอแนะเพิ่มเติม",
    suggestionPlaceholder: "กรุณากรอกข้อเสนอแนะเพื่อการพัฒนาหลักสูตร...", submit: "ส่งแบบประเมินผล",
    incomplete: "กรุณาให้คะแนนให้ครบทุกข้อ", success: "ส่งแบบประเมินเรียบร้อยแล้ว ขอบคุณครับ!", submitError: "เกิดข้อผิดพลาดในการส่งข้อมูล"
  },
  en: {
    loading: "Loading course...", missingCourse: "Course not found", loadError: "Unable to load the evaluation",
    errorTitle: "Unable to load evaluation",
    permissionDenied: "You do not have permission to access or submit this evaluation. Please verify your signed-in account.",
    networkError: "Unable to connect to the server. Please check your internet connection and try again.",
    loginTitle: "Sign in required", loginBody: "Please sign in with your @bu.ac.th email address to complete this course evaluation.",
    loginButton: "Sign in to evaluate", thanks: "Thank you for your feedback",
    already: "You have already submitted an evaluation for this course.",
    duplicateSubmission: "Your evaluation has already been received. Duplicate submissions are not allowed.",
    home: "Back to home", back: "Back", title: "Course Satisfaction Evaluation", course: "Course:", topic: "Evaluation criteria",
    scale: ["Highest", "High", "Moderate", "Low", "Lowest"], suggestion: "Additional suggestions",
    suggestionPlaceholder: "Share any suggestions for improving this course...", submit: "Submit evaluation",
    incomplete: "Please rate every question", success: "Your evaluation has been submitted. Thank you!", submitError: "Unable to submit your evaluation"
  }
} as const;
