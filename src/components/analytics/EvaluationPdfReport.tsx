import React from "react";
import { Course } from "../../types";
import { EvaluationAnalysisResult } from "../../lib/evaluationAnalytics";
import { PDF_COLORS } from "./OverviewPdfReport";

interface EvaluationPdfReportProps {
  course: Course;
  analysis: EvaluationAnalysisResult;
  questions: string[];
}

export const EvaluationPdfReport: React.FC<EvaluationPdfReportProps> = ({
  course,
  analysis
}) => {
  const currentDateStr = new Date().toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  // Split comments into chunks for appendix pages (e.g. 10-12 comments per page)
  const COMMENTS_PER_PAGE = 10;
  const commentChunks: typeof analysis.comments[] = [];
  if (analysis.comments.length > 0) {
    for (let i = 0; i < analysis.comments.length; i += COMMENTS_PER_PAGE) {
      commentChunks.push(analysis.comments.slice(i, i + COMMENTS_PER_PAGE));
    }
  }

  const totalPages = 3 + (commentChunks.length > 0 ? commentChunks.length : 1);

  return (
    <div 
      id="evaluation-pdf-report" 
      style={{ 
        width: "794px", 
        color: PDF_COLORS.textPrimary, 
        backgroundColor: PDF_COLORS.cardBg,
        fontFamily: '"Prompt", "Kanit", system-ui, -apple-system, sans-serif' 
      }}
    >
      {/* PAGE 1: EXECUTIVE SUMMARY */}
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
            className="pb-4 mb-6 flex justify-between items-end"
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
                  BU Academic Training • Executive Analytics Report
                </span>
              </div>
              <h1 
                className="text-2xl font-black leading-tight"
                style={{ color: PDF_COLORS.textDark }}
              >
                รายงานสรุปผลการประเมินโครงการอบรมวิชาการ
              </h1>
              <p 
                className="text-sm font-semibold mt-1"
                style={{ color: PDF_COLORS.textSecondary }}
              >
                "{course.title}"
              </p>
            </div>
            <div 
              className="text-right text-xs"
              style={{ color: PDF_COLORS.textMuted }}
            >
              <p><span className="font-semibold" style={{ color: PDF_COLORS.textPrimary }}>วันที่จัดอบรม:</span> {course.date || "ไม่ระบุ"}</p>
              <p><span className="font-semibold" style={{ color: PDF_COLORS.textPrimary }}>วิทยากร:</span> {course.instructorName || "ไม่ระบุ"}</p>
              <p><span className="font-semibold" style={{ color: PDF_COLORS.textPrimary }}>วันที่จัดทำรายงาน:</span> {currentDateStr}</p>
            </div>
          </div>

          {/* Section Title */}
          <div className="mb-4">
            <h2 className="text-base font-bold uppercase tracking-wide flex items-center gap-2" style={{ color: PDF_COLORS.textDark }}>
              <span className="font-black" style={{ color: PDF_COLORS.buRed }}>ส่วนที่ 1:</span> บทสรุปภาพรวมเชิงบริหาร (Executive Summary)
            </h2>
          </div>

          {/* 4 KPI Cards */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div 
              className="rounded-xl p-3.5 text-center"
              style={{ backgroundColor: PDF_COLORS.softBg, border: `1px solid ${PDF_COLORS.border}` }}
            >
              <span className="text-xs font-semibold block mb-1" style={{ color: PDF_COLORS.textMuted }}>ผู้ตอบแบบประเมิน</span>
              <span className="text-2xl font-black" style={{ color: PDF_COLORS.textDark }}>{analysis.totalResponses}</span>
              <span className="text-xs block mt-0.5" style={{ color: PDF_COLORS.textSubtle }}>คน</span>
            </div>

            <div 
              className="rounded-xl p-3.5 text-center"
              style={{ backgroundColor: PDF_COLORS.softBg, border: `1px solid ${PDF_COLORS.border}` }}
            >
              <span className="text-xs font-semibold block mb-1" style={{ color: PDF_COLORS.textMuted }}>คะแนนเฉลี่ยรวม</span>
              <div className="flex items-center justify-center gap-1">
                <span className="text-2xl font-black" style={{ color: PDF_COLORS.buRed }}>{analysis.overallAverage.toFixed(2)}</span>
                <span className="text-xs" style={{ color: PDF_COLORS.textSubtle }}>/5.00</span>
              </div>
              <span 
                className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: PDF_COLORS.greenBg, color: PDF_COLORS.greenText, border: `1px solid ${PDF_COLORS.greenBorder}` }}
              >
                {analysis.overallLevel.label}
              </span>
            </div>

            <div 
              className="rounded-xl p-3.5 text-center"
              style={{ backgroundColor: PDF_COLORS.softBg, border: `1px solid ${PDF_COLORS.border}` }}
            >
              <span className="text-xs font-semibold block mb-1" style={{ color: PDF_COLORS.textMuted }}>ให้คะแนนเต็ม 5</span>
              <span className="text-2xl font-black" style={{ color: PDF_COLORS.textDark }}>{analysis.pct5Overall}%</span>
              <span className="text-xs block mt-0.5" style={{ color: PDF_COLORS.textSubtle }}>ระดับความพึงพอใจสูงสุด</span>
            </div>

            <div 
              className="rounded-xl p-3.5 text-center"
              style={{ backgroundColor: PDF_COLORS.softBg, border: `1px solid ${PDF_COLORS.border}` }}
            >
              <span className="text-xs font-semibold block mb-1" style={{ color: PDF_COLORS.textMuted }}>พึงพอใจระดับ 4-5</span>
              <span className="text-2xl font-black" style={{ color: PDF_COLORS.greenDark }}>{analysis.pct45Overall}%</span>
              <span className="text-xs block mt-0.5" style={{ color: PDF_COLORS.textSubtle }}>ระดับดีถึงดีมาก</span>
            </div>
          </div>

          {/* Executive Interpretation Box */}
          <div 
            className="rounded-r-xl p-4 mb-6"
            style={{ backgroundColor: PDF_COLORS.softBg, borderLeft: `4px solid ${PDF_COLORS.buRed}` }}
          >
            <h3 className="text-xs font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: PDF_COLORS.textDark }}>
              บทวิเคราะห์สรุปผลภาพรวม
            </h3>
            <p className="text-xs leading-relaxed text-justify" style={{ color: PDF_COLORS.textPrimary }}>
              {analysis.executiveSummaryText}
            </p>
          </div>

          {/* Score Distribution Breakdown */}
          <div 
            className="mb-6 rounded-xl p-4"
            style={{ backgroundColor: PDF_COLORS.cardBg, border: `1px solid ${PDF_COLORS.border}` }}
          >
            <h3 className="text-xs font-bold mb-3 flex justify-between items-center" style={{ color: PDF_COLORS.textDark }}>
              <span>การกระจายตัวของระดับคะแนนทั้งหมด (Overall Rating Distribution)</span>
              <span className="text-[11px] font-normal" style={{ color: PDF_COLORS.textMuted }}>รวมทุกข้อคำถาม</span>
            </h3>
            <div className="space-y-2">
              {analysis.distribution.map(d => {
                const barColor = d.score === 5 ? PDF_COLORS.green : d.score === 4 ? PDF_COLORS.blue : d.score === 3 ? PDF_COLORS.amber : d.score === 2 ? PDF_COLORS.orange : PDF_COLORS.rose;
                return (
                  <div key={d.score} className="flex items-center gap-3 text-xs">
                    <span className="w-16 font-semibold" style={{ color: PDF_COLORS.textSecondary }}>{d.score} คะแนน</span>
                    <div className="flex-1 h-3.5 rounded-full overflow-hidden" style={{ backgroundColor: PDF_COLORS.borderLight }}>
                      <div 
                        className="h-full rounded-full"
                        style={{ width: `${d.percentage}%`, backgroundColor: barColor }}
                      />
                    </div>
                    <span className="w-12 text-right font-bold" style={{ color: PDF_COLORS.textDark }}>{d.percentage}%</span>
                    <span className="w-16 text-right text-[11px]" style={{ color: PDF_COLORS.textSubtle }}>({d.count} ครั้ง)</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3 Core Dimensions */}
          <div 
            className="rounded-xl p-4"
            style={{ backgroundColor: PDF_COLORS.cardBg, border: `1px solid ${PDF_COLORS.border}` }}
          >
            <h3 className="text-xs font-bold mb-3" style={{ color: PDF_COLORS.textDark }}>
              คะแนนเฉลี่ยจำแนกตามมิติการประเมิน (Evaluation Dimensions)
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {analysis.dimensions.map((dim, i) => (
                <div 
                  key={i} 
                  className="rounded-lg p-3"
                  style={{ backgroundColor: PDF_COLORS.softBg, border: `1px solid ${PDF_COLORS.borderLight}` }}
                >
                  <span className="text-[11px] font-bold block truncate" style={{ color: PDF_COLORS.textDark }}>{dim.title}</span>
                  <p className="text-[10px] mb-2 truncate" style={{ color: PDF_COLORS.textMuted }}>{dim.description}</p>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-lg font-black" style={{ color: PDF_COLORS.textDark }}>{dim.average.toFixed(2)}</span>
                    <span className="text-[10px] font-semibold" style={{ color: PDF_COLORS.greenDark }}>{dim.pct45}% ให้ 4-5</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: PDF_COLORS.borderLight }}>
                    <div 
                      className="h-full rounded-full" 
                      style={{ width: `${(dim.average / 5) * 100}%`, backgroundColor: PDF_COLORS.buRed }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div 
          className="pt-4 flex justify-between items-center text-[10px]"
          style={{ borderTop: `1px solid ${PDF_COLORS.border}`, color: PDF_COLORS.textSubtle }}
        >
          <span>ระบบประเมินผลการอบรมวิชาการ มหาวิทยาลัยกรุงเทพ (BU Academic Training)</span>
          <span>หน้า 1 จาก {totalPages}</span>
        </div>
      </div>

      {/* PAGE 2: RATING DETAIL */}
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
            className="pb-3 mb-6 flex justify-between items-end"
            style={{ borderBottom: `2px solid ${PDF_COLORS.buRed}` }}
          >
            <div>
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: PDF_COLORS.buRed }}>
                BU Academic Training • Rating Detail Analysis
              </span>
              <h1 className="text-xl font-black leading-tight" style={{ color: PDF_COLORS.textDark }}>
                รายละเอียดคะแนนประเมินรายข้อ
              </h1>
            </div>
            <div className="text-right text-xs" style={{ color: PDF_COLORS.textMuted }}>
              <span className="font-semibold" style={{ color: PDF_COLORS.textPrimary }}>{course.title}</span>
            </div>
          </div>

          <div className="mb-4">
            <h2 className="text-base font-bold uppercase tracking-wide flex items-center gap-2" style={{ color: PDF_COLORS.textDark }}>
              <span className="font-black" style={{ color: PDF_COLORS.buRed }}>ส่วนที่ 2:</span> ตารางสรุปคะแนนประเมินรายข้อ (Per-Question Analysis)
            </h2>
          </div>

          {/* Table */}
          <div 
            className="rounded-xl overflow-hidden mb-6"
            style={{ border: `1px solid ${PDF_COLORS.border}` }}
          >
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr style={{ backgroundColor: PDF_COLORS.softBg, color: PDF_COLORS.textPrimary, borderBottom: `1px solid ${PDF_COLORS.border}` }}>
                  <th className="py-2.5 px-3 w-8 text-center font-bold">ข้อ</th>
                  <th className="py-2.5 px-3 font-bold">หัวข้อการประเมิน</th>
                  <th className="py-2.5 px-2 text-center w-14 font-bold">เฉลี่ย</th>
                  <th className="py-2.5 px-2 text-center w-12 font-bold">% (5)</th>
                  <th className="py-2.5 px-2 text-center w-14 font-bold">% (4-5)</th>
                  <th className="py-2.5 px-3 text-center w-28 font-bold">สัดส่วนคะแนน (1-5)</th>
                </tr>
              </thead>
              <tbody>
                {analysis.questionStats.map((q, idx) => (
                  <tr 
                    key={idx} 
                    style={{ 
                      backgroundColor: idx % 2 === 0 ? PDF_COLORS.cardBg : PDF_COLORS.softBg,
                      borderBottom: `1px solid ${PDF_COLORS.borderLight}` 
                    }}
                  >
                    <td className="py-2 px-3 font-bold text-center" style={{ color: PDF_COLORS.textMuted }}>{idx + 1}</td>
                    <td className="py-2 px-3 font-medium leading-snug" style={{ color: PDF_COLORS.textDark }}>
                      {q.question}
                    </td>
                    <td className="py-2 px-2 text-center font-bold" style={{ color: PDF_COLORS.textDark }}>
                      {q.average.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-center font-semibold" style={{ color: PDF_COLORS.textMuted }}>
                      {q.pct5}%
                    </td>
                    <td className="py-2 px-2 text-center font-bold" style={{ color: PDF_COLORS.greenDark }}>
                      {q.pct45}%
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex h-3 rounded-full overflow-hidden" style={{ backgroundColor: PDF_COLORS.borderLight }}>
                        <div style={{ width: `${((q.distribution[5] || 0) / q.count) * 100}%`, backgroundColor: PDF_COLORS.green }} />
                        <div style={{ width: `${((q.distribution[4] || 0) / q.count) * 100}%`, backgroundColor: PDF_COLORS.blue }} />
                        <div style={{ width: `${((q.distribution[3] || 0) / q.count) * 100}%`, backgroundColor: PDF_COLORS.amber }} />
                        <div style={{ width: `${((q.distribution[2] || 0) / q.count) * 100}%`, backgroundColor: PDF_COLORS.orange }} />
                        <div style={{ width: `${((q.distribution[1] || 0) / q.count) * 100}%`, backgroundColor: PDF_COLORS.rose }} />
                      </div>
                      <div className="flex justify-between text-[9px] mt-0.5 px-0.5" style={{ color: PDF_COLORS.textSubtle }}>
                        <span>5: {q.distribution[5] || 0}</span>
                        <span>4: {q.distribution[4] || 0}</span>
                        <span>3: {q.distribution[3] || 0}</span>
                        <span>&le;2: {(q.distribution[2] || 0) + (q.distribution[1] || 0)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Highlights & Key takeaways */}
          <div className="grid grid-cols-2 gap-4">
            <div 
              className="rounded-xl p-3.5"
              style={{ backgroundColor: PDF_COLORS.greenBg, border: `1px solid ${PDF_COLORS.greenBorder}` }}
            >
              <span className="text-[11px] font-bold uppercase tracking-wider block mb-1" style={{ color: PDF_COLORS.greenText }}>
                ★ หัวข้อที่ได้คะแนนสูงสุด (Highest Rated)
              </span>
              <p className="text-xs font-bold mb-1" style={{ color: PDF_COLORS.textDark }}>
                {analysis.highestQuestion?.question || "-"}
              </p>
              <div className="flex items-center gap-2 text-xs" style={{ color: PDF_COLORS.textSecondary }}>
                <span>คะแนนเฉลี่ย: <strong style={{ color: PDF_COLORS.greenDark }}>{analysis.highestQuestion?.average.toFixed(2)}</strong>/5.00</span>
                <span>•</span>
                <span>{analysis.highestQuestion?.pct45}% พึงพอใจระดับ 4-5</span>
              </div>
            </div>

            <div 
              className="rounded-xl p-3.5"
              style={{ backgroundColor: PDF_COLORS.blueBg, border: `1px solid ${PDF_COLORS.blueBorder}` }}
            >
              <span className="text-[11px] font-bold uppercase tracking-wider block mb-1" style={{ color: PDF_COLORS.blueText }}>
                ▲ หัวข้อที่มีโอกาสพัฒนา (Development Opportunity)
              </span>
              <p className="text-xs font-bold mb-1" style={{ color: PDF_COLORS.textDark }}>
                {analysis.lowestQuestion?.question || "-"}
              </p>
              <div className="flex items-center gap-2 text-xs" style={{ color: PDF_COLORS.textSecondary }}>
                <span>คะแนนเฉลี่ย: <strong style={{ color: PDF_COLORS.blueDark }}>{analysis.lowestQuestion?.average.toFixed(2)}</strong>/5.00</span>
                <span>•</span>
                <span>{analysis.lowestQuestion?.pct45}% พึงพอใจระดับ 4-5</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div 
          className="pt-4 flex justify-between items-center text-[10px]"
          style={{ borderTop: `1px solid ${PDF_COLORS.border}`, color: PDF_COLORS.textSubtle }}
        >
          <span>ระบบประเมินผลการอบรมวิชาการ มหาวิทยาลัยกรุงเทพ (BU Academic Training)</span>
          <span>หน้า 2 จาก {totalPages}</span>
        </div>
      </div>

      {/* PAGE 3: COMMENT ANALYSIS & RECOMMENDATIONS */}
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
            className="pb-3 mb-6 flex justify-between items-end"
            style={{ borderBottom: `2px solid ${PDF_COLORS.buRed}` }}
          >
            <div>
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: PDF_COLORS.buRed }}>
                BU Academic Training • Comments & Insights
              </span>
              <h1 className="text-xl font-black leading-tight" style={{ color: PDF_COLORS.textDark }}>
                การวิเคราะห์ความคิดเห็นและข้อเสนอแนะเชิงปฏิบัติการ
              </h1>
            </div>
            <div className="text-right text-xs" style={{ color: PDF_COLORS.textMuted }}>
              <span className="font-semibold" style={{ color: PDF_COLORS.textPrimary }}>{course.title}</span>
            </div>
          </div>

          <div className="mb-4">
            <h2 className="text-base font-bold uppercase tracking-wide flex items-center gap-2" style={{ color: PDF_COLORS.textDark }}>
              <span className="font-black" style={{ color: PDF_COLORS.buRed }}>ส่วนที่ 3:</span> การจัดกลุ่มความคิดเห็นและข้อเสนอแนะ
            </h2>
          </div>

          {/* Sentiment Summary Stats */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div 
              className="rounded-xl p-3 text-center"
              style={{ backgroundColor: PDF_COLORS.softBg, border: `1px solid ${PDF_COLORS.border}` }}
            >
              <span className="text-[11px] font-semibold block mb-0.5" style={{ color: PDF_COLORS.textMuted }}>ความคิดเห็นทั้งหมด</span>
              <span className="text-xl font-bold" style={{ color: PDF_COLORS.textDark }}>{analysis.commentStats.totalComments}</span>
              <span className="text-[10px] block" style={{ color: PDF_COLORS.textSubtle }}>ข้อความ</span>
            </div>
            <div 
              className="rounded-xl p-3 text-center"
              style={{ backgroundColor: PDF_COLORS.greenBg, border: `1px solid ${PDF_COLORS.greenBorder}` }}
            >
              <span className="text-[11px] font-semibold block mb-0.5" style={{ color: PDF_COLORS.greenText }}>เชิงบวก / ชื่นชม</span>
              <span className="text-xl font-bold" style={{ color: PDF_COLORS.greenDark }}>{analysis.commentStats.positiveCount}</span>
              <span className="text-[10px] block" style={{ color: PDF_COLORS.greenText }}>{analysis.commentStats.positivePct}%</span>
            </div>
            <div 
              className="rounded-xl p-3 text-center"
              style={{ backgroundColor: PDF_COLORS.blueBg, border: `1px solid ${PDF_COLORS.blueBorder}` }}
            >
              <span className="text-[11px] font-semibold block mb-0.5" style={{ color: PDF_COLORS.blueText }}>ข้อเสนอแนะพัฒนา</span>
              <span className="text-xl font-bold" style={{ color: PDF_COLORS.blueDark }}>{analysis.commentStats.neutralCount}</span>
              <span className="text-[10px] block" style={{ color: PDF_COLORS.blueText }}>{analysis.commentStats.neutralPct}%</span>
            </div>
            <div 
              className="rounded-xl p-3 text-center"
              style={{ backgroundColor: PDF_COLORS.roseBg, border: `1px solid ${PDF_COLORS.roseBorder}` }}
            >
              <span className="text-[11px] font-semibold block mb-0.5" style={{ color: PDF_COLORS.roseText }}>ข้อควรปรับปรุง</span>
              <span className="text-xl font-bold" style={{ color: PDF_COLORS.roseDark }}>{analysis.commentStats.negativeCount}</span>
              <span className="text-[10px] block" style={{ color: PDF_COLORS.roseText }}>{analysis.commentStats.negativePct}%</span>
            </div>
          </div>

          {/* Recurring Themes */}
          {analysis.recurringThemes.length > 0 && (
            <div 
              className="mb-5 rounded-xl p-3.5"
              style={{ backgroundColor: PDF_COLORS.cardBg, border: `1px solid ${PDF_COLORS.border}` }}
            >
              <h3 className="text-xs font-bold mb-2" style={{ color: PDF_COLORS.textDark }}>
                ประเด็นที่พบซ้ำบ่อยในความคิดเห็น (Recurring Themes)
              </h3>
              <div className="flex flex-wrap gap-2">
                {analysis.recurringThemes.map((th, i) => (
                  <span 
                    key={i} 
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs"
                    style={{ backgroundColor: PDF_COLORS.softBg, border: `1px solid ${PDF_COLORS.border}`, color: PDF_COLORS.textPrimary }}
                  >
                    <span className="font-semibold">{th.theme}</span>
                    <span 
                      className="font-bold px-1.5 py-0.2 rounded text-[10px]"
                      style={{ backgroundColor: PDF_COLORS.borderLight, color: PDF_COLORS.textDark }}
                    >
                      {th.count} ครั้ง
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Representative Quotes */}
          <div className="mb-5">
            <h3 className="text-xs font-bold mb-2" style={{ color: PDF_COLORS.textDark }}>
              ตัวอย่างความคิดเห็นเด่น (Representative Feedback)
            </h3>
            <div className="space-y-2">
              {analysis.comments.slice(0, 3).map((c, i) => (
                <div 
                  key={i} 
                  className="rounded-lg p-2.5 flex items-start gap-2.5 text-xs"
                  style={{ backgroundColor: PDF_COLORS.softBg, border: `1px solid ${PDF_COLORS.border}` }}
                >
                  <span 
                    className="px-2 py-0.5 rounded text-[10px] font-bold shrink-0"
                    style={{ 
                      backgroundColor: c.sentiment === 'positive' ? PDF_COLORS.greenBg : c.sentiment === 'negative' ? PDF_COLORS.roseBg : PDF_COLORS.blueBg,
                      color: c.sentiment === 'positive' ? PDF_COLORS.greenText : c.sentiment === 'negative' ? PDF_COLORS.roseText : PDF_COLORS.blueText
                    }}
                  >
                    {c.sentimentLabel}
                  </span>
                  <p className="italic" style={{ color: PDF_COLORS.textPrimary }}>
                    "{c.text}"
                  </p>
                </div>
              ))}
              {analysis.comments.length === 0 && (
                <p className="text-xs italic py-4" style={{ color: PDF_COLORS.textSubtle }}>ไม่มีข้อเสนอแนะเพิ่มเติมจากผู้เข้าอบรม</p>
              )}
            </div>
          </div>

          {/* Actionable Recommendations */}
          <div 
            className="rounded-xl p-4"
            style={{ backgroundColor: PDF_COLORS.softBg, border: `1px solid ${PDF_COLORS.border}` }}
          >
            <h3 className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{ color: PDF_COLORS.textDark }}>
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: PDF_COLORS.buRed }} />
              ข้อเสนอแนะเชิงปฏิบัติการเพื่อการพัฒนา (Actionable Recommendations)
            </h3>
            <div className="space-y-2.5 text-xs">
              <div>
                <strong className="font-bold block mb-1" style={{ color: PDF_COLORS.greenDark }}>1. จุดเด่นที่ควรรักษาไว้ (Key Strengths):</strong>
                <ul className="list-disc list-inside pl-1 space-y-0.5" style={{ color: PDF_COLORS.textSecondary }}>
                  {analysis.actionableRecommendations.strengths.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              </div>

              <div>
                <strong className="font-bold block mb-1" style={{ color: PDF_COLORS.amberDark }}>2. ข้อควรปรับปรุงสำหรับรุ่นถัดไป (Areas for Improvement):</strong>
                <ul className="list-disc list-inside pl-1 space-y-0.5" style={{ color: PDF_COLORS.textSecondary }}>
                  {analysis.actionableRecommendations.improvements.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              </div>

              <div>
                <strong className="font-bold block mb-1" style={{ color: PDF_COLORS.blueDark }}>3. ข้อเสนอแนะเชิงต่อยอด (Future Recommendations):</strong>
                <ul className="list-disc list-inside pl-1 space-y-0.5" style={{ color: PDF_COLORS.textSecondary }}>
                  {analysis.actionableRecommendations.futureTopics.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div 
          className="pt-4 flex justify-between items-center text-[10px]"
          style={{ borderTop: `1px solid ${PDF_COLORS.border}`, color: PDF_COLORS.textSubtle }}
        >
          <span>ระบบประเมินผลการอบรมวิชาการ มหาวิทยาลัยกรุงเทพ (BU Academic Training)</span>
          <span>หน้า 3 จาก {totalPages}</span>
        </div>
      </div>

      {/* PAGE 4+: RAW COMMENTS APPENDIX */}
      {commentChunks.length > 0 ? (
        commentChunks.map((chunk, pageIndex) => (
          <div 
            key={pageIndex}
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
                className="pb-3 mb-6 flex justify-between items-end"
                style={{ borderBottom: `2px solid ${PDF_COLORS.buRed}` }}
              >
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: PDF_COLORS.buRed }}>
                    BU Academic Training • Comments Appendix
                  </span>
                  <h1 className="text-xl font-black leading-tight" style={{ color: PDF_COLORS.textDark }}>
                    ภาคผนวก: ข้อคิดเห็นและข้อเสนอแนะทั้งหมด
                  </h1>
                </div>
                <div className="text-right text-xs" style={{ color: PDF_COLORS.textMuted }}>
                  <span className="font-semibold" style={{ color: PDF_COLORS.textPrimary }}>{course.title}</span>
                </div>
              </div>

              <div className="mb-4 flex justify-between items-center">
                <h2 className="text-base font-bold uppercase tracking-wide flex items-center gap-2" style={{ color: PDF_COLORS.textDark }}>
                  <span className="font-black" style={{ color: PDF_COLORS.buRed }}>ภาคผนวก:</span> รายการความคิดเห็นทั้งหมด (หน้า {pageIndex + 1}/{commentChunks.length})
                </h2>
                <span className="text-[11px] italic" style={{ color: PDF_COLORS.textSubtle }}>
                  *ข้อมูลได้รับการคุ้มครองความเป็นส่วนตัว (ไม่แสดงชื่อและอีเมล)
                </span>
              </div>

              {/* Table of Comments */}
              <div 
                className="rounded-xl overflow-hidden mb-6"
                style={{ border: `1px solid ${PDF_COLORS.border}` }}
              >
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr style={{ backgroundColor: PDF_COLORS.softBg, color: PDF_COLORS.textPrimary, borderBottom: `1px solid ${PDF_COLORS.border}` }}>
                      <th className="py-2 px-3 w-12 text-center font-bold">ลำดับ</th>
                      <th className="py-2 px-3 w-28 text-center font-bold">การจัดกลุ่ม</th>
                      <th className="py-2 px-3 font-bold">ข้อคิดเห็นและข้อเสนอแนะ</th>
                      <th className="py-2 px-3 w-28 text-right font-bold">เวลาประเมิน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chunk.map((c) => (
                      <tr key={c.id} style={{ backgroundColor: PDF_COLORS.cardBg, borderBottom: `1px solid ${PDF_COLORS.borderLight}` }}>
                        <td className="py-2.5 px-3 font-bold text-center" style={{ color: PDF_COLORS.textMuted }}>{c.index}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span 
                            className="inline-block px-2 py-0.5 rounded text-[10px] font-bold"
                            style={{ 
                              backgroundColor: c.sentiment === 'positive' ? PDF_COLORS.greenBg : c.sentiment === 'negative' ? PDF_COLORS.roseBg : PDF_COLORS.blueBg,
                              color: c.sentiment === 'positive' ? PDF_COLORS.greenText : c.sentiment === 'negative' ? PDF_COLORS.roseText : PDF_COLORS.blueText
                            }}
                          >
                            {c.sentimentLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 leading-relaxed" style={{ color: PDF_COLORS.textPrimary }}>
                          {c.text}
                        </td>
                        <td className="py-2.5 px-3 text-right text-[11px] whitespace-nowrap" style={{ color: PDF_COLORS.textSubtle }}>
                          {c.createdAt ? new Date(c.createdAt).toLocaleDateString('th-TH') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div 
              className="pt-4 flex justify-between items-center text-[10px]"
              style={{ borderTop: `1px solid ${PDF_COLORS.border}`, color: PDF_COLORS.textSubtle }}
            >
              <span>ระบบประเมินผลการอบรมวิชาการ มหาวิทยาลัยกรุงเทพ (BU Academic Training)</span>
              <span>หน้า {4 + pageIndex} จาก {totalPages}</span>
            </div>
          </div>
        ))
      ) : (
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
            <div 
              className="pb-3 mb-6"
              style={{ borderBottom: `2px solid ${PDF_COLORS.buRed}` }}
            >
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: PDF_COLORS.buRed }}>
                BU Academic Training • Comments Appendix
              </span>
              <h1 className="text-xl font-black leading-tight" style={{ color: PDF_COLORS.textDark }}>
                ภาคผนวก: ข้อคิดเห็นและข้อเสนอแนะทั้งหมด
              </h1>
            </div>
            <div className="py-20 text-center" style={{ color: PDF_COLORS.textSubtle }}>
              <p>- ไม่พบข้อคิดเห็นหรือข้อเสนอแนะเพิ่มเติมสำหรับหลักสูตรนี้ -</p>
            </div>
          </div>
          <div 
            className="pt-4 flex justify-between items-center text-[10px]"
            style={{ borderTop: `1px solid ${PDF_COLORS.border}`, color: PDF_COLORS.textSubtle }}
          >
            <span>ระบบประเมินผลการอบรมวิชาการ มหาวิทยาลัยกรุงเทพ (BU Academic Training)</span>
            <span>หน้า 4 จาก 4</span>
          </div>
        </div>
      )}
    </div>
  );
};
