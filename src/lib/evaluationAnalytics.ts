// Shared Evaluation analytics calculation & deterministic sentiment classification utilities

export interface QuestionStat {
  index: number;
  question: string;
  average: number;
  count: number; // valid response count for this question
  distribution: { [score: number]: number }; // 1 to 5
  pct5: number;
  pct45: number;
}

export interface DimensionStat {
  title: string;
  description: string;
  questionIndices: number[];
  average: number;
  pct45: number;
}

export type CommentSentiment = 'positive' | 'neutral' | 'negative';

export interface AnalyzedComment {
  id: string;
  index: number;
  text: string;
  sentiment: CommentSentiment;
  sentimentLabel: string;
  sentimentScore: number;
  matchedThemes: string[];
  createdAt: string;
}

export interface RatingDistributionItem {
  score: number;
  count: number;
  percentage: number;
}

export interface EvaluationAnalysisResult {
  totalResponses: number; // total evaluation forms submitted
  overallAverage: number;
  overallLevel: { label: string; color: string; bg: string };
  pct5Overall: number; // topBoxPercentage
  pct45Overall: number; // highSatisfactionPercentage
  distribution: RatingDistributionItem[];
  questionStats: QuestionStat[];
  highestQuestion: QuestionStat | null;
  lowestQuestion: QuestionStat | null;
  dimensions: DimensionStat[];
  executiveSummaryText: string;
  comments: AnalyzedComment[];
  commentStats: {
    totalComments: number;
    positiveCount: number;
    neutralCount: number;
    negativeCount: number;
    positivePct: number;
    neutralPct: number;
    negativePct: number;
  };
  recurringThemes: { theme: string; count: number; keywords: string[] }[];
  actionableRecommendations: {
    strengths: string[];
    improvements: string[];
    futureTopics: string[];
  };
}

export interface CourseOperationalStats {
  totalRegistrations: number;
  totalAttendees: number;
  attendanceRate: number;
  totalEvals: number;
  uniqueEvaluatorsCount: number;
  responseRate: number;
  totalCerts: number;
  certRate: number;
}

export const DEFAULT_QUESTIONS = [
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

// Helper to extract a single valid rating score (1-5), or null if skipped/blank/invalid
export const getValidRatingScore = (ratings: any, qIdx: number): number | null => {
  if (!ratings) return null;
  let val: any;
  if (Array.isArray(ratings)) {
    val = ratings[qIdx];
  } else if (typeof ratings === 'object') {
    val = ratings[qIdx] ?? ratings[String(qIdx)];
  }
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  if (isNaN(num) || num < 1 || num > 5) return null;
  return Math.round(num);
};

// Helper to normalize ratings array (for CSV export or backward compatibility)
export const getRatingsArray = (ratings: any, totalQuestions: number = 10): number[] => {
  if (!ratings) return new Array(totalQuestions).fill(0);
  if (Array.isArray(ratings)) return ratings.slice(0, totalQuestions);
  return Array.from({ length: totalQuestions }, (_, i) => {
    const val = getValidRatingScore(ratings, i);
    return val ?? 0;
  });
};

// Calculate per-question statistics with proper partial response handling
export const calculateQuestionStatistics = (
  evaluations: any[],
  questionsList: string[] = DEFAULT_QUESTIONS
): QuestionStat[] => {
  const questions = questionsList.length > 0 ? questionsList : DEFAULT_QUESTIONS;
  
  return questions.map((q, idx) => {
    let validCount = 0;
    let sum = 0;
    const distribution: { [score: number]: number } = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    evaluations.forEach(ev => {
      const score = getValidRatingScore(ev.ratings, idx);
      if (score !== null && score >= 1 && score <= 5) {
        validCount++;
        sum += score;
        distribution[score] = (distribution[score] || 0) + 1;
      }
    });

    const average = validCount > 0 ? Number((sum / validCount).toFixed(2)) : 0;
    const count5 = distribution[5] || 0;
    const count4 = distribution[4] || 0;
    const count45 = count5 + count4;

    const pct5 = validCount > 0 ? Number(((count5 / validCount) * 100).toFixed(1)) : 0;
    const pct45 = validCount > 0 ? Number(((count45 / validCount) * 100).toFixed(1)) : 0;

    return {
      index: idx,
      question: q,
      average,
      count: validCount,
      distribution,
      pct5,
      pct45
    };
  });
};

// Calculate overall score distribution (counts and percentages of scores 5, 4, 3, 2, 1)
export const calculateRatingDistribution = (
  evaluations: any[],
  totalQuestions: number = 10
): { distribution: RatingDistributionItem[]; totalValidRatings: number } => {
  const distCounts: { [score: number]: number } = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalValidRatings = 0;

  evaluations.forEach(ev => {
    for (let i = 0; i < totalQuestions; i++) {
      const score = getValidRatingScore(ev.ratings, i);
      if (score !== null && score >= 1 && score <= 5) {
        distCounts[score] = (distCounts[score] || 0) + 1;
        totalValidRatings++;
      }
    }
  });

  const distribution = [5, 4, 3, 2, 1].map(score => {
    const count = distCounts[score] || 0;
    const percentage = totalValidRatings > 0 ? Number(((count / totalValidRatings) * 100).toFixed(1)) : 0;
    return { score, count, percentage };
  });

  return { distribution, totalValidRatings };
};

// Helper for score level badge
export const getScoreLevelInfo = (score: number) => {
  if (score >= 4.50) return { label: "ดีเด่น / ดีเยี่ยม", color: "#16a34a", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (score >= 3.75) return { label: "ดีมาก", color: "#2563eb", bg: "bg-blue-50 text-blue-700 border-blue-200" };
  if (score >= 3.00) return { label: "ดี / ปานกลาง", color: "#d97706", bg: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "ควรปรับปรุง", color: "#dc2626", bg: "bg-red-50 text-red-700 border-red-200" };
};

// Generate deterministic executive interpretation
export const generateExecutiveInterpretation = (
  overallAverage: number,
  pct45: number,
  highestQuestion: QuestionStat | null,
  lowestQuestion: QuestionStat | null,
  distribution: RatingDistributionItem[],
  totalResponses: number,
  courseTitle: string = "หลักสูตร"
): string => {
  if (totalResponses === 0) {
    return "ยังไม่มีข้อมูลการประเมินสำหรับหลักสูตรนี้";
  }

  let levelText = "";
  if (overallAverage >= 4.50) {
    levelText = "ผลการประเมินโดยรวมอยู่ในระดับสูงมาก";
  } else if (overallAverage >= 4.00) {
    levelText = "ผลการประเมินโดยรวมอยู่ในระดับสูง";
  } else if (overallAverage >= 3.50) {
    levelText = "ผลการประเมินโดยรวมอยู่ในระดับดี";
  } else {
    levelText = "ผลการประเมินโดยรวมอยู่ในระดับที่ควรได้รับการพัฒนาต่อยอด";
  }

  const lowScoresCount = (distribution.find(d => d.score === 1)?.count || 0) +
                         (distribution.find(d => d.score === 2)?.count || 0) +
                         (distribution.find(d => d.score === 3)?.count || 0);
  const totalAllRatings = distribution.reduce((sum, d) => sum + d.count, 0);
  const lowScorePct = totalAllRatings > 0 ? Number(((lowScoresCount / totalAllRatings) * 100).toFixed(1)) : 0;

  const parts: string[] = [];
  parts.push(`${levelText} โดยคะแนนส่วนใหญ่คิดเป็น ${pct45}% อยู่ในระดับพึงพอใจสูง (4–5 คะแนน)`);

  if (highestQuestion) {
    parts.push(`หัวข้อที่ได้คะแนนเฉลี่ยสูงสุดคือ "${highestQuestion.question}" (เฉลี่ย ${highestQuestion.average.toFixed(2)}/5.00)`);
  }

  if (lowestQuestion && (lowestQuestion.index !== highestQuestion?.index)) {
    if (lowestQuestion.average >= 4.50) {
      parts.push(`ขณะที่ทุกหัวข้อมีผลประเมินในเกณฑ์ดีเยี่ยมอย่างสม่ำเสมอ โดยหัวข้อที่มีค่าเฉลี่ยรองลงมาคือ "${lowestQuestion.question}" (เฉลี่ย ${lowestQuestion.average.toFixed(2)})`);
    } else {
      parts.push(`ขณะที่หัวข้อ "${lowestQuestion.question}" มีค่าเฉลี่ยต่ำที่สุด (${lowestQuestion.average.toFixed(2)}) และควรติดตามในครั้งถัดไป`);
    }
  }

  if (lowScorePct > 0) {
    parts.push(`ทั้งนี้ มีสัดส่วนคะแนนในระดับ 1–3 คะแนนคิดเป็น ${lowScorePct}% ของการประเมินทั้งหมด`);
  }

  return parts.join(" ");
};

// Calculate Course Operational Stats (Registrations, Attendance, Response Rate)
export const calculateCourseOperationalStats = (
  courseId: string,
  registrations: any[],
  evaluations: any[]
): CourseOperationalStats => {
  const courseRegs = registrations.filter(r => r.courseId === courseId);
  const totalRegistrations = courseRegs.length;
  const attendedRegs = courseRegs.filter(r => r.attended);
  const totalAttendees = attendedRegs.length;
  const attendanceRate = totalRegistrations > 0 ? Number(((totalAttendees / totalRegistrations) * 100).toFixed(1)) : 0;

  const courseEvals = evaluations.filter(e => e.courseId === courseId);
  const totalEvals = courseEvals.length;

  // Calculate unique evaluators based on userId or userEmail to prevent duplicate inflation
  const evaluatorKeys = new Set<string>();
  courseEvals.forEach(e => {
    if (e.userId) evaluatorKeys.add(e.userId);
    else if (e.userEmail) evaluatorKeys.add(e.userEmail.toLowerCase());
    else if (e.id) evaluatorKeys.add(e.id);
  });
  const uniqueEvaluatorsCount = evaluatorKeys.size;

  // Response rate: evaluationResponseCount / attendedParticipantCount * 100
  // Capped at 100% to avoid impossible percentage
  let responseRate = 0;
  if (totalAttendees > 0) {
    responseRate = Math.min(100, Number(((uniqueEvaluatorsCount / totalAttendees) * 100).toFixed(1)));
  } else if (totalRegistrations > 0) {
    responseRate = Math.min(100, Number(((uniqueEvaluatorsCount / totalRegistrations) * 100).toFixed(1)));
  }

  // Certs
  const certsSent = courseRegs.filter(r => r.certStatus === 'sent').length;
  const certRate = totalAttendees > 0 ? Number(((certsSent / totalAttendees) * 100).toFixed(1)) : 0;

  return {
    totalRegistrations,
    totalAttendees,
    attendanceRate,
    totalEvals,
    uniqueEvaluatorsCount,
    responseRate,
    totalCerts: certsSent,
    certRate
  };
};

// Thai sentiment dictionaries
const POSITIVE_KEYWORDS = [
  "ดีมาก", "ยอดเยี่ยม", "ดีเยี่ยม", "ประทับใจ", "ชอบมาก", "เข้าใจง่าย", "ได้ประโยชน์", "ประโยชน์มาก",
  "วิทยากรเก่ง", "ชัดเจน", "สนุก", "คุ้มค่า", "นำไปใช้ได้", "ใช้ได้จริง", "ขอบคุณ", "แนะนำดี", "อบอุ่น",
  "เป็นกันเอง", "น่าสนใจ", "เหมาะสม", "ตอบคำถามดี", "เตรียมตัวดี", "ดี", "เยี่ยม", "สุดยอด", "สมบูรณ์"
];

const SUGGESTION_NEUTRAL_KEYWORDS = [
  "อยากให้", "เสนอแนะ", "เพิ่มเติม", "อยากเรียน", "ขอเสนอ", "ควรมี", "อยากได้", "ครั้งต่อไป",
  "ขยายเวลา", "เพิ่มเวลา", "คอร์สต่อเนื่อง", "advance", "ต่อยอด", "ขั้นสูง", "จัดอีก", "ติดตามผล",
  "workshop เพิ่ม", "ตัวอย่างเพิ่ม", "เอกสารประกอบ", "สไลด์", "คู่มือ", "แชร์ไฟล์"
];

const IMPROVEMENT_NEGATIVE_KEYWORDS = [
  "เร็วไป", "เร็วเกินไป", "ช้าไป", "ไม่ทัน", "ยากไป", "เสียงเบา", "แอร์เย็น", "หนาว", "ติดขัด",
  "กระชั้นชิด", "เวลาน้อย", "ไม่พอ", "ปรับปรุง", "แก้ไข", "ปัญหา", "ไม่ชัดเจน", "สับสน",
  "อินเทอร์เน็ตหลุด", "wifi", "จอเล็ก", "มองไม่เห็น", "ไม่ค่อยเข้าใจ"
];

const THEME_DEFINITIONS = [
  {
    theme: "วิทยากรและการถ่ายทอด",
    keywords: ["วิทยากร", "อาจารย์", "ผู้สอน", "ถ่ายทอด", "อธิบาย", "ความรู้", "สอน", "คำถาม", "ตอบ"]
  },
  {
    theme: "เนื้อหาและการนำไปใช้จริง",
    keywords: ["เนื้อหา", "ความรู้", "ประยุกต์", "ใช้งาน", "เครื่องมือ", "ai", "prompt", "นำไปใช้", "ประโยชน์", "หัวข้อ"]
  },
  {
    theme: "ระยะเวลาและกำหนดการ",
    keywords: ["เวลา", "ชั่วโมง", "นาที", "เร็ว", "ช้า", "กระชั้น", "ไม่ทัน", "ขยายเวลา", "ช่วงเช้า", "ช่วงบ่าย"]
  },
  {
    theme: "กิจกรรมและ Workshop",
    keywords: ["workshop", "ปฏิบัติ", "กิจกรรม", "ฝึกปฏิบัติ", "ตัวอย่าง", "ทำจริง", "แบบฝึกหัด", "ขั้นตอน"]
  },
  {
    theme: "เอกสารและสื่อการสอน",
    keywords: ["สไลด์", "เอกสาร", "ไฟล์", "คู่มือ", "link", "สรุป", "ดาวน์โหลด", "slide", "code"]
  },
  {
    theme: "สถานที่และสิ่งอำนวยความสะดวก",
    keywords: ["ห้อง", "แอร์", "เสียง", "ไมค์", "จอ", "ระบบ", "เน็ต", "wifi", "อาหาร", "เบรค", "สถานที่", "ออนไลน์", "zoom"]
  }
];

export const classifyThaiComment = (text: string): { sentiment: CommentSentiment; score: number; label: string; themes: string[] } => {
  const normalized = text.toLowerCase();
  
  let posScore = 0;
  let sugScore = 0;
  let negScore = 0;

  POSITIVE_KEYWORDS.forEach(kw => {
    if (normalized.includes(kw)) posScore += 2;
  });

  SUGGESTION_NEUTRAL_KEYWORDS.forEach(kw => {
    if (normalized.includes(kw)) sugScore += 2;
  });

  IMPROVEMENT_NEGATIVE_KEYWORDS.forEach(kw => {
    if (normalized.includes(kw)) negScore += 2;
  });

  const matchedThemes: string[] = [];
  THEME_DEFINITIONS.forEach(def => {
    const hasMatch = def.keywords.some(k => normalized.includes(k));
    if (hasMatch) {
      matchedThemes.push(def.theme);
    }
  });

  let sentiment: CommentSentiment = 'neutral';
  let label = 'ข้อเสนอแนะ / ปานกลาง';
  let score = 0;

  if (negScore > posScore && negScore > sugScore) {
    sentiment = 'negative';
    label = 'ข้อควรปรับปรุง';
    score = -negScore;
  } else if (posScore >= sugScore && posScore > 0) {
    sentiment = 'positive';
    label = 'เชิงบวก / ชื่นชม';
    score = posScore;
  } else if (sugScore > 0) {
    sentiment = 'neutral';
    label = 'ข้อเสนอแนะพัฒนา';
    score = 1;
  } else {
    sentiment = 'positive';
    label = 'เชิงบวกทั่วไป';
    score = 1;
  }

  return { sentiment, score, label, themes: matchedThemes };
};

// Master shared evaluation analysis calculation
export const analyzeEvaluations = (
  evaluations: any[],
  questionsList: string[] = DEFAULT_QUESTIONS,
  courseTitle: string = "หลักสูตร"
): EvaluationAnalysisResult => {
  const totalResponses = evaluations.length;
  const questions = questionsList.length > 0 ? questionsList : DEFAULT_QUESTIONS;
  const qCount = questions.length;

  if (totalResponses === 0) {
    return {
      totalResponses: 0,
      overallAverage: 0,
      overallLevel: getScoreLevelInfo(0),
      pct5Overall: 0,
      pct45Overall: 0,
      distribution: [5, 4, 3, 2, 1].map(s => ({ score: s, count: 0, percentage: 0 })),
      questionStats: [],
      highestQuestion: null,
      lowestQuestion: null,
      dimensions: [],
      executiveSummaryText: "ยังไม่มีข้อมูลการประเมินสำหรับหลักสูตรนี้",
      comments: [],
      commentStats: {
        totalComments: 0,
        positiveCount: 0,
        neutralCount: 0,
        negativeCount: 0,
        positivePct: 0,
        neutralPct: 0,
        negativePct: 0
      },
      recurringThemes: [],
      actionableRecommendations: { strengths: [], improvements: [], futureTopics: [] }
    };
  }

  // 1. Calculate Per-Question Statistics
  const questionStats = calculateQuestionStatistics(evaluations, questions);

  // 2. Calculate Overall Rating Distribution
  const { distribution, totalValidRatings } = calculateRatingDistribution(evaluations, qCount);

  // 3. Calculate Overall Average
  let totalRatingSum = 0;
  let score5Count = 0;
  let score45Count = 0;

  evaluations.forEach(ev => {
    for (let i = 0; i < qCount; i++) {
      const score = getValidRatingScore(ev.ratings, i);
      if (score !== null && score >= 1 && score <= 5) {
        totalRatingSum += score;
        if (score === 5) score5Count++;
        if (score >= 4) score45Count++;
      }
    }
  });

  const overallAverage = totalValidRatings > 0 ? Number((totalRatingSum / totalValidRatings).toFixed(2)) : 0;
  const overallLevel = getScoreLevelInfo(overallAverage);
  const pct5Overall = totalValidRatings > 0 ? Number(((score5Count / totalValidRatings) * 100).toFixed(1)) : 0;
  const pct45Overall = totalValidRatings > 0 ? Number(((score45Count / totalValidRatings) * 100).toFixed(1)) : 0;

  // Highest and lowest rated questions (with valid responses)
  const validQuestionStats = questionStats.filter(q => q.count > 0);
  const sortedByAvg = [...validQuestionStats].sort((a, b) => b.average - a.average);
  const highestQuestion = sortedByAvg[0] || null;
  const lowestQuestion = sortedByAvg[sortedByAvg.length - 1] || null;

  // 4. Categorize dimensions
  const dimensions: DimensionStat[] = [];
  if (qCount >= 8) {
    const contentIndices = [0, 1, 2, 3].filter(i => i < qCount);
    const instructorIndices = [4, 5, 6, 7].filter(i => i < qCount);
    const overallIndices = [8, 9].filter(i => i < qCount);

    const calcDim = (title: string, desc: string, indices: number[]): DimensionStat => {
      const stats = indices.map(i => questionStats[i]).filter(Boolean);
      const avg = stats.length > 0 ? Number((stats.reduce((acc, s) => acc + s.average, 0) / stats.length).toFixed(2)) : 0;
      const pct45 = stats.length > 0 ? Number((stats.reduce((acc, s) => acc + s.pct45, 0) / stats.length).toFixed(1)) : 0;
      return { title, description: desc, questionIndices: indices, average: avg, pct45 };
    };

    dimensions.push(calcDim("เนื้อหาและหลักสูตร", "ความน่าสนใจ ความครบถ้วน และการประยุกต์ใช้จริง", contentIndices));
    dimensions.push(calcDim("วิทยากรและการถ่ายทอด", "ความเชี่ยวชาญ เทคนิคการสอน และการมีส่วนร่วม", instructorIndices));
    dimensions.push(calcDim("ระยะเวลาและความพึงพอใจภาพรวม", "ความเหมาะสมของเวลาและความพึงพอใจสุทธิ", overallIndices));
  } else {
    dimensions.push({
      title: "การประเมินภาพรวม",
      description: "ผลคะแนนเฉลี่ยจากหัวข้อประเมินทั้งหมด",
      questionIndices: questionStats.map(q => q.index),
      average: overallAverage,
      pct45: pct45Overall
    });
  }

  // 5. Comments analysis
  const rawComments = evaluations
    .filter(e => e.suggestion && typeof e.suggestion === 'string' && e.suggestion.trim().length > 0)
    .map((e, idx) => {
      const text = e.suggestion.trim();
      const { sentiment, score, label, themes } = classifyThaiComment(text);
      return {
        id: e.id || `c-${idx + 1}`,
        index: idx + 1,
        text,
        sentiment,
        sentimentLabel: label,
        sentimentScore: score,
        matchedThemes: themes,
        createdAt: e.createdAt || ''
      };
    });

  const positiveComments = rawComments.filter(c => c.sentiment === 'positive');
  const neutralComments = rawComments.filter(c => c.sentiment === 'neutral');
  const negativeComments = rawComments.filter(c => c.sentiment === 'negative');

  const totalComments = rawComments.length;
  const commentStats = {
    totalComments,
    positiveCount: positiveComments.length,
    neutralCount: neutralComments.length,
    negativeCount: negativeComments.length,
    positivePct: totalComments > 0 ? Number(((positiveComments.length / totalComments) * 100).toFixed(1)) : 0,
    neutralPct: totalComments > 0 ? Number(((neutralComments.length / totalComments) * 100).toFixed(1)) : 0,
    negativePct: totalComments > 0 ? Number(((negativeComments.length / totalComments) * 100).toFixed(1)) : 0
  };

  const themeCounts: { [theme: string]: number } = {};
  rawComments.forEach(c => {
    c.matchedThemes.forEach(t => {
      themeCounts[t] = (themeCounts[t] || 0) + 1;
    });
  });

  const recurringThemes = Object.entries(themeCounts)
    .map(([theme, count]) => {
      const def = THEME_DEFINITIONS.find(d => d.theme === theme);
      return { theme, count, keywords: def ? def.keywords.slice(0, 4) : [] };
    })
    .sort((a, b) => b.count - a.count);

  // 6. Executive interpretation narrative
  const executiveSummaryText = generateExecutiveInterpretation(
    overallAverage,
    pct45Overall,
    highestQuestion,
    lowestQuestion,
    distribution,
    totalResponses,
    courseTitle
  );

  // 7. Actionable recommendations synthesis
  const strengths: string[] = [];
  if (highestQuestion) {
    strengths.push(`จุดเด่นสำคัญ: ผู้เข้าอบรมพึงพอใจอย่างยิ่งในหัวข้อ "${highestQuestion.question}" (เฉลี่ย ${highestQuestion.average.toFixed(2)}) ซึ่งสะท้อนถึงการเตรียมตัวและมาตรฐานการสอนที่มีคุณภาพ`);
  }
  if (pct45Overall >= 85) {
    strengths.push(`ความพึงพอใจระดับสูงมาก: ผู้เข้าร่วมกว่า ${pct45Overall}% ให้คะแนน 4-5 ดาว แสดงถึงความคุ้มค่าและตรงตามความคาดหวัง`);
  }
  if (positiveComments.length > 0) {
    strengths.push(`ข้อคิดเห็นเชิงบวก: ผู้เข้าร่วมระบุว่าสามารถนำองค์ความรู้ไปต่อยอดในการทำงานได้จริงและชื่นชอบบรรยากาศการเรียนรู้`);
  }

  const improvements: string[] = [];
  if (lowestQuestion && lowestQuestion.average < 4.5) {
    improvements.push(`ทบทวนและปรับปรุงหัวข้อ "${lowestQuestion.question}" (คะแนนเฉลี่ย ${lowestQuestion.average.toFixed(2)}) เพื่อเพิ่มประสิทธิภาพในรุ่นถัดไป`);
  }
  if (negativeComments.length > 0 || neutralComments.some(c => c.text.includes("เวลา") || c.text.includes("เร็ว"))) {
    improvements.push(`บริหารจัดการเวลาในการอบรม: ควรเพิ่มช่วงฝึกปฏิบัติ (Hands-on Workshop) และปรับความเร็วในการนำเสนอให้สอดคล้องกับพื้นฐานผู้เข้าอบรม`);
  } else {
    improvements.push(`รักษามาตรฐานการจัดสรรเวลาและเปิดโอกาสให้ผู้เข้าอบรมได้ถาม-ตอบเพิ่มเติมอย่างสม่ำเสมอ`);
  }

  const futureTopics: string[] = [];
  futureTopics.push(`จัดหลักสูตรขั้นสูง (Advanced Course) หรือ Workshop เชิงลึกเพื่อตอบสนองความต้องการต่อยอดของผู้เข้าอบรม`);
  futureTopics.push(`จัดทำเอกสารคู่มือ สรุปประเด็นสำคัญ หรือบันทึกวิดีโอย้อนหลังเพื่อเป็นทรัพยากรการเรียนรู้ต่อเนื่อง`);

  return {
    totalResponses,
    overallAverage,
    overallLevel,
    pct5Overall,
    pct45Overall,
    distribution,
    questionStats,
    highestQuestion,
    lowestQuestion,
    dimensions,
    executiveSummaryText,
    comments: rawComments,
    commentStats,
    recurringThemes,
    actionableRecommendations: { strengths, improvements, futureTopics }
  };
};
