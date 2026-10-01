import React, { useState, useMemo, useEffect } from "react";
import { AnalyticsData } from "./types";
import { 
  analyzeEvaluations, 
  calculateCourseOperationalStats, 
  QuestionStat, 
  RatingDistributionItem,
  DEFAULT_QUESTIONS,
  EvaluationAnalysisResult,
  CourseOperationalStats
} from "../../lib/evaluationAnalytics";
import { exportEvaluationPdf } from "../../lib/pdfExport";
import { OverviewPdfReport } from "./OverviewPdfReport";

import { 
  Users, 
  Award, 
  Star, 
  TrendingUp, 
  CheckCircle, 
  UserCheck, 
  Presentation, 
  FileDown, 
  Eye, 
  X, 
  Loader2, 
  AlertCircle,
  HelpCircle,
  BarChart3,
  Calendar,
  Sparkles,
  Info
} from "lucide-react";
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip as RechartsTooltip, 
  Cell, 
  PieChart, 
  Pie 
} from "recharts";
import toast from "react-hot-toast";

interface OverviewTabProps {
  data: AnalyticsData;
  selectedCourseId?: string;
  onSelectCourse?: (courseId: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ 
  data, 
  selectedCourseId: parentSelectedCourseId,
  onSelectCourse 
}) => {
  // Determine active course
  const [activeCourseId, setActiveCourseId] = useState<string>(() => {
    if (parentSelectedCourseId && parentSelectedCourseId !== "all") {
      return parentSelectedCourseId;
    }
    return data.courses[0]?.id || "";
  });

  // Keep in sync with parent if changed externally
  useEffect(() => {
    if (parentSelectedCourseId && parentSelectedCourseId !== "all" && parentSelectedCourseId !== activeCourseId) {
      setActiveCourseId(parentSelectedCourseId);
    } else if ((!activeCourseId || activeCourseId === "all") && data.courses.length > 0) {
      setActiveCourseId(data.courses[0].id);
    }
  }, [parentSelectedCourseId, data.courses]);

  const handleCourseChange = (newCourseId: string) => {
    setActiveCourseId(newCourseId);
    if (onSelectCourse) {
      onSelectCourse(newCourseId);
    }
    // Reset any active inspection states
    setSelectedQuestionIdx(null);
    setSelectedScoreSegment(null);
  };

  const selectedCourse = useMemo(() => {
    return data.courses.find(c => c.id === activeCourseId) || data.courses[0] || null;
  }, [data.courses, activeCourseId]);

  // Filter course-specific data
  const courseEvaluations = useMemo(() => {
    if (!selectedCourse) return [];
    return data.evaluations.filter(e => e.courseId === selectedCourse.id);
  }, [data.evaluations, selectedCourse]);

  const courseRegistrations = useMemo(() => {
    if (!selectedCourse) return [];
    return data.registrations.filter(r => r.courseId === selectedCourse.id);
  }, [data.registrations, selectedCourse]);

  // Shared statistical analysis
  const analysis: EvaluationAnalysisResult = useMemo(() => {
    return analyzeEvaluations(
      courseEvaluations, 
      DEFAULT_QUESTIONS, 
      selectedCourse?.title || "หลักสูตร"
    );
  }, [courseEvaluations, selectedCourse]);

  // Operational metrics
  const operationalStats: CourseOperationalStats = useMemo(() => {
    if (!selectedCourse) {
      return {
        totalRegistrations: 0,
        totalAttendees: 0,
        attendanceRate: 0,
        totalEvals: 0,
        uniqueEvaluatorsCount: 0,
        responseRate: 0,
        totalCerts: 0,
        certRate: 0
      };
    }
    return calculateCourseOperationalStats(selectedCourse.id, data.registrations, data.evaluations);
  }, [selectedCourse, data.registrations, data.evaluations]);

  // Interactive Inspector States
  const [selectedQuestionIdx, setSelectedQuestionIdx] = useState<number | null>(null);
  const [selectedScoreSegment, setSelectedScoreSegment] = useState<number | null>(null);

  // PDF Export States
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfProgressText, setPdfProgressText] = useState("");
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  // Active inspected question
  const activeInspectedQuestion: QuestionStat | null = useMemo(() => {
    if (selectedQuestionIdx === null) return analysis.highestQuestion || analysis.questionStats[0] || null;
    return analysis.questionStats.find(q => q.index === selectedQuestionIdx) || null;
  }, [selectedQuestionIdx, analysis]);

  // Active inspected score segment
  const activeInspectedScore: RatingDistributionItem | null = useMemo(() => {
    if (selectedScoreSegment === null) return analysis.distribution[0] || null; // default to 5 stars
    return analysis.distribution.find(d => d.score === selectedScoreSegment) || null;
  }, [selectedScoreSegment, analysis]);

  const handleExportOverviewPdf = async () => {
    if (!selectedCourse || analysis.totalResponses === 0) {
      toast.error("ไม่มีข้อมูลประเมินสำหรับสร้างสรุปผล PDF");
      return;
    }

    setIsExportingPdf(true);
    setPdfProgressText("กำลังสร้างสรุปผล PDF...");

    try {
      const sanitizedTitle = (selectedCourse.title || "course").replace(/[/\\?%*:|"<>]/g, "-").trim();
      const dateStr = new Date().toISOString().split("T")[0];
      const filename = `evaluation-overview_${sanitizedTitle}_${dateStr}.pdf`;

      await exportEvaluationPdf("overview-pdf-report", filename, (msg) => {
        setPdfProgressText(msg);
      });

      toast.success("สร้างสรุปผล PDF เรียบร้อยแล้ว");
    } catch (err: any) {
      console.error("Overview PDF export error:", err);
      toast.error("ไม่สามารถสร้าง PDF ได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsExportingPdf(false);
      setPdfProgressText("");
    }
  };

  if (!selectedCourse) {
    return (
      <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center">
        <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-slate-700">ไม่พบข้อมูลหลักสูตร</h3>
        <p className="text-slate-400 text-sm mt-1">กรุณาสร้างหลักสูตรหรือตรวจสอบการเชื่อมต่อข้อมูล</p>
      </div>
    );
  }

  // Formatting date
  const formattedCourseDate = selectedCourse.date || "ไม่ระบุวันที่";

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* SECTION 1: HEADER & COURSE SELECTOR */}
      <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-crimson inline-block" />
            <span className="text-xs font-bold uppercase tracking-wider text-crimson">
              ผลประเมินการอบรม (Executive Evaluation Dashboard)
            </span>
          </div>

          <h2 className="text-2xl lg:text-3xl font-black text-slate-900 leading-snug tracking-tight">
            "{selectedCourse.title}"
          </h2>

          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-600 pt-1">
            <span className="flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-xl">
              <Calendar className="w-3.5 h-3.5 text-crimson" />
              วันที่อบรม: <span className="text-slate-800">{formattedCourseDate}</span>
            </span>
            <span className="flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-xl">
              <Users className="w-3.5 h-3.5 text-slate-500" />
              ผู้ตอบแบบประเมิน: <span className="text-slate-900 font-bold">{analysis.totalResponses}</span> รายการ
            </span>
            <span className="bg-slate-100 px-3 py-1.5 rounded-xl text-slate-500">
              เกณฑ์: <span className="text-slate-800 font-bold">คะแนนเต็ม 5.00</span>
            </span>
          </div>
        </div>

        {/* Right Actions: Course Selector & PDF Download */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          {/* Course Selector Dropdown */}
          <div className="relative">
            <select
              value={activeCourseId}
              onChange={(e) => handleCourseChange(e.target.value)}
              className="w-full sm:w-64 px-4 py-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-crimson/20 cursor-pointer transition-colors"
            >
              {data.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          {/* PDF Preview Button */}
          {analysis.totalResponses > 0 && (
            <button
              onClick={() => setShowPdfPreview(true)}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-xs"
              title="ดูตัวอย่างสรุปผล PDF"
            >
              <Eye className="w-4 h-4 text-slate-500" />
              <span className="hidden xl:inline">ดูตัวอย่าง</span>
            </button>
          )}

          {/* PDF Download Button */}
          <button
            onClick={handleExportOverviewPdf}
            disabled={isExportingPdf || analysis.totalResponses === 0}
            className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-bold transition-all shadow-md ${
              analysis.totalResponses > 0
                ? "bg-crimson hover:bg-crimson-dark text-white shadow-crimson/20 cursor-pointer"
                : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
            }`}
            title={analysis.totalResponses === 0 ? "ไม่มีข้อมูลประเมินสำหรับสร้างรายงาน PDF" : "ดาวน์โหลดสรุปผล PDF"}
          >
            {isExportingPdf ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{pdfProgressText || "กำลังส่งออก..."}</span>
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" />
                <span>ดาวน์โหลดสรุปผล PDF</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* NO DATA STATE */}
      {analysis.totalResponses === 0 ? (
        <div className="bg-white py-16 px-6 rounded-3xl border border-dashed border-slate-200 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto text-slate-300">
            <BarChart3 className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-700">
              ยังไม่มีผลการประเมินสำหรับหลักสูตรนี้
            </h3>
            <p className="text-slate-400 text-sm mt-1 max-w-md mx-auto">
              เมื่อผู้เข้าอบรมเริ่มทำแบบประเมินความพึงพอใจ ข้อมูลสถิติ คะแนนเฉลี่ยรายข้อ และการกระจายคะแนนจะปรากฏขึ้นอัตโนมัติ
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* SECTION 2: EXECUTIVE KPI CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* KPI 1: ผู้ตอบแบบประเมิน */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0">
                <Users className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  ผู้ตอบแบบประเมิน
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-slate-800 tabular-nums">
                    {analysis.totalResponses}
                  </span>
                  <span className="text-slate-400 font-medium text-xs">คน</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">ครบถ้วนทุกข้อคำถาม</p>
              </div>
            </div>

            {/* KPI 2: คะแนนเฉลี่ยรวม */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="w-14 h-14 bg-crimson/10 text-crimson rounded-2xl flex items-center justify-center shrink-0">
                <Award className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  คะแนนเฉลี่ยรวม
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-crimson tabular-nums">
                    {analysis.overallAverage.toFixed(2)}
                  </span>
                  <span className="text-slate-400 font-bold text-sm">/ 5.00</span>
                </div>
                <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${analysis.overallLevel.bg}`}>
                  {analysis.overallLevel.label}
                </span>
              </div>
            </div>

            {/* KPI 3: ให้ 5 คะแนน (Top-box score) */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center shrink-0">
                <Star className="w-7 h-7 fill-amber-500" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  ให้ 5 คะแนน
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-slate-800 tabular-nums">
                    {analysis.pct5Overall}%
                  </span>
                </div>
                <span className="inline-block mt-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                  Top-box score
                </span>
              </div>
            </div>

            {/* KPI 4: คะแนน 4–5 (ระดับพึงพอใจสูง) */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
                <TrendingUp className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  คะแนน 4–5
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-emerald-600 tabular-nums">
                    {analysis.pct45Overall}%
                  </span>
                </div>
                <span className="inline-block mt-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                  ระดับพึงพอใจสูง
                </span>
              </div>
            </div>
          </div>

          {/* SECTION 3 & 4: CHARTS GRID */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* SECTION 3: QUESTION AVERAGE CHART (7 Cols) */}
            <div className="lg:col-span-7 bg-white p-6 md:p-7 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800">
                      ค่าเฉลี่ยรายข้อ
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      คลิกหรือแตะแท่งคะแนนเพื่อดูรายละเอียดข้อคำถามและสัดส่วนคะแนน
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg">
                    {analysis.questionStats.length} คำถาม
                  </span>
                </div>

                {/* Recharts BarChart */}
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analysis.questionStats.map(q => ({
                        index: q.index,
                        label: `ข้อ ${q.index + 1}`,
                        score: q.average,
                        fullQuestion: q.question,
                        pct45: q.pct45
                      }))}
                      margin={{ top: 15, right: 10, left: -20, bottom: 5 }}
                      onClick={(state: any) => {
                        if (state && state.activePayload && state.activePayload.length > 0) {
                          const idx = state.activePayload[0].payload.index;
                          setSelectedQuestionIdx(idx);
                        }
                      }}
                    >
                      <XAxis 
                        dataKey="label" 
                        tick={{ fontSize: 11, fill: '#64748b' }} 
                        axisLine={{ stroke: '#e2e8f0' }}
                        tickLine={false}
                      />
                      <YAxis 
                        domain={[0, 5]} 
                        ticks={[0, 1, 2, 3, 4, 5]}
                        tick={{ fontSize: 11, fill: '#64748b' }} 
                        axisLine={{ stroke: '#e2e8f0' }}
                        tickLine={false}
                      />
                      <RechartsTooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const p = payload[0].payload;
                            return (
                              <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl text-xs max-w-xs space-y-1">
                                <p className="font-bold text-crimson-light">ข้อที่ {p.index + 1}</p>
                                <p className="text-slate-200 text-[11px] leading-snug">{p.fullQuestion}</p>
                                <div className="flex justify-between items-center pt-1 border-t border-slate-700">
                                  <span>คะแนนเฉลี่ย:</span>
                                  <strong className="text-emerald-400">{p.score.toFixed(2)} / 5.00</strong>
                                </div>
                                <div className="flex justify-between items-center text-[10px] text-slate-400">
                                  <span>พึงพอใจ 4–5:</span>
                                  <span>{p.pct45}%</span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar 
                        dataKey="score" 
                        radius={[6, 6, 0, 0]}
                        cursor="pointer"
                      >
                        {analysis.questionStats.map((q) => (
                          <Cell 
                            key={`cell-${q.index}`} 
                            fill={
                              selectedQuestionIdx === q.index
                                ? '#C41230'
                                : q.average >= 4.5 ? '#10b981' : '#3b82f6'
                            } 
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Interactive Inspector for Question */}
              {activeInspectedQuestion && (
                <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2 animate-in fade-in duration-200">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-crimson/10 text-crimson font-black text-xs flex items-center justify-center shrink-0">
                        {activeInspectedQuestion.index + 1}
                      </span>
                      <p className="font-bold text-slate-800 leading-snug">
                        {activeInspectedQuestion.question}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-base font-black text-crimson tabular-nums">
                        {activeInspectedQuestion.average.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-slate-400 block">/ 5.00</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                    <span>ผู้ตอบข้อนี้: <strong className="text-slate-700">{activeInspectedQuestion.count}</strong> คน</span>
                    <span>สัดส่วน 5 ดาว: <strong className="text-slate-700">{activeInspectedQuestion.pct5}%</strong></span>
                    <span>พึงพอใจ 4–5: <strong className="text-emerald-600">{activeInspectedQuestion.pct45}%</strong></span>
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 4: OVERALL SCORE DISTRIBUTION (5 Cols) */}
            <div className="lg:col-span-5 bg-white p-6 md:p-7 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800">
                      การกระจายคะแนนรวม
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      สัดส่วนคะแนน 1–5 ดาว จากทุกข้อคำถาม
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg">
                    Donut Chart
                  </span>
                </div>

                {/* Donut Chart with Center Text */}
                <div className="h-56 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analysis.distribution.map(d => ({
                          name: `${d.score} คะแนน`,
                          value: d.count,
                          score: d.score,
                          percentage: d.percentage
                        }))}
                        innerRadius={60}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                        cursor="pointer"
                        onClick={(state: any) => {
                          if (state && state.score) {
                            setSelectedScoreSegment(state.score);
                          }
                        }}
                      >
                        {analysis.distribution.map((entry) => (
                          <Cell 
                            key={`donut-cell-${entry.score}`} 
                            fill={
                              entry.score === 5 ? '#16a34a' :
                              entry.score === 4 ? '#2563eb' :
                              entry.score === 3 ? '#f59e0b' :
                              entry.score === 2 ? '#f97316' : '#ef4444'
                            }
                            stroke={selectedScoreSegment === entry.score ? '#0f172a' : 'transparent'}
                            strokeWidth={selectedScoreSegment === entry.score ? 3 : 0}
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(value: any, name: any, props: any) => [
                          `${value} ครั้ง (${props.payload.percentage}%)`,
                          name
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Absolute Center Display: overallAverage / 5 */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-black text-slate-800 tabular-nums">
                      {analysis.overallAverage.toFixed(2)}
                    </span>
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      / 5.00
                    </span>
                  </div>
                </div>
              </div>

              {/* Legend with interactive click and counts */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100">
                {analysis.distribution.map(d => {
                  const isSelected = selectedScoreSegment === d.score;
                  return (
                    <button
                      key={d.score}
                      onClick={() => setSelectedScoreSegment(isSelected ? null : d.score)}
                      className={`w-full flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer text-left ${
                        isSelected ? 'bg-slate-100 font-bold' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span 
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{
                            backgroundColor: 
                              d.score === 5 ? '#16a34a' :
                              d.score === 4 ? '#2563eb' :
                              d.score === 3 ? '#f59e0b' :
                              d.score === 2 ? '#f97316' : '#ef4444'
                          }}
                        />
                        <span className="text-slate-700">{d.score} คะแนน</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <strong className="text-slate-800 tabular-nums">{d.percentage}%</strong>
                        <span className="text-slate-400 text-[11px] tabular-nums">({d.count} ครั้ง)</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* SECTION 5: EXECUTIVE INTERPRETATION */}
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-3xl p-6 md:p-8 shadow-lg relative overflow-hidden">
            <div className="relative z-10 space-y-3">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 bg-crimson text-white rounded-full text-xs font-bold uppercase tracking-wider">
                  Executive Interpretation
                </span>
                <span className="text-slate-400 text-xs font-medium">
                  บทสรุปภาพรวมเชิงบริหาร
                </span>
              </div>

              <h3 className="text-xl font-bold text-white tracking-wide">
                สรุปผลการประเมินโครงการอบรม: {selectedCourse.title}
              </h3>

              <p className="text-slate-300 text-sm leading-relaxed max-w-4xl font-normal text-justify">
                {analysis.executiveSummaryText}
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-3 text-xs text-slate-400 border-t border-slate-700/60">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle className="w-4 h-4" /> สัดส่วนระดับพึงพอใจสูง (4–5 ดาว): <strong className="text-white">{analysis.pct45Overall}%</strong>
                </span>
                <span>•</span>
                <span>จุดเด่นสูงสุด: <strong className="text-white">{analysis.highestQuestion?.question || "-"}</strong> ({analysis.highestQuestion?.average.toFixed(2)}/5.00)</span>
              </div>
            </div>
            <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-crimson/10 rounded-full blur-3xl pointer-events-none" />
          </div>

          {/* SECTION 6: COURSE OPERATIONAL SUMMARY */}
          <div className="bg-white rounded-3xl p-6 md:p-7 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-800">
                  สรุปการดำเนินงานของหลักสูตร (Course Operational Summary)
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  ข้อมูลการลงทะเบียน การเข้าอบรมจริง และการตอบแบบประเมินสำหรับหลักสูตรนี้
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* Card 1: ผู้ลงทะเบียนทั้งหมด */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-center">
                <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">ผู้ลงทะเบียน</span>
                <span className="text-xl font-extrabold text-slate-800 tabular-nums">
                  {operationalStats.totalRegistrations}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">คน</span>
              </div>

              {/* Card 2: ผู้เข้าอบรมจริง */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-center">
                <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">ผู้เข้าอบรมจริง</span>
                <span className="text-xl font-extrabold text-emerald-700 tabular-nums">
                  {operationalStats.totalAttendees}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">คน (Check-in)</span>
              </div>

              {/* Card 3: Attendance rate */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-center">
                <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">Attendance rate</span>
                <span className="text-xl font-extrabold text-slate-800 tabular-nums">
                  {operationalStats.attendanceRate}%
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">อัตราเข้าอบรม</span>
              </div>

              {/* Card 4: ผู้ตอบแบบประเมิน */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-center">
                <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">ผู้ตอบประเมิน</span>
                <span className="text-xl font-extrabold text-slate-800 tabular-nums">
                  {operationalStats.totalEvals}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">รายการ</span>
              </div>

              {/* Card 5: Response rate */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-center">
                <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">Response rate</span>
                <span className="text-xl font-extrabold text-crimson tabular-nums">
                  {operationalStats.responseRate}%
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {operationalStats.totalAttendees > 0 ? `เทียบผู้เข้าอบรม` : `เทียบผู้ลงทะเบียน`}
                </span>
              </div>

              {/* Card 6: รับ Certificate แล้ว */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-center">
                <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">รับ Certificate</span>
                <span className="text-xl font-extrabold text-amber-600 tabular-nums">
                  {operationalStats.totalCerts}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">ใบที่ส่งแล้ว</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Hidden Offscreen PDF Report Render Container for html2canvas */}
      {selectedCourse && analysis.totalResponses > 0 && (
        <div style={{ position: "fixed", left: "-9999px", top: 0, opacity: 0, pointerEvents: "none" }}>
          <OverviewPdfReport
            course={selectedCourse}
            analysis={analysis}
            operationalStats={operationalStats}
          />
        </div>
      )}

      {/* Overview PDF Preview Modal */}
      {showPdfPreview && selectedCourse && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-100 w-full max-w-4xl max-h-[92vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  ตัวอย่างสรุปผล PDF (Executive Overview Preview)
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedCourse.title} • จำลองหน้ากระดาษ A4 เสมือนจริง
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleExportOverviewPdf}
                  disabled={isExportingPdf}
                  className="flex items-center gap-2 px-5 py-2.5 bg-crimson hover:bg-crimson-dark text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-crimson/20 disabled:opacity-60 cursor-pointer"
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
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body / Scrollable Document */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center gap-6">
              <div className="scale-90 sm:scale-100 origin-top shadow-xl">
                <OverviewPdfReport
                  course={selectedCourse}
                  analysis={analysis}
                  operationalStats={operationalStats}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
