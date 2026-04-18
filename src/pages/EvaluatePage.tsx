import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { doc, getDoc, collection, addDoc, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import { Course } from "../types";
import { Loader2, ArrowLeft, Send, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import { motion } from "motion/react";

const QUESTIONS = [
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

export const EvaluatePage: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hasEvaluated, setHasEvaluated] = useState(false);
  
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [suggestion, setSuggestion] = useState("");

  useEffect(() => {
    const checkStatus = async () => {
      if (!courseId || !user) return;
      try {
        // Fetch course
        const courseDoc = await getDoc(doc(db, "courses", courseId));
        if (courseDoc.exists()) {
          setCourse({ id: courseDoc.id, ...courseDoc.data() } as Course);
        } else {
          toast.error("ไม่พบข้อมูลหลักสูตร");
          navigate("/");
          return;
        }

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
        toast.error("ข้อผิดพลาดในการโหลดข้อมูล");
      } finally {
        setLoading(false);
      }
    };
    
    if (!authLoading && user) {
      checkStatus();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [courseId, user, authLoading, navigate]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 text-crimson animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" />;
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
          <h2 className="text-2xl font-bold text-slate-800 mb-2">ขอบคุณสำหรับการประเมิน</h2>
          <p className="text-slate-500 mb-8 leading-relaxed">คุณได้ทำแบบประเมินสำหรับหลักสูตรนี้เรียบร้อยแล้ว ข้อมูลของคุณจะเป็นประโยชน์อย่างยิ่งในการพัฒนาต่อไป</p>
          <button 
            onClick={() => navigate("/")}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-3 rounded-xl transition-colors"
          >
            กลับสู่หน้าหลัก
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
    if (Object.keys(ratings).length < QUESTIONS.length) {
      toast.error("กรุณาให้คะแนนให้ครบทุกข้อ");
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
      toast.success("ส่งแบบประเมินเรียบร้อยแล้ว ขอบคุณครับ!");
      setHasEvaluated(true);
    } catch (error) {
      console.error("Error submitting evaluation:", error);
      toast.error("เกิดข้อผิดพลาดในการส่งข้อมูล");
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
          <ArrowLeft className="w-4 h-4" /> ย้อนกลับ
        </button>

        <div>
          <h1 className="text-3xl font-bold text-slate-800 mb-2">แบบประเมินความพึงพอใจ</h1>
          <p className="text-slate-500">หลักสูตร: <span className="font-semibold text-crimson">{course?.title}</span></p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b border-slate-100 bg-slate-50/50 text-xs font-bold text-slate-500 uppercase tracking-widest text-center items-center">
              <div className="col-span-7 text-left pl-2">หัวข้อประเมิน</div>
              <div className="col-span-1">5<br/><span className="text-[10px] font-normal leading-tight text-slate-400">มากสุด</span></div>
              <div className="col-span-1">4<br/><span className="text-[10px] font-normal leading-tight text-slate-400">มาก</span></div>
              <div className="col-span-1">3<br/><span className="text-[10px] font-normal leading-tight text-slate-400">ปานกลาง</span></div>
              <div className="col-span-1">2<br/><span className="text-[10px] font-normal leading-tight text-slate-400">น้อย</span></div>
              <div className="col-span-1">1<br/><span className="text-[10px] font-normal leading-tight text-slate-400">น้อยสุด</span></div>
            </div>
            
            <div className="divide-y divide-slate-100">
              {QUESTIONS.map((q, i) => (
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
            <label className="block text-sm font-bold text-slate-700 mb-3">11. ข้อเสนอแนะเพิ่มเติม</label>
            <textarea 
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              placeholder="กรุณากรอกข้อเสนอแนะเพื่อการพัฒนาหลักสูตร..."
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
              ส่งแบบประเมินผล
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
