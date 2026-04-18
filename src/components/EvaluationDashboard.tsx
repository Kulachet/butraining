import React, { useState, useEffect } from "react";
import { collection, query, where, getDocs, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Course } from "../types";
import { BarChart3, ChevronDown, Download, Users, FileText } from "lucide-react";
import Papa from "papaparse";
import toast from "react-hot-toast";

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

export const EvaluationDashboard: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Fetch courses
    const q = query(collection(db, "courses"), orderBy("date", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCourses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Course[]);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedCourseId) {
      setEvaluations([]);
      return;
    }

    const fetchEvals = async () => {
      setLoading(true);
      try {
        const evalsQ = query(collection(db, "evaluations"), where("courseId", "==", selectedCourseId));
        const snap = await getDocs(evalsQ);
        const data = snap.docs.map(doc => doc.data());
        setEvaluations(data);
      } catch (error) {
        console.error("Error fetching evaluations:", error);
        toast.error("ข้อผิดพลาดในการโหลดผลการประเมิน");
      } finally {
        setLoading(false);
      }
    };
    fetchEvals();
  }, [selectedCourseId]);

  const handleExportCSV = () => {
    if (evaluations.length === 0) {
      toast.error("ไม่มีข้อมูลสำหรับดาวน์โหลด");
      return;
    }
    const selectedCourse = courses.find(c => c.id === selectedCourseId);
    
    const data = evaluations.map((evalData, index) => {
      let row: any = {
        "ลำดับ": index + 1,
        "ชื่อ-นามสกุล": evalData.userName,
        "อีเมล": evalData.userEmail,
        "เวลาประเมิน": new Date(evalData.createdAt).toLocaleString('th-TH')
      };
      for (let i = 0; i < 10; i++) {
        row[`ข้อที่ ${i+1}`] = evalData.ratings?.[i] || "-";
      }
      row["ข้อเสนอแนะ"] = evalData.suggestion || "-";
      return row;
    });

    const csv = Papa.unparse(data);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `ผลประเมิน_${selectedCourse?.title || 'หลักสูตร'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success("ดาวน์โหลดผลประเมินเรียบร้อยแล้ว");
  };

  // Calculate averages
  const getAverage = (qIndex: number) => {
    if (evaluations.length === 0) return 0;
    const sum = evaluations.reduce((acc, curr) => acc + (curr.ratings?.[qIndex] || 0), 0);
    return (sum / evaluations.length).toFixed(2);
  };
  
  const overallAverage = evaluations.length > 0 
    ? (evaluations.reduce((acc, curr) => {
        const userAvg = QUESTIONS.reduce((s, _, i) => s + (curr.ratings?.[i] || 0), 0) / QUESTIONS.length;
        return acc + userAvg;
      }, 0) / evaluations.length).toFixed(2)
    : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-[28px] lg:text-[32px] font-bold text-[#333333] tracking-[0.02em] leading-[1.6]">
            ผลการประเมิน
          </h1>
          <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px] max-w-sm leading-[1.7]">
            เลือกหลักสูตรที่ต้องการดูสรุปผลประเมิน หรือดาวน์โหลดข้อมูลเบื้องตัน
          </p>
        </div>
        
        {evaluations.length > 0 && (
          <button 
            onClick={handleExportCSV}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-crimson hover:bg-crimson-dark text-white rounded-xl text-[14px] font-medium transition-all shadow-md shadow-crimson/20"
          >
            <Download className="w-4 h-4" />
            ดาวน์โหลดผลประเมินทั้งหมด
          </button>
        )}
      </div>

      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
        <label className="block text-sm font-semibold text-slate-700 mb-3">เลือกหลักสูตรที่ต้องการดูผล:</label>
        <div className="relative border border-slate-200 rounded-xl overflow-hidden hover:border-crimson focus-within:ring-2 focus-within:ring-crimson/20 transition-all bg-slate-50">
          <select 
            value={selectedCourseId}
            onChange={e => setSelectedCourseId(e.target.value)}
            className="w-full appearance-none px-4 py-3.5 bg-transparent outline-none cursor-pointer text-sm font-medium text-slate-700"
          >
            <option value="">-- กรุณาเลือกหลักสูตร --</option>
            {courses.map(course => (
              <option key={course.id} value={course.id}>
                {course.title} {course.date ? `(${course.date})` : ''}
              </option>
            ))}
          </select>
          <div className="absolute top-0 right-0 h-full flex items-center pr-4 pointer-events-none text-slate-400">
            <ChevronDown className="w-5 h-5" />
          </div>
        </div>
      </div>

      {!selectedCourseId ? (
        <div className="bg-white py-24 rounded-3xl border border-dashed border-slate-200 text-center">
          <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-6 transform rotate-3">
            <BarChart3 className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-slate-700 mb-2">เลือกหลักสูตรเพื่อดูผลประเมิน</h3>
          <p className="text-slate-400 font-light">ข้อมูลประเมินจะแสดงขึ้นหลังจากที่คุณเลือกหลักสูตรด้านบน</p>
        </div>
      ) : loading ? (
        <div className="bg-white py-24 rounded-3xl border border-slate-200 flex flex-col justify-center items-center">
          <div className="w-10 h-10 border-4 border-crimson/20 border-t-crimson rounded-full animate-spin mb-4" />
          <p className="text-slate-500">กำลังดึงข้อมูล...</p>
        </div>
      ) : evaluations.length === 0 ? (
        <div className="bg-white py-24 rounded-3xl border border-dashed border-slate-200 text-center">
          <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <FileText className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-slate-700 mb-2">ยังไม่มีผลการประเมิน</h3>
          <p className="text-slate-400 font-light">หลักสูตรนี้ยังไม่มีผู้ส่งแบบประเมินผล</p>
        </div>
      ) : (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">ผู้ประเมินทั้งหมด</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-slate-800">{evaluations.length}</span>
                  <span className="text-slate-400 font-medium text-sm">คน</span>
                </div>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
                <BarChart3 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">คะแนนเฉลี่ยรวม</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-slate-800">{overallAverage}</span>
                  <span className="text-slate-400 font-medium text-sm">จาก 5.00</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-lg font-bold text-slate-800">สรุปคะแนนแต่ละหัวข้อประเมิน</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {QUESTIONS.map((q, i) => {
                const avg = Number(getAverage(i));
                return (
                  <div key={i} className="p-4 md:p-6 flex flex-col md:flex-row md:items-center gap-4 hover:bg-slate-50 transition-colors">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-700"><span className="text-crimson mr-2">{i + 1}.</span>{q}</p>
                    </div>
                    <div className="flex items-center gap-4 md:w-64">
                      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${avg >= 4.5 ? 'bg-emerald-500' : avg >= 3.5 ? 'bg-blue-500' : avg >= 2.5 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${(avg / 5) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold w-12 text-right text-slate-700">{avg.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
              <FileText className="w-5 h-5 text-slate-500" />
              <h3 className="text-lg font-bold text-slate-800">ข้อเสนอแนะเพิ่มเติมจากผู้ประเมิน</h3>
            </div>
            <div className="p-6 gap-4 grid grid-cols-1">
              {evaluations.filter(e => e.suggestion && e.suggestion.trim() !== "").length > 0 ? (
                evaluations.filter(e => e.suggestion && e.suggestion.trim() !== "").map((e, idx) => (
                  <div key={idx} className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">{e.suggestion}</p>
                    <div className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-200">
                      จาก: {e.userName} ({new Date(e.createdAt).toLocaleString('th-TH')})
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-slate-400 font-light text-sm">
                  - ไม่มีข้อเสนอแนะเพิ่มเติม -
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
