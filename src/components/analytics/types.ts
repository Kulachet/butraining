export interface AnalyticsData {
  courses: any[];
  registrations: any[];
  evaluations: any[];
  instructors: any[];
}

export const QUESTIONS = [
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

// Helper to determine score level
export const getScoreLevel = (score: number) => {
  if (score >= 4.51) return { label: "ดีมาก", color: "#16a34a" }; // emerald-600
  if (score >= 3.51) return { label: "ดี", color: "#3b82f6" }; // blue-500
  if (score >= 2.51) return { label: "ปานกลาง", color: "#f59e0b" }; // amber-500
  return { label: "ต้องปรับปรุง", color: "#dc2626" }; // red-600
};

export const getRatingsArray = (ratings: any): number[] => {
  if (!ratings) return new Array(10).fill(0);
  if (Array.isArray(ratings)) return ratings;
  return Array.from({ length: 10 }, (_, i) => ratings[i] || ratings[String(i)] || 0);
};
