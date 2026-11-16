# Google AI Studio — Bilingual Evaluation Module

These are complete replacement files from the modified project. Preserve other files.

## `src/lib/evaluationI18n.ts`

```tsx
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
    loginTitle: "กรุณาเข้าสู่ระบบ", loginBody: "ท่านจำเป็นต้องเข้าสู่ระบบด้วยอีเมล @bu.ac.th เพื่อทำแบบประเมินความพึงพอใจของหลักสูตรนี้",
    loginButton: "เข้าสู่ระบบเพื่อทำแบบประเมิน", thanks: "ขอบคุณสำหรับการประเมิน",
    already: "คุณได้ทำแบบประเมินสำหรับหลักสูตรนี้เรียบร้อยแล้ว ข้อมูลของคุณจะเป็นประโยชน์อย่างยิ่งในการพัฒนาต่อไป",
    home: "กลับสู่หน้าหลัก", back: "ย้อนกลับ", title: "แบบประเมินความพึงพอใจ", course: "หลักสูตร:", topic: "หัวข้อประเมิน",
    scale: ["มากสุด", "มาก", "ปานกลาง", "น้อย", "น้อยสุด"], suggestion: "ข้อเสนอแนะเพิ่มเติม",
    suggestionPlaceholder: "กรุณากรอกข้อเสนอแนะเพื่อการพัฒนาหลักสูตร...", submit: "ส่งแบบประเมินผล",
    incomplete: "กรุณาให้คะแนนให้ครบทุกข้อ", success: "ส่งแบบประเมินเรียบร้อยแล้ว ขอบคุณครับ!", submitError: "เกิดข้อผิดพลาดในการส่งข้อมูล"
  },
  en: {
    loading: "Loading course...", missingCourse: "Course not found", loadError: "Unable to load the evaluation",
    loginTitle: "Sign in required", loginBody: "Please sign in with your @bu.ac.th email address to complete this course evaluation.",
    loginButton: "Sign in to evaluate", thanks: "Thank you for your feedback",
    already: "You have already completed the evaluation for this course. Your feedback helps improve future training.",
    home: "Back to home", back: "Back", title: "Course Satisfaction Evaluation", course: "Course:", topic: "Evaluation criteria",
    scale: ["Highest", "High", "Moderate", "Low", "Lowest"], suggestion: "Additional suggestions",
    suggestionPlaceholder: "Share any suggestions for improving this course...", submit: "Submit evaluation",
    incomplete: "Please rate every question", success: "Your evaluation has been submitted. Thank you!", submitError: "Unable to submit your evaluation"
  }
} as const;

```

## `src/components/EvaluationSettings.tsx`

```tsx
import React, { useState, useEffect } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Loader2, Save, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { DEFAULT_QUESTIONS_TH, DEFAULT_QUESTIONS_EN, EVALUATION_COUNT, getEvaluationQuestions, validQuestions } from "../lib/evaluationI18n";

export const EvaluationSettings: React.FC = () => {
  const [questionsTh, setQuestionsTh] = useState<string[]>(DEFAULT_QUESTIONS_TH);
  const [questionsEn, setQuestionsEn] = useState<string[]>(DEFAULT_QUESTIONS_EN);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snapshot = await getDoc(doc(db, "settings", "evaluation"));
        const data = snapshot.exists() ? snapshot.data() : undefined;
        if (data?.questions && !validQuestions(data.questions)) {
          toast.error("พบชุดคำถามเดิมที่มีจำนวนไม่เท่ากับ 10 ข้อ กรุณาตรวจสอบก่อนแก้ไข");
        }
        setQuestionsTh(getEvaluationQuestions(data, "th"));
        setQuestionsEn(getEvaluationQuestions(data, "en"));
      } catch (error) {
        console.error("Error fetching evaluation settings:", error);
        toast.error("ไม่สามารถโหลดข้อมูลตั้งค่าได้");
      } finally { setLoading(false); }
    };
    fetchSettings();
  }, []);
  const edit = (index: number, value: string, lang: "th" | "en") => {
    const setter = lang === "th" ? setQuestionsTh : setQuestionsEn;
    setter(prev => prev.map((v, i) => i === index ? value : v));
    setHasChanges(true);
  };
  const save = async () => {
    if (!validQuestions(questionsTh) || !validQuestions(questionsEn)) {
      toast.error("กรุณากรอกคำถามทั้ง 10 ข้อให้ครบทั้งสองภาษา"); return;
    }
    setSaving(true);
    try {
      // Merge preserves other settings fields, while keeping legacy `questions` for existing dashboards.
      await setDoc(doc(db, "settings", "evaluation"), {
        questions: questionsTh.map(q => q.trim()),
        questionsEn: questionsEn.map(q => q.trim()),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setHasChanges(false);
      toast.success("บันทึกคำถามทั้งสองภาษาเรียบร้อยแล้ว");
    } catch (error) {
      console.error("Error saving evaluation settings:", error);
      toast.error("ไม่สามารถบันทึกข้อมูลได้");
    } finally { setSaving(false); }
  };
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 text-crimson animate-spin" /></div>;
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-3 items-center justify-between">
      <div>
        <h3 className="text-lg font-bold text-slate-800">จัดการคำถามประเมิน (ไทย / English)</h3>
        <p className="text-sm text-slate-500">คำถาม 10 ข้อจับคู่ตามลำดับเดียวกัน เพื่อรักษาความถูกต้องของรายงานคะแนนเดิม</p>
      </div>
      <button type="button" onClick={save} disabled={saving || !hasChanges}
        className="flex gap-2 items-center px-5 py-2 rounded-xl bg-crimson text-white font-bold disabled:opacity-50">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} บันทึกทั้งสองภาษา
      </button>
    </div>
    <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm">
      <AlertCircle className="w-5 h-5 shrink-0" /> ห้ามเพิ่ม ลบ หรือสลับลำดับคำถาม เนื่องจากรายงานเดิมใช้ตำแหน่งคะแนน 0–9
    </div>
    {hasChanges && <div className="text-amber-800 text-sm">มีการแก้ไขที่ยังไม่ได้บันทึก</div>}
    <div className="space-y-3">
      {Array.from({ length: EVALUATION_COUNT }, (_, i) => <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="font-bold text-slate-600 text-sm">ข้อ {i+1} / Question {i+1}</div>
        <label className="block text-sm text-slate-700">ภาษาไทย
          <input aria-label={`คำถามภาษาไทยข้อ ${i+1}`} className="block w-full border border-slate-200 rounded-lg p-3 mt-1" value={questionsTh[i]} onChange={e => edit(i,e.target.value,"th")} />
        </label>
        <label className="block text-sm text-slate-700">English
          <input aria-label={`English question ${i+1}`} className="block w-full border border-slate-200 rounded-lg p-3 mt-1" value={questionsEn[i]} onChange={e => edit(i,e.target.value,"en")} />
        </label>
      </div>)}
    </div>
  </div>;
};

```

## `src/pages/EvaluatePage.tsx`

```tsx
import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Navigate, useLocation } from "react-router-dom";
import { doc, getDoc, collection, addDoc, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import { Course } from "../types";
import { resolveCourseLang } from "../contexts/LanguageContext";
import { DEFAULT_QUESTIONS_TH, getEvaluationQuestions, evaluationUi } from "../lib/evaluationI18n";
import { Loader2, ArrowLeft, Send, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import { motion } from "motion/react";

export const EvaluatePage: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading, login } = useAuth();
  
  // Use URL query parameter as initial title if available
  const queryParams = new URLSearchParams(location.search);
  const titleFromUrl = queryParams.get("title");
  
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hasEvaluated, setHasEvaluated] = useState(false);
  const [questions, setQuestions] = useState<string[]>(DEFAULT_QUESTIONS_TH);
  
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [suggestion, setSuggestion] = useState("");

  const evaluationLang = resolveCourseLang(course);
  const ui = evaluationUi[evaluationLang];
  const displayTitle = course?.title || titleFromUrl || ui.loading;

  useEffect(() => {
    const checkStatus = async () => {
      try {
        if (!courseId) return;

        // Fetch course
        const courseDoc = await getDoc(doc(db, "courses", courseId));
        if (courseDoc.exists()) {
          const loadedCourse = { id: courseDoc.id, ...courseDoc.data() } as Course;
          setCourse(loadedCourse);
          const settingsDoc = await getDoc(doc(db, "settings", "evaluation"));
          setQuestions(getEvaluationQuestions(settingsDoc.exists() ? settingsDoc.data() : undefined, resolveCourseLang(loadedCourse)));
        } else {
          toast.error(ui.missingCourse);
          navigate("/");
          return;
        }

        if (!user) return;

        // Check if already evaluated
        const existingEvalQ = query(
          collection(db, "evaluations"),
          where("courseId", "==", courseId),
          where("userId", "==", user.uid)
        );
        const evalSnap = await getDocs(existingEvalQ);
        if (!evalSnap.empty) {
          setHasEvaluated(true);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error(ui.loadError);
      } finally {
        setLoading(false);
      }
    };
    
    checkStatus();
  }, [courseId, user, authLoading, navigate]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 text-crimson animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white max-w-md w-full rounded-3xl p-8 shadow-xl border border-slate-100 text-center"
        >
          <div className="w-20 h-20 bg-crimson/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-10 h-10 text-crimson" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">{ui.loginTitle}</h2>
          <p className="text-slate-500 mb-8 leading-relaxed">
            {ui.loginBody}
          </p>
          <button 
            onClick={login}
            className="w-full bg-crimson hover:bg-crimson-dark text-white font-bold py-4 rounded-xl shadow-lg shadow-crimson/20 transition-all flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
            {ui.loginButton}
          </button>
        </motion.div>
      </div>
    );
  }

  if (hasEvaluated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white max-w-md w-full rounded-3xl p-8 shadow-xl border border-slate-100 text-center"
        >
          <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">{ui.thanks}</h2>
          <p className="text-slate-500 mb-8 leading-relaxed">{ui.already}</p>
          <button 
            onClick={() => navigate("/")}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-3 rounded-xl transition-colors"
          >
            {ui.home}
          </button>
        </motion.div>
      </div>
    );
  }

  const handleRatingChange = (qIndex: number, value: number) => {
    setRatings(prev => ({ ...prev, [qIndex]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !courseId) return;

    // Validate
    if (Object.keys(ratings).length < questions.length) {
      toast.error(ui.incomplete);
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, "evaluations"), {
        courseId,
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName || "Unknown",
        ratings,
        suggestion,
        createdAt: new Date().toISOString()
      });
      toast.success(ui.success);
      setHasEvaluated(true);
    } catch (error) {
      console.error("Error submitting evaluation:", error);
      toast.error(ui.submitError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 md:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <button 
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-slate-500 hover:text-crimson transition-colors font-medium text-sm w-fit"
        >
          <ArrowLeft className="w-4 h-4" /> {ui.back}
        </button>

        <div>
          <h1 className="text-3xl font-bold text-slate-800 mb-2">{ui.title}</h1>
          <p className="text-slate-500">{ui.course} <span className="font-semibold text-crimson">{displayTitle}</span></p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b border-slate-100 bg-slate-50/50 text-xs font-bold text-slate-500 uppercase tracking-widest text-center items-center">
              <div className="col-span-7 text-left pl-2">{ui.topic}</div>
              <div className="col-span-1">5<br/><span className="text-[10px] font-normal leading-tight text-slate-400">{ui.scale[0]}</span></div>
              <div className="col-span-1">4<br/><span className="text-[10px] font-normal leading-tight text-slate-400">{ui.scale[1]}</span></div>
              <div className="col-span-1">3<br/><span className="text-[10px] font-normal leading-tight text-slate-400">{ui.scale[2]}</span></div>
              <div className="col-span-1">2<br/><span className="text-[10px] font-normal leading-tight text-slate-400">{ui.scale[3]}</span></div>
              <div className="col-span-1">1<br/><span className="text-[10px] font-normal leading-tight text-slate-400">{ui.scale[4]}</span></div>
            </div>
            
            <div className="divide-y divide-slate-100">
              {questions.map((q, i) => (
                <div key={i} className="p-4 md:p-0 md:grid md:grid-cols-12 gap-4 items-center hover:bg-slate-50 transition-colors">
                  <div className="col-span-7 md:p-4 text-sm font-medium text-slate-700 leading-relaxed mb-4 md:mb-0">
                    <span className="text-crimson mr-2">{i + 1}.</span> {q}
                  </div>
                  
                  {/* Mobile labels, desktop uses grid headers */}
                  <div className="col-span-5 grid grid-cols-5 gap-1 md:gap-0 justify-items-center md:pb-0">
                    {[5, 4, 3, 2, 1].map((val) => (
                      <label key={val} className="flex flex-col items-center justify-center p-2 cursor-pointer group relative w-full h-full">
                        <div className="md:hidden text-[10px] text-slate-400 mb-1">{val}</div>
                        <div className={`relative flex items-center justify-center w-6 h-6 rounded-full border transition-all
                          ${ratings[i] === val ? "border-crimson text-crimson" : "border-slate-300 text-transparent group-hover:border-crimson/50"}
                        `}>
                          <input 
                            type="radio" 
                            name={`q${i}`} 
                            value={val} 
                            checked={ratings[i] === val}
                            onChange={() => handleRatingChange(i, val)}
                            className="absolute opacity-0 cursor-pointer pointer-events-none"
                            required
                          />
                          <div className={`w-3 h-3 rounded-full bg-crimson transition-transform duration-200 ${ratings[i] === val ? "scale-100" : "scale-0"}`} />
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
            <label className="block text-sm font-bold text-slate-700 mb-3">{questions.length + 1}. {ui.suggestion}</label>
            <textarea 
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              placeholder={ui.suggestionPlaceholder}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-normal text-slate-700 min-h-[120px] focus:ring-2 focus:ring-crimson/20 focus:border-crimson outline-none resize-y transition-all"
            />
          </div>

          <div className="flex justify-end">
            <button 
              type="submit" 
              disabled={submitting}
              className="bg-crimson hover:bg-crimson-dark text-white px-10 py-4 rounded-xl font-bold shadow-lg shadow-crimson/20 flex items-center justify-center gap-2 disabled:opacity-50 transition-all text-sm tracking-wide"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              {ui.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

```

