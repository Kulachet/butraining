import React from "react";
import { Course } from "../../types";
import { EvaluationAnalysisResult, CourseOperationalStats } from "../../lib/evaluationAnalytics";

// Dedicated PDF-Safe Colors (Strictly Hex/RGB to prevent html2canvas OKLCH parse errors)
export const PDF_COLORS = {
  buRed: "#B51E23",
  crimson: "#991b1b",
  navy: "#18243D",
  textDark: "#0F172A",
  textPrimary: "#1E293B",
  textSecondary: "#475569",
  textMuted: "#64748B",
  textSubtle: "#94A3B8",
  border: "#E2E8F0",
  borderLight: "#F1F5F9",
  cardBg: "#FFFFFF",
  softBg: "#F8FAFC",
  green: "#10B981",
  greenDark: "#047857",
  greenBg: "#ECFDF5",
  greenText: "#065F46",
  greenBorder: "#A7F3D0",
  blue: "#3B82F6",
  blueDark: "#1D4ED8",
  blueBg: "#EFF6FF",
  blueText: "#1E40AF",
  blueBorder: "#BFDBFE",
  amber: "#F59E0B",
  amberDark: "#B45309",
  amberBg: "#FFFBEB",
  amberText: "#92400E",
  amberBorder: "#FDE68A",
  orange: "#F97316",
  rose: "#F43F5E",
  roseDark: "#BE123C",
  roseBg: "#FFF1F2",
  roseText: "#9F1239",
  roseBorder: "#FECDD3",
};

interface OverviewPdfReportProps {
  course: Course;
  analysis: EvaluationAnalysisResult;
  operationalStats: CourseOperationalStats;
}

export const OverviewPdfReport: React.FC<OverviewPdfReportProps> = ({
  course,
  analysis,
  operationalStats
}) => {
  const currentDateStr = new Date().toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  return (
    <div 
      id="overview-pdf-report" 
      style={{ 
        width: "794px", 
        color: PDF_COLORS.textPrimary, 
        backgroundColor: PDF_COLORS.cardBg,
        fontFamily: '"Prompt", "Kanit", system-ui, -apple-system, sans-serif'
      }}
    >
      {/* PAGE 1: EXECUTIVE EVALUATION DASHBOARD OVERVIEW */}
      <div 
        className="pdf-page p-10 flex flex-col justify-between"
        style={{ 
          width: "794px", 
          minHeight: "1123px", 
          boxSizing: "border-box",
          backgroundColor: PDF_COLORS.cardBg,
          color: PDF_COLORS.textPrimary
        }}
      >
        <div>
          {/* Header */}
          <div 
            className="pb-4 mb-5 flex justify-between items-end"
            style={{ borderBottom: `2px solid ${PDF_COLORS.buRed}` }}
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span 
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ backgroundColor: PDF_COLORS.buRed }}
                />
                <span 
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: PDF_COLORS.buRed }}
                >
                  BU Academic Training • Executive Evaluation Overview
                </span>
              </div>
              <h1 
                className="text-2xl font-black leading-tight"
                style={{ color: PDF_COLORS.textDark }}
              >
                ผลประเมินการอบรม
              </h1>
              <p 
                className="text-base font-bold mt-1"
                style={{ color: PDF_COLORS.textSecondary }}
              >
                "{course.title}"
              </p>
            </div>
            <div 
              className="text-right text-xs"
              style={{ color: PDF_COLORS.textMuted }}
            >
              <p><span className="font-semibold" style={{ color: PDF_COLORS.textPrimary }}>วันที่อบรม:</span> {course.date || "ไม่ระบุ"}</p>
              <p><span className="font-semibold" style={{ color: PDF_COLORS.textPrimary }}>วิทยากร:</span> {course.instructorName || "ไม่ระบุ"}</p>
              <p><span className="font-semibold" style={{ color: PDF_COLORS.textPrimary }}>วันที่ออกรายงาน:</span> {currentDateStr}</p>
              <p><span className="font-semibold" style={{ color: PDF_COLORS.textPrimary }}>เกณฑ์คะแนน:</span> คะแนนเต็ม 5.00</p>
            </div>
          </div>

          {/* Section: 4 Executive KPI Cards */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {/* KPI 1 */}
            <div 
              className="rounded-xl p-3 text-center"
              style={{ 
                backgroundColor: PDF_COLORS.softBg, 
                border: `1px solid ${PDF_COLORS.border}` 
              }}
            >
              <span className="text-xs font-semibold block mb-1" style={{ color: PDF_COLORS.textMuted }}>
                ผู้ตอบแบบประเมิน
              </span>
              <span className="text-2xl font-black" style={{ color: PDF_COLORS.textDark }}>
                {analysis.totalResponses}
              </span>
              <span className="text-xs block mt-0.5" style={{ color: PDF_COLORS.textSubtle }}>
                รายการ (ครบถ้วน)
              </span>
            </div>

            {/* KPI 2 */}
            <div 
              className="rounded-xl p-3 text-center"
              style={{ 
                backgroundColor: PDF_COLORS.softBg, 
                border: `1px solid ${PDF_COLORS.border}` 
              }}
            >
              <span className="text-xs font-semibold block mb-1" style={{ color: PDF_COLORS.textMuted }}>
                คะแนนเฉลี่ยรวม
              </span>
              <div className="flex items-center justify-center gap-1">
                <span className="text-2xl font-black" style={{ color: PDF_COLORS.buRed }}>
                  {analysis.overallAverage.toFixed(2)}
                </span>
                <span className="text-xs" style={{ color: PDF_COLORS.textSubtle }}>/ 5.00</span>
              </div>
              <span 
                className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ 
                  backgroundColor: PDF_COLORS.greenBg, 
                  color: PDF_COLORS.greenText,
                  border: `1px solid ${PDF_COLORS.greenBorder}`
                }}
              >
                {analysis.overallLevel.label}
              </span>
            </div>

            {/* KPI 3 */}
            <div 
              className="rounded-xl p-3 text-center"
              style={{ 
                backgroundColor: PDF_COLORS.softBg, 
                border: `1px solid ${PDF_COLORS.border}` 
              }}
            >
              <span className="text-xs font-semibold block mb-1" style={{ color: PDF_COLORS.textMuted }}>
                ให้ 5 คะแนน
              </span>
              <span className="text-2xl font-black" style={{ color: PDF_COLORS.textDark }}>
                {analysis.pct5Overall}%
              </span>
              <span className="text-xs block mt-0.5" style={{ color: PDF_COLORS.textSubtle }}>
                Top-box score
              </span>
            </div>

            {/* KPI 4 */}
            <div 
              className="rounded-xl p-3 text-center"
              style={{ 
                backgroundColor: PDF_COLORS.softBg, 
                border: `1px solid ${PDF_COLORS.border}` 
              }}
            >
              <span className="text-xs font-semibold block mb-1" style={{ color: PDF_COLORS.textMuted }}>
                คะแนน 4–5
              </span>
              <span className="text-2xl font-black" style={{ color: PDF_COLORS.greenDark }}>
                {analysis.pct45Overall}%
              </span>
              <span className="text-xs block mt-0.5" style={{ color: PDF_COLORS.textSubtle }}>
                ระดับพึงพอใจสูง
              </span>
            </div>
          </div>

          {/* Grid: Question Average Chart & Overall Score Distribution */}
          <div className="grid grid-cols-12 gap-4 mb-5">
            {/* Question Average Breakdown (7 cols) */}
            <div 
              className="col-span-7 rounded-xl p-3.5"
              style={{ 
                backgroundColor: PDF_COLORS.cardBg, 
                border: `1px solid ${PDF_COLORS.border}` 
              }}
            >
              <div className="flex justify-between items-center mb-2.5">
                <h3 className="text-xs font-bold" style={{ color: PDF_COLORS.textDark }}>
                  ค่าเฉลี่ยรายข้อ (Question Average Scores)
                </h3>
                <span className="text-[10px] font-medium" style={{ color: PDF_COLORS.textMuted }}>
                  เต็ม 5.00
                </span>
              </div>

              <div className="space-y-1.5">
                {analysis.questionStats.map((q) => {
                  const barColor = q.average >= 4.5 
                    ? PDF_COLORS.green 
                    : q.average >= 4.0 
                    ? PDF_COLORS.blue 
                    : q.average >= 3.0 
                    ? PDF_COLORS.amber 
                    : PDF_COLORS.rose;

                  return (
                    <div key={q.index} className="flex items-center gap-2 text-xs">
                      <span 
                        className="w-12 font-semibold text-[11px] shrink-0"
                        style={{ color: PDF_COLORS.textMuted }}
                      >
                        ข้อ {q.index + 1}
                      </span>
                      <div 
                        className="flex-1 h-3.5 rounded-full overflow-hidden"
                        style={{ backgroundColor: PDF_COLORS.borderLight }}
                      >
                        <div 
                          className="h-full rounded-full"
                          style={{ 
                            width: `${(q.average / 5) * 100}%`,
                            backgroundColor: barColor 
                          }}
                        />
                      </div>
                      <span 
                        className="w-10 text-right font-black text-[11px]"
                        style={{ color: PDF_COLORS.textDark }}
                      >
                        {q.average.toFixed(2)}
                      </span>
                      <span 
                        className="w-12 text-right text-[10px] font-bold"
                        style={{ color: PDF_COLORS.greenDark }}
                      >
                        {q.pct45}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Score Distribution Breakdown (5 cols) */}
            <div 
              className="col-span-5 rounded-xl p-3.5 flex flex-col justify-between"
              style={{ 
                backgroundColor: PDF_COLORS.cardBg, 
                border: `1px solid ${PDF_COLORS.border}` 
              }}
            >
              <div>
                <div className="flex justify-between items-center mb-2.5">
                  <h3 className="text-xs font-bold" style={{ color: PDF_COLORS.textDark }}>
                    การกระจายคะแนนรวม
                  </h3>
                  <span className="text-[10px] font-medium" style={{ color: PDF_COLORS.textMuted }}>
                    1–5 ดาว
                  </span>
                </div>

                <div className="space-y-2">
                  {analysis.distribution.map(d => {
                    const distColor = d.score === 5 
                      ? PDF_COLORS.green 
                      : d.score === 4 
                      ? PDF_COLORS.blue 
                      : d.score === 3 
                      ? PDF_COLORS.amber 
                      : d.score === 2 
                      ? PDF_COLORS.orange 
                      : PDF_COLORS.rose;

                    return (
                      <div key={d.score} className="space-y-0.5">
                        <div className="flex justify-between text-xs">
                          <span className="font-semibold text-[11px]" style={{ color: PDF_COLORS.textSecondary }}>
                            {d.score} คะแนน
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-[11px]" style={{ color: PDF_COLORS.textDark }}>
                              {d.percentage}%
                            </span>
                            <span className="text-[10px]" style={{ color: PDF_COLORS.textSubtle }}>
                              ({d.count} ครั้ง)
                            </span>
                          </div>
                        </div>
                        <div 
                          className="h-2 rounded-full overflow-hidden"
                          style={{ backgroundColor: PDF_COLORS.borderLight }}
                        >
                          <div 
                            className="h-full rounded-full"
                            style={{ 
                              width: `${d.percentage}%`,
                              backgroundColor: distColor 
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div 
                className="pt-2 mt-2 flex justify-between items-center text-[11px]"
                style={{ borderTop: `1px solid ${PDF_COLORS.borderLight}` }}
              >
                <span style={{ color: PDF_COLORS.textMuted }}>พึงพอใจ 4–5 คะแนน:</span>
                <span className="font-black" style={{ color: PDF_COLORS.greenDark }}>
                  {analysis.pct45Overall}%
                </span>
              </div>
            </div>
          </div>

          {/* Executive Interpretation Box */}
          <div 
            className="rounded-r-xl p-3.5 mb-5"
            style={{ 
              backgroundColor: PDF_COLORS.softBg, 
              borderLeft: `4px solid ${PDF_COLORS.buRed}` 
            }}
          >
            <h3 
              className="text-xs font-bold uppercase tracking-wider mb-1"
              style={{ color: PDF_COLORS.textDark }}
            >
              บทวิเคราะห์สรุปผลภาพรวมเชิงบริหาร (Executive Interpretation)
            </h3>
            <p 
              className="text-xs leading-relaxed text-justify"
              style={{ color: PDF_COLORS.textPrimary }}
            >
              {analysis.executiveSummaryText}
            </p>
          </div>

          {/* Course Operational Summary Strip */}
          <div 
            className="rounded-xl p-3.5 mb-4"
            style={{ 
              backgroundColor: PDF_COLORS.cardBg, 
              border: `1px solid ${PDF_COLORS.border}` 
            }}
          >
            <h3 className="text-xs font-bold mb-2" style={{ color: PDF_COLORS.textDark }}>
              สรุปการดำเนินงานของหลักสูตร (Course Operational Summary)
            </h3>
            <div className="grid grid-cols-5 gap-2 text-center text-xs">
              <div 
                className="p-2 rounded-lg"
                style={{ 
                  backgroundColor: PDF_COLORS.softBg, 
                  border: `1px solid ${PDF_COLORS.borderLight}` 
                }}
              >
                <span className="text-[10px] block mb-0.5" style={{ color: PDF_COLORS.textMuted }}>ผู้ลงทะเบียน</span>
                <strong className="text-sm font-bold" style={{ color: PDF_COLORS.textDark }}>
                  {operationalStats.totalRegistrations} คน
                </strong>
              </div>

              <div 
                className="p-2 rounded-lg"
                style={{ 
                  backgroundColor: PDF_COLORS.softBg, 
                  border: `1px solid ${PDF_COLORS.borderLight}` 
                }}
              >
                <span className="text-[10px] block mb-0.5" style={{ color: PDF_COLORS.textMuted }}>ผู้เข้าอบรมจริง</span>
                <strong className="text-sm font-bold" style={{ color: PDF_COLORS.greenDark }}>
                  {operationalStats.totalAttendees} คน
                </strong>
              </div>

              <div 
                className="p-2 rounded-lg"
                style={{ 
                  backgroundColor: PDF_COLORS.softBg, 
                  border: `1px solid ${PDF_COLORS.borderLight}` 
                }}
              >
                <span className="text-[10px] block mb-0.5" style={{ color: PDF_COLORS.textMuted }}>Attendance rate</span>
                <strong className="text-sm font-bold" style={{ color: PDF_COLORS.textDark }}>
                  {operationalStats.attendanceRate}%
                </strong>
              </div>

              <div 
                className="p-2 rounded-lg"
                style={{ 
                  backgroundColor: PDF_COLORS.softBg, 
                  border: `1px solid ${PDF_COLORS.borderLight}` 
                }}
              >
                <span className="text-[10px] block mb-0.5" style={{ color: PDF_COLORS.textMuted }}>ผู้ตอบประเมิน</span>
                <strong className="text-sm font-bold" style={{ color: PDF_COLORS.textDark }}>
                  {operationalStats.totalEvals} รายการ
                </strong>
              </div>

              <div 
                className="p-2 rounded-lg"
                style={{ 
                  backgroundColor: PDF_COLORS.softBg, 
                  border: `1px solid ${PDF_COLORS.borderLight}` 
                }}
              >
                <span className="text-[10px] block mb-0.5" style={{ color: PDF_COLORS.textMuted }}>Response rate</span>
                <strong className="text-sm font-bold" style={{ color: PDF_COLORS.buRed }}>
                  {operationalStats.responseRate}%
                </strong>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div 
          className="pt-3 flex justify-between items-center text-[10px]"
          style={{ 
            borderTop: `1px solid ${PDF_COLORS.border}`,
            color: PDF_COLORS.textSubtle
          }}
        >
          <span>ฝ่ายพัฒนาวิชาการ มหาวิทยาลัยกรุงเทพ (BU Academic Training) • ข้อมูลคุ้มครองความเป็นส่วนตัว</span>
          <span>หน้า 1 จาก 1</span>
        </div>
      </div>
    </div>
  );
};
