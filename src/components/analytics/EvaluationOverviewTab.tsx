import React from "react";
import { EvaluationAnalysisResult } from "../../lib/evaluationAnalytics";
import { Users, Award, Star, TrendingUp, ThumbsUp, ArrowUpRight, ArrowDownRight, CheckCircle2 } from "lucide-react";

interface EvaluationOverviewTabProps {
  analysis: EvaluationAnalysisResult;
  courseTitle: string;
}

export const EvaluationOverviewTab: React.FC<EvaluationOverviewTabProps> = ({
  analysis,
  courseTitle
}) => {
  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* 4 Main KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* KPI 1 */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0">
            <Users className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
              ผู้ตอบแบบประเมิน
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-800">{analysis.totalResponses}</span>
              <span className="text-slate-500 font-medium text-sm">คน</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">ครบถ้วนทุกข้อคำถาม</p>
          </div>
        </div>

        {/* KPI 2 */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-14 h-14 bg-crimson/10 text-crimson rounded-2xl flex items-center justify-center shrink-0">
            <Award className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
              คะแนนเฉลี่ยรวม
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-crimson">{analysis.overallAverage.toFixed(2)}</span>
              <span className="text-slate-400 font-medium text-sm">/ 5.00</span>
            </div>
            <span className={`inline-block mt-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${analysis.overallLevel.bg}`}>
              {analysis.overallLevel.label}
            </span>
          </div>
        </div>

        {/* KPI 3 */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center shrink-0">
            <Star className="w-7 h-7 fill-amber-500" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
              ให้คะแนนเต็ม 5 ดาว
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-800">{analysis.pct5Overall}%</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">ระดับความพึงพอใจสูงสุด</p>
          </div>
        </div>

        {/* KPI 4 */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
            <TrendingUp className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
              พึงพอใจระดับ 4-5 ดาว
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-emerald-600">{analysis.pct45Overall}%</span>
            </div>
            <p className="text-[11px] text-emerald-700 font-medium mt-0.5">ระดับดีถึงดีมาก</p>
          </div>
        </div>
      </div>

      {/* Executive Interpretation Narrative */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-3xl p-7 shadow-lg relative overflow-hidden">
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
            สรุปผลการประเมินโครงการอบรม: {courseTitle}
          </h3>
          <p className="text-slate-300 text-sm leading-relaxed max-w-4xl font-normal">
            {analysis.executiveSummaryText}
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-2 text-xs text-slate-400 border-t border-slate-700/60">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" /> เกณฑ์ผ่านตามมาตรฐานการประกันคุณภาพหลักสูตร
            </span>
            <span>•</span>
            <span>อัตราความพึงพอใจระดับสูง: <strong className="text-white">{analysis.pct45Overall}%</strong></span>
          </div>
        </div>
        <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-crimson/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* Grid: Rating Distribution & Key Dimensions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Rating Distribution (5 cols) */}
        <div className="lg:col-span-5 bg-white p-7 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-slate-800">สัดส่วนระดับคะแนน (1-5 ดาว)</h3>
                <p className="text-xs text-slate-400 mt-0.5">ภาพรวมจากคำตอบของผู้ประเมินทั้งหมด</p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg">
                5 ระดับ
              </span>
            </div>

            <div className="space-y-4">
              {analysis.distribution.map(d => (
                <div key={d.score} className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <Star className={`w-3.5 h-3.5 ${d.score >= 4 ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} />
                      {d.score} ดาว ({d.score === 5 ? 'มากที่สุด' : d.score === 4 ? 'มาก' : d.score === 3 ? 'ปานกลาง' : d.score === 2 ? 'น้อย' : 'น้อยที่สุด'})
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800">{d.percentage}%</span>
                      <span className="text-slate-400 text-[11px]">({d.count} ครั้ง)</span>
                    </div>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        d.score === 5 ? 'bg-emerald-500' :
                        d.score === 4 ? 'bg-blue-500' :
                        d.score === 3 ? 'bg-amber-400' :
                        d.score === 2 ? 'bg-orange-400' : 'bg-rose-500'
                      }`}
                      style={{ width: `${d.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>ความพึงพอใจเชิงบวก (4-5 ดาว)</span>
            <span className="font-bold text-emerald-600 text-sm">{analysis.pct45Overall}%</span>
          </div>
        </div>

        {/* 3 Core Dimensions (7 cols) */}
        <div className="lg:col-span-7 bg-white p-7 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-slate-800">ผลการประเมินจำแนกตามมิติ</h3>
                <p className="text-xs text-slate-400 mt-0.5">วิเคราะห์เจาะลึก 3 มิติสำคัญของการจัดฝึกอบรม</p>
              </div>
            </div>

            <div className="space-y-4">
              {analysis.dimensions.map((dim, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100 hover:border-slate-200 transition-colors">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">{dim.title}</h4>
                      <p className="text-xs text-slate-500 mt-0.5">{dim.description}</p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-baseline gap-1 justify-end">
                        <span className="text-xl font-black text-slate-800">{dim.average.toFixed(2)}</span>
                        <span className="text-[11px] text-slate-400">/ 5.00</span>
                      </div>
                      <span className="text-[10px] font-semibold text-emerald-600">
                        {dim.pct45}% พึงพอใจ 4-5
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-crimson rounded-full"
                      style={{ width: `${(dim.average / 5) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>เกณฑ์ประเมินระดับดีเยี่ยม: &ge; 4.50</span>
            <span className="text-crimson font-medium">มาตรฐาน มหาวิทยาลัยกรุงเทพ</span>
          </div>
        </div>
      </div>

      {/* Highlights: Highest & Lowest Questions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-3xl p-6 relative overflow-hidden">
          <div className="flex items-center gap-2 mb-3 text-emerald-800">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider block">จุดเด่นสูงสุด (Highest Rated)</span>
              <span className="text-[11px] text-emerald-600">หัวข้อที่ได้รับความพึงพอใจสูงสุด</span>
            </div>
          </div>
          <p className="text-sm font-bold text-slate-800 mb-4 leading-snug">
            {analysis.highestQuestion?.question || "-"}
          </p>
          <div className="flex items-center justify-between pt-3 border-t border-emerald-200/60 text-xs">
            <span className="text-slate-600">คะแนนเฉลี่ย: <strong className="text-emerald-700 text-base">{analysis.highestQuestion?.average.toFixed(2)}</strong> / 5.00</span>
            <span className="font-semibold text-emerald-700 bg-emerald-100/70 px-2.5 py-1 rounded-lg">
              {analysis.highestQuestion?.pct45}% ให้คะแนน 4-5
            </span>
          </div>
        </div>

        <div className="bg-blue-50/60 border border-blue-200/80 rounded-3xl p-6 relative overflow-hidden">
          <div className="flex items-center gap-2 mb-3 text-blue-800">
            <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
              <ArrowDownRight className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider block">โอกาสพัฒนา (Development Opportunity)</span>
              <span className="text-[11px] text-blue-600">หัวข้อที่สามารถเพิ่มประสิทธิภาพได้</span>
            </div>
          </div>
          <p className="text-sm font-bold text-slate-800 mb-4 leading-snug">
            {analysis.lowestQuestion?.question || "-"}
          </p>
          <div className="flex items-center justify-between pt-3 border-t border-blue-200/60 text-xs">
            <span className="text-slate-600">คะแนนเฉลี่ย: <strong className="text-blue-700 text-base">{analysis.lowestQuestion?.average.toFixed(2)}</strong> / 5.00</span>
            <span className="font-semibold text-blue-700 bg-blue-100/70 px-2.5 py-1 rounded-lg">
              {analysis.lowestQuestion?.pct45}% ให้คะแนน 4-5
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
