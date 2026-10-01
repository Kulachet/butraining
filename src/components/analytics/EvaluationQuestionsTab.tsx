import React, { useState, useMemo } from "react";
import { QuestionStat } from "../../lib/evaluationAnalytics";
import { Search, ArrowUpDown, Star, Filter } from "lucide-react";

interface EvaluationQuestionsTabProps {
  questionStats: QuestionStat[];
}

export const EvaluationQuestionsTab: React.FC<EvaluationQuestionsTabProps> = ({
  questionStats
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"index" | "avg_desc" | "avg_asc" | "pct5_desc">("index");

  const filteredAndSortedStats = useMemo(() => {
    let result = [...questionStats];

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(q => q.question.toLowerCase().includes(term));
    }

    switch (sortBy) {
      case "avg_desc":
        result.sort((a, b) => b.average - a.average);
        break;
      case "avg_asc":
        result.sort((a, b) => a.average - b.average);
        break;
      case "pct5_desc":
        result.sort((a, b) => b.pct5 - a.pct5);
        break;
      case "index":
      default:
        result.sort((a, b) => a.index - b.index);
        break;
    }

    return result;
  }, [questionStats, searchTerm, sortBy]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Search and Sort Toolbar */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-80">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาข้อคำถามประเมิน..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-crimson/20 focus:border-crimson"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 shrink-0">
            <ArrowUpDown className="w-3.5 h-3.5" /> เรียงตาม:
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="w-full md:w-auto px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-crimson/20 cursor-pointer"
          >
            <option value="index">ตามลำดับข้อคำถาม (1-10)</option>
            <option value="avg_desc">คะแนนเฉลี่ยสูงสุด &rarr; ต่ำสุด</option>
            <option value="avg_asc">คะแนนเฉลี่ยต่ำสุด &rarr; สูงสุด</option>
            <option value="pct5_desc">สัดส่วนผู้ให้คะแนนเต็ม 5 สูงสุด</option>
          </select>
        </div>
      </div>

      {/* Questions List / Cards */}
      <div className="space-y-4">
        {filteredAndSortedStats.map((q) => {
          const count5 = q.distribution[5] || 0;
          const count4 = q.distribution[4] || 0;
          const count3 = q.distribution[3] || 0;
          const count2 = q.distribution[2] || 0;
          const count1 = q.distribution[1] || 0;

          return (
            <div
              key={q.index}
              className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:border-slate-300 transition-all space-y-4"
            >
              {/* Question Header & Score */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-crimson/10 text-crimson font-black flex items-center justify-center shrink-0 text-sm mt-0.5">
                    {q.index + 1}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-800 leading-snug">
                      {q.question}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      จำนวนผู้ประเมิน: {q.count} คน
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-6 self-end md:self-center shrink-0">
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 font-semibold block">สัดส่วน 5 ดาว</span>
                    <span className="text-sm font-bold text-slate-700">{q.pct5}%</span>
                  </div>

                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 font-semibold block">พึงพอใจ 4-5 ดาว</span>
                    <span className="text-sm font-bold text-emerald-600">{q.pct45}%</span>
                  </div>

                  <div className="text-right pl-4 border-l border-slate-100">
                    <span className="text-[11px] text-slate-400 font-semibold block">คะแนนเฉลี่ย</span>
                    <div className="flex items-baseline gap-1 justify-end">
                      <span className={`text-2xl font-black ${
                        q.average >= 4.5 ? 'text-emerald-600' :
                        q.average >= 4.0 ? 'text-blue-600' :
                        q.average >= 3.0 ? 'text-amber-500' : 'text-rose-600'
                      }`}>
                        {q.average.toFixed(2)}
                      </span>
                      <span className="text-xs text-slate-400">/5.00</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stacked Distribution Bar */}
              <div className="pt-2">
                <div className="flex h-3.5 rounded-full overflow-hidden bg-slate-100 shadow-inner">
                  <div
                    style={{ width: `${(count5 / q.count) * 100}%` }}
                    className="bg-emerald-500 hover:opacity-90 transition-opacity"
                    title={`5 คะแนน: ${count5} คน (${((count5 / q.count) * 100).toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${(count4 / q.count) * 100}%` }}
                    className="bg-blue-500 hover:opacity-90 transition-opacity"
                    title={`4 คะแนน: ${count4} คน (${((count4 / q.count) * 100).toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${(count3 / q.count) * 100}%` }}
                    className="bg-amber-400 hover:opacity-90 transition-opacity"
                    title={`3 คะแนน: ${count3} คน (${((count3 / q.count) * 100).toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${(count2 / q.count) * 100}%` }}
                    className="bg-orange-400 hover:opacity-90 transition-opacity"
                    title={`2 คะแนน: ${count2} คน (${((count2 / q.count) * 100).toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${(count1 / q.count) * 100}%` }}
                    className="bg-rose-500 hover:opacity-90 transition-opacity"
                    title={`1 คะแนน: ${count1} คน (${((count1 / q.count) * 100).toFixed(1)}%)`}
                  />
                </div>

                {/* Score breakdown pills */}
                <div className="grid grid-cols-5 gap-2 mt-3 pt-3 border-t border-slate-100 text-center">
                  <div className="text-xs bg-emerald-50 text-emerald-800 py-1.5 px-2 rounded-xl">
                    <span className="font-semibold block text-[11px]">5 ดาว (มากที่สุด)</span>
                    <strong className="font-bold">{count5} คน</strong> <span className="text-[10px] text-emerald-600">({((count5 / q.count) * 100).toFixed(0)}%)</span>
                  </div>
                  <div className="text-xs bg-blue-50 text-blue-800 py-1.5 px-2 rounded-xl">
                    <span className="font-semibold block text-[11px]">4 ดาว (มาก)</span>
                    <strong className="font-bold">{count4} คน</strong> <span className="text-[10px] text-blue-600">({((count4 / q.count) * 100).toFixed(0)}%)</span>
                  </div>
                  <div className="text-xs bg-amber-50 text-amber-800 py-1.5 px-2 rounded-xl">
                    <span className="font-semibold block text-[11px]">3 ดาว (ปานกลาง)</span>
                    <strong className="font-bold">{count3} คน</strong> <span className="text-[10px] text-amber-600">({((count3 / q.count) * 100).toFixed(0)}%)</span>
                  </div>
                  <div className="text-xs bg-orange-50 text-orange-800 py-1.5 px-2 rounded-xl">
                    <span className="font-semibold block text-[11px]">2 ดาว (น้อย)</span>
                    <strong className="font-bold">{count2} คน</strong> <span className="text-[10px] text-orange-600">({((count2 / q.count) * 100).toFixed(0)}%)</span>
                  </div>
                  <div className="text-xs bg-rose-50 text-rose-800 py-1.5 px-2 rounded-xl">
                    <span className="font-semibold block text-[11px]">1 ดาว (น้อยที่สุด)</span>
                    <strong className="font-bold">{count1} คน</strong> <span className="text-[10px] text-rose-600">({((count1 / q.count) * 100).toFixed(0)}%)</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {filteredAndSortedStats.length === 0 && (
          <div className="bg-white p-12 text-center rounded-3xl border border-slate-200">
            <p className="text-slate-400">ไม่พบข้อคำถามที่ตรงกับคำค้นหา "{searchTerm}"</p>
          </div>
        )}
      </div>
    </div>
  );
};
