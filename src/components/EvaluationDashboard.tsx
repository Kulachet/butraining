import React, { useState, useEffect, useMemo } from "react";
import { collection, query, where, getDocs, onSnapshot, orderBy, doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Course } from "../types";
import { 
  analyzeEvaluations, 
  DEFAULT_QUESTIONS, 
  getRatingsArray, 
  EvaluationAnalysisResult 
} from "../lib/evaluationAnalytics";
import { exportEvaluationPdf } from "../lib/pdfExport";
import { EvaluationOverviewTab } from "./analytics/EvaluationOverviewTab";
import { EvaluationQuestionsTab } from "./analytics/EvaluationQuestionsTab";
import { EvaluationFeedbackTab } from "./analytics/EvaluationFeedbackTab";
import { EvaluationCommentsListTab } from "./analytics/EvaluationCommentsListTab";
import { EvaluationPdfReport } from "./analytics/EvaluationPdfReport";

import { 
  BarChart3, 
  ChevronDown, 
  Download, 
  FileDown, 
  FileText, 
  Eye, 
  X, 
  Loader2, 
  Layers, 
  MessageSquare, 
  Sparkles,
  Calendar,
  User,
  CheckCircle2
} from "lucide-react";
import Papa from "papaparse";
import toast from "react-hot-toast";

type ActiveTabType = "overview" | "questions" | "feedback" | "comments";

export const EvaluationDashboard: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [questions, setQuestions] = useState<string[]>(DEFAULT_QUESTIONS);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTabType>("overview");

  // PDF Export states
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfProgressText, setPdfProgressText] = useState("");
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  // Fetch courses list
  useEffect(() => {
    const q = query(collection(db, "courses"), orderBy("date", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCourses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Course[]);
    });
    return () => unsubscribe();
  }, []);

  // Fetch custom questions from settings if available
  useEffect(() => {
    const fetchQuestions = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, "settings", "evaluation"));
        if (settingsDoc.exists() && settingsDoc.data().questions && Array.isArray(settingsDoc.data().questions)) {
          setQuestions(settingsDoc.data().questions);
        } else {
          setQuestions(DEFAULT_QUESTIONS);
        }
      } catch (err) {
        console.error("Error fetching evaluation questions:", err);
      }
    };
    fetchQuestions();
  }, []);

  // Fetch evaluations when course changes
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
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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

  const selectedCourse = useMemo(() => {
    return courses.find(c => c.id === selectedCourseId) || null;
  }, [courses, selectedCourseId]);

  // Reactive Analytics
  const analysis: EvaluationAnalysisResult = useMemo(() => {
    return analyzeEvaluations(evaluations, questions, selectedCourse?.title || "หลักสูตร");
  }, [evaluations, questions, selectedCourse]);

  // CSV Export with UTF-8 BOM and Formula Injection Protection
  const handleExportCSV = () => {
    if (evaluations.length === 0) {
      toast.error("ไม่มีข้อมูลสำหรับดาวน์โหลด");
      return;
    }

    const sanitizeCsvField = (val: any) => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (/^[=+\-@\t\r]/.test(str)) {
        return `'${str}`;
      }
      return str;
    };

    const data = evaluations.map((evalData, index) => {
      const ratingsArr = getRatingsArray(evalData.ratings, questions.length);
      const row: any = {
        "ลำดับ": index + 1,
        "ชื่อ-นามสกุล": sanitizeCsvField(evalData.userName || "-"),
        "อีเมล": sanitizeCsvField(evalData.userEmail || "-"),
        "เวลาประเมิน": evalData.createdAt ? new Date(evalData.createdAt).toLocaleString('th-TH') : "-"
      };

      questions.forEach((q, qIdx) => {
        row[`ข้อที่ ${qIdx + 1}: ${q}`] = ratingsArr[qIdx] || "-";
      });

      row["ข้อเสนอแนะเพิ่มเติม"] = sanitizeCsvField(evalData.suggestion || "-");
      return row;
    });

    const csv = Papa.unparse(data);
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const sanitizedTitle = (selectedCourse?.title || "หลักสูตร").replace(/[/\\?%*:|"<>]/g, "-").trim();
    const dateStr = new Date().toISOString().split("T")[0];
    link.setAttribute("href", url);
    link.setAttribute("download", `ผลประเมิน_${sanitizedTitle}_${dateStr}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success("ดาวน์โหลดผลประเมิน (CSV) เรียบร้อยแล้ว");
  };

  // PDF Export
  const handleExportPDF = async () => {
    if (!selectedCourse || evaluations.length === 0) {
      toast.error("ไม่มีข้อมูลประเมินสำหรับสร้างรายงาน PDF");
      return;
    }

    setIsExportingPdf(true);
    setPdfProgressText("กำลังเริ่มต้นสร้างรายงาน...");

    try {
      const sanitizedTitle = (selectedCourse.title || "หลักสูตร").replace(/[/\\?%*:|"<>]/g, "-").trim();
      const dateStr = new Date().toISOString().split("T")[0];
      const filename = `รายงานผลการประเมิน_${sanitizedTitle}_${dateStr}.pdf`;

      await exportEvaluationPdf("evaluation-pdf-report", filename, (msg) => {
        setPdfProgressText(msg);
      });

      toast.success("ดาวน์โหลดรายงาน PDF เรียบร้อยแล้ว");
    } catch (err: any) {
      console.error("PDF export error:", err);
      toast.error(err.message || "เกิดข้อผิดพลาดในการสร้างไฟล์ PDF");
    } finally {
      setIsExportingPdf(false);
      setPdfProgressText("");
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-3 py-1 bg-crimson/10 text-crimson rounded-full text-xs font-bold uppercase tracking-wider">
              Evaluation Analytics
            </span>
            <span className="text-slate-400 text-xs font-medium">ฝ่ายพัฒนาวิชาการ (Academic Development)</span>
          </div>
          <h1 className="text-[28px] lg:text-[34px] font-extrabold text-[#333333] tracking-tight leading-[1.3]">
            ผลการประเมินโครงการอบรม
          </h1>
          <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px] max-w-xl leading-[1.6] mt-1">
            แดชบอร์ดวิเคราะห์ผลการประเมินความพึงพอใจ จำแนกตามมิติและหัวข้อคำถาม พร้อมส่งออกรายงานเชิงบริหาร
          </p>
        </div>

        {/* Action Buttons */}
        {evaluations.length > 0 && selectedCourse && (
          <div className="flex flex-wrap items-center gap-3">
            {/* PDF Preview Button */}
            <button
              onClick={() => setShowPdfPreview(true)}
              className="flex items-center gap-2 px-4 py-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-xs"
              title="ดูตัวอย่างรายงาน PDF ก่อนดาวน์โหลด"
            >
              <Eye className="w-4 h-4 text-slate-500" />
              ดูตัวอย่างรายงาน PDF
            </button>

            {/* CSV Export Button */}
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              <Download className="w-4 h-4 text-slate-500" />
              ดาวน์โหลด CSV
            </button>

            {/* PDF Export Button */}
            <button
              onClick={handleExportPDF}
              disabled={isExportingPdf}
              className="flex items-center gap-2 px-6 py-3 bg-crimson hover:bg-crimson-dark text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-crimson/20 disabled:opacity-60"
            >
              {isExportingPdf ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{pdfProgressText || "กำลังส่งออก..."}</span>
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  <span>ดาวน์โหลดรายงาน PDF</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Course Selector Card */}
      <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm">
        <label className="block text-sm font-bold text-slate-700 mb-3">
          เลือกหลักสูตรที่ต้องการดูผลการประเมิน:
        </label>
        <div className="relative border border-slate-200 rounded-2xl overflow-hidden hover:border-crimson focus-within:ring-2 focus-within:ring-crimson/20 transition-all bg-slate-50">
          <select
            value={selectedCourseId}
            onChange={(e) => setSelectedCourseId(e.target.value)}
            className="w-full appearance-none px-5 py-4 bg-transparent outline-none cursor-pointer text-sm font-semibold text-slate-800"
          >
            <option value="">-- กรุณาเลือกหลักสูตรเพื่อดูผลวิเคราะห์ --</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title} {course.date ? `(วันที่อบรม: ${course.date})` : ""}
              </option>
            ))}
          </select>
          <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none text-slate-400">
            <ChevronDown className="w-5 h-5" />
          </div>
        </div>

        {selectedCourse && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1.5 font-medium text-slate-700">
                <Calendar className="w-4 h-4 text-crimson" /> {selectedCourse.date || "ไม่ระบุวันที่"}
              </span>
              <span className="flex items-center gap-1.5 font-medium text-slate-700">
                <User className="w-4 h-4 text-slate-400" /> วิทยากร: {selectedCourse.instructorName || "ไม่ระบุ"}
              </span>
              {selectedCourse.category && (
                <span className="bg-slate-100 px-2.5 py-0.5 rounded-lg text-slate-600 font-medium">
                  หมวดหมู่: {selectedCourse.category}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-700">ผู้ตอบแบบประเมิน:</span>
              <span className="px-2.5 py-0.5 rounded-full bg-crimson/10 text-crimson font-black">
                {evaluations.length} คน
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {!selectedCourseId ? (
        <div className="bg-white py-24 rounded-3xl border border-dashed border-slate-200 text-center">
          <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-6 transform rotate-3">
            <BarChart3 className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-slate-700 mb-2">เลือกหลักสูตรเพื่อดูรายงานผลประเมิน</h3>
          <p className="text-slate-400 font-light max-w-md mx-auto text-sm">
            เลือกโครงการอบรมจากเมนูด้านบนเพื่อเริ่มต้นดูผลวิเคราะห์ทางสถิติ การจัดกลุ่มความคิดเห็น และส่งออกรายงานเชิงบริหาร
          </p>
        </div>
      ) : loading ? (
        <div className="bg-white py-24 rounded-3xl border border-slate-200 flex flex-col justify-center items-center">
          <div className="w-10 h-10 border-4 border-crimson/20 border-t-crimson rounded-full animate-spin mb-4" />
          <p className="text-slate-500 font-medium text-sm">กำลังคำนวณและประมวลผลข้อมูลการประเมิน...</p>
        </div>
      ) : evaluations.length === 0 ? (
        <div className="bg-white py-24 rounded-3xl border border-dashed border-slate-200 text-center">
          <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <FileText className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-slate-700 mb-2">ยังไม่มีผลการประเมิน</h3>
          <p className="text-slate-400 font-light text-sm">
            หลักสูตรนี้ยังไม่มีผู้ส่งแบบประเมินความพึงพอใจในระบบ
          </p>
        </div>
      ) : (
        <div className="space-y-8 animate-in fade-in duration-300">
          {/* Segmented Tab Navigation */}
          <div className="flex border-b border-slate-200 pb-1 gap-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab("overview")}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === "overview"
                  ? "bg-crimson text-white shadow-md shadow-crimson/20"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              ภาพรวม (Executive Summary)
            </button>

            <button
              onClick={() => setActiveTab("questions")}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === "questions"
                  ? "bg-crimson text-white shadow-md shadow-crimson/20"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Layers className="w-4 h-4" />
              คะแนนรายข้อ (Rating Detail)
            </button>

            <button
              onClick={() => setActiveTab("feedback")}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === "feedback"
                  ? "bg-crimson text-white shadow-md shadow-crimson/20"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Sparkles className="w-4 h-4" />
              การจัดกลุ่มความคิดเห็น (Analysis & Themes)
            </button>

            <button
              onClick={() => setActiveTab("comments")}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === "comments"
                  ? "bg-crimson text-white shadow-md shadow-crimson/20"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              ข้อมูลความคิดเห็นทั้งหมด (Appendix)
            </button>
          </div>

          {/* Tab Views */}
          {activeTab === "overview" && (
            <EvaluationOverviewTab
              analysis={analysis}
              courseTitle={selectedCourse?.title || "หลักสูตร"}
            />
          )}

          {activeTab === "questions" && (
            <EvaluationQuestionsTab
              questionStats={analysis.questionStats}
            />
          )}

          {activeTab === "feedback" && (
            <EvaluationFeedbackTab
              analysis={analysis}
              onNavigateToCommentsTab={() => setActiveTab("comments")}
            />
          )}

          {activeTab === "comments" && (
            <EvaluationCommentsListTab
              comments={analysis.comments}
            />
          )}
        </div>
      )}

      {/* Hidden Offscreen PDF Report Render Container for html2canvas */}
      {selectedCourse && evaluations.length > 0 && (
        <div style={{ position: "fixed", left: "-9999px", top: 0, opacity: 0, pointerEvents: "none" }}>
          <EvaluationPdfReport
            course={selectedCourse}
            analysis={analysis}
            questions={questions}
          />
        </div>
      )}

      {/* PDF Preview Modal */}
      {showPdfPreview && selectedCourse && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-100 w-full max-w-4xl max-h-[92vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  ตัวอย่างเอกสารรายงาน PDF (Executive Report Preview)
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedCourse.title} • จำลองหน้ากระดาษ A4 เสมือนจริง
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleExportPDF}
                  disabled={isExportingPdf}
                  className="flex items-center gap-2 px-5 py-2.5 bg-crimson hover:bg-crimson-dark text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-crimson/20 disabled:opacity-60"
                >
                  {isExportingPdf ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{pdfProgressText || "กำลังส่งออก..."}</span>
                    </>
                  ) : (
                    <>
                      <FileDown className="w-3.5 h-3.5" />
                      <span>ดาวน์โหลด PDF ตอนนี้</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => setShowPdfPreview(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body / Scrollable Document */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center gap-6">
              <div className="scale-90 sm:scale-100 origin-top shadow-xl">
                <EvaluationPdfReport
                  course={selectedCourse}
                  analysis={analysis}
                  questions={questions}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
