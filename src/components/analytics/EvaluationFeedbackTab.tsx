import React, { useState } from "react";
import { EvaluationAnalysisResult, AnalyzedComment } from "../../lib/evaluationAnalytics";
import { MessageSquare, ThumbsUp, Lightbulb, AlertTriangle, Tag, Quote, CheckCircle, ArrowRight } from "lucide-react";

interface EvaluationFeedbackTabProps {
  analysis: EvaluationAnalysisResult;
  onNavigateToCommentsTab?: () => void;
}

export const EvaluationFeedbackTab: React.FC<EvaluationFeedbackTabProps> = ({
  analysis,
  onNavigateToCommentsTab
}) => {
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);

  const displayedComments = selectedTheme
    ? analysis.comments.filter(c => c.matchedThemes.includes(selectedTheme))
    : analysis.comments;

  const topPositives = analysis.comments.filter(c => c.sentiment === 'positive').slice(0, 3);
  const topNeutrals = analysis.comments.filter(c => c.sentiment === 'neutral').slice(0, 3);
  const topNegatives = analysis.comments.filter(c => c.sentiment === 'negative').slice(0, 2);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Transparency Note */}
      <div className="bg-slate-50 border border-slate-200/80 rounded-2xl px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-xs text-slate-600">
          <span className="w-2 h-2 rounded-full bg-crimson" />
          <span className="font-semibold text-slate-800">การจัดกลุ่มความคิดเห็น (Comment Classification):</span>
          <span>วิเคราะห์และจัดกลุ่มอัตโนมัติด้วยแบบจำลองพจนานุกรมความหมายภาษาไทย (Deterministic Rule-Based Analysis)</span>
        </div>
        <span className="text-[11px] font-bold text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded">
          Client-Side V1
        </span>
      </div>

      {/* 4 Classification Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              ความคิดเห็นทั้งหมด
            </span>
            <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-800">
              {analysis.commentStats.totalComments}
            </span>
            <span className="text-slate-400 text-xs">ข้อความ</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">จากผู้ตอบแบบประเมินทั้งหมด</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
              เชิงบวก / ชื่นชม
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ThumbsUp className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-600">
              {analysis.commentStats.positivePct}%
            </span>
            <span className="text-slate-400 text-xs font-medium">({analysis.commentStats.positiveCount} ข้อความ)</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">ประทับใจวิทยากรและเนื้อหา</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">
              ข้อเสนอแนะพัฒนา
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Lightbulb className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-blue-600">
              {analysis.commentStats.neutralPct}%
            </span>
            <span className="text-slate-400 text-xs font-medium">({analysis.commentStats.neutralCount} ข้อความ)</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">ข้อเสนอแนะหลักสูตรและเวลา</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-rose-700 uppercase tracking-wider">
              ข้อควรปรับปรุง
            </span>
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-rose-600">
              {analysis.commentStats.negativePct}%
            </span>
            <span className="text-slate-400 text-xs font-medium">({analysis.commentStats.negativeCount} ข้อความ)</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">จุดที่ควรระวังในรุ่นถัดไป</p>
        </div>
      </div>

      {/* Recurring Themes Tags */}
      {analysis.recurringThemes.length > 0 && (
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-crimson" />
              <h3 className="text-sm font-bold text-slate-800">
                ประเด็นที่พบซ้ำบ่อยในความคิดเห็น (Recurring Themes)
              </h3>
            </div>
            {selectedTheme && (
              <button
                onClick={() => setSelectedTheme(null)}
                className="text-xs text-crimson font-medium hover:underline"
              >
                ล้างตัวกรองหมวดหมู่
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2.5">
            {analysis.recurringThemes.map((themeItem, idx) => {
              const isSelected = selectedTheme === themeItem.theme;
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedTheme(isSelected ? null : themeItem.theme)}
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    isSelected
                      ? 'bg-crimson text-white shadow-sm'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  <span>{themeItem.theme}</span>
                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-white text-slate-600'
                  }`}>
                    {themeItem.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Representative Feedback Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Positive Highlights */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100 text-emerald-800">
            <ThumbsUp className="w-5 h-5 text-emerald-600" />
            <h3 className="text-sm font-bold">ตัวอย่างความคิดเห็นเชิงบวกและชื่นชม</h3>
          </div>

          <div className="space-y-3">
            {topPositives.map((c, i) => (
              <div key={i} className="p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100/80 relative">
                <Quote className="w-5 h-5 text-emerald-300 absolute right-3 top-3 opacity-40" />
                <p className="text-xs text-slate-700 leading-relaxed font-normal">
                  "{c.text}"
                </p>
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-emerald-100 text-[10px] text-slate-400">
                  <span className="font-semibold text-emerald-700">ลำดับที่ {c.index}</span>
                  {c.matchedThemes.map((t, ti) => (
                    <span key={ti} className="bg-emerald-100/70 text-emerald-800 px-1.5 py-0.5 rounded">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {topPositives.length === 0 && (
              <p className="text-xs text-slate-400 italic py-4 text-center">- ไม่มีข้อความเชิงบวกเพิ่มเติม -</p>
            )}
          </div>
        </div>

        {/* Constructive & Improvement Highlights */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100 text-blue-800">
            <Lightbulb className="w-5 h-5 text-blue-600" />
            <h3 className="text-sm font-bold">ตัวอย่างข้อเสนอแนะและจุดที่ควรระวัง</h3>
          </div>

          <div className="space-y-3">
            {topNeutrals.concat(topNegatives).map((c, i) => (
              <div
                key={i}
                className={`p-4 rounded-2xl border relative ${
                  c.sentiment === 'negative'
                    ? 'bg-rose-50/50 border-rose-100/80'
                    : 'bg-blue-50/50 border-blue-100/80'
                }`}
              >
                <Quote className={`w-5 h-5 absolute right-3 top-3 opacity-40 ${
                  c.sentiment === 'negative' ? 'text-rose-300' : 'text-blue-300'
                }`} />
                <p className="text-xs text-slate-700 leading-relaxed font-normal">
                  "{c.text}"
                </p>
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200/50 text-[10px] text-slate-400">
                  <span className={`font-semibold ${c.sentiment === 'negative' ? 'text-rose-700' : 'text-blue-700'}`}>
                    {c.sentimentLabel} (ลำดับที่ {c.index})
                  </span>
                  {c.matchedThemes.map((t, ti) => (
                    <span key={ti} className="bg-white/80 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200/60">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {topNeutrals.length === 0 && topNegatives.length === 0 && (
              <p className="text-xs text-slate-400 italic py-4 text-center">- ไม่มีข้อเสนอแนะเพิ่มเติม -</p>
            )}
          </div>
        </div>
      </div>

      {/* Actionable Recommendations for Management */}
      <div className="bg-white p-7 rounded-3xl border border-slate-200 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-crimson/10 text-crimson flex items-center justify-center">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">
              ข้อเสนอแนะเชิงปฏิบัติการเพื่อการพัฒนาหลักสูตร (Actionable Recommendations)
            </h3>
            <p className="text-xs text-slate-500">
              ข้อสังเกตและแนวทางปรับปรุงที่สังเคราะห์จากคะแนนประเมินและข้อคิดเห็นของผู้เข้าอบรม
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Strengths */}
          <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-5 space-y-3">
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider block">
              1. จุดเด่นที่ควรรักษาไว้ (Strengths)
            </span>
            <ul className="space-y-2 text-xs text-slate-700 leading-relaxed">
              {analysis.actionableRecommendations.strengths.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-emerald-500 font-bold shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Card 2: Improvements */}
          <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-5 space-y-3">
            <span className="text-xs font-bold text-amber-800 uppercase tracking-wider block">
              2. ข้อควรปรับปรุงในรุ่นถัดไป (Improvements)
            </span>
            <ul className="space-y-2 text-xs text-slate-700 leading-relaxed">
              {analysis.actionableRecommendations.improvements.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-amber-500 font-bold shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Card 3: Future Offerings */}
          <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-5 space-y-3">
            <span className="text-xs font-bold text-blue-800 uppercase tracking-wider block">
              3. ข้อเสนอแนะเชิงต่อยอด (Future Topics)
            </span>
            <ul className="space-y-2 text-xs text-slate-700 leading-relaxed">
              {analysis.actionableRecommendations.futureTopics.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-blue-500 font-bold shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {onNavigateToCommentsTab && (
          <div className="pt-2 text-center">
            <button
              onClick={onNavigateToCommentsTab}
              className="inline-flex items-center gap-2 text-xs font-bold text-crimson hover:underline"
            >
              ดูข้อคิดเห็นทั้งหมดในภาคผนวก ({analysis.commentStats.totalComments} รายการ)
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
