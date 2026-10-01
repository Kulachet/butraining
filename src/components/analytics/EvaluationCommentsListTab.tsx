import React, { useState, useMemo } from "react";
import { AnalyzedComment, CommentSentiment } from "../../lib/evaluationAnalytics";
import { Search, Shield, Filter, MessageSquare, Calendar } from "lucide-react";

interface EvaluationCommentsListTabProps {
  comments: AnalyzedComment[];
}

export const EvaluationCommentsListTab: React.FC<EvaluationCommentsListTabProps> = ({
  comments
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSentiment, setFilterSentiment] = useState<"all" | CommentSentiment>("all");

  const filteredComments = useMemo(() => {
    return comments.filter((c) => {
      const matchesSearch = searchTerm.trim() === "" || c.text.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSentiment = filterSentiment === "all" || c.sentiment === filterSentiment;
      return matchesSearch && matchesSentiment;
    });
  }, [comments, searchTerm, filterSentiment]);

  const counts = useMemo(() => {
    return {
      all: comments.length,
      positive: comments.filter(c => c.sentiment === 'positive').length,
      neutral: comments.filter(c => c.sentiment === 'neutral').length,
      negative: comments.filter(c => c.sentiment === 'negative').length
    };
  }, [comments]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Privacy Notice Banner */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-slate-200/70 text-slate-700 flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-800">
              ภาคผนวกความคิดเห็น: มาตรการคุ้มครองความเป็นส่วนตัว (Privacy Protected)
            </h4>
            <p className="text-[11px] text-slate-500">
              ชื่อ นามสกุล และอีเมลของผู้ตอบแบบประเมินถูกซ่อนจากการแสดงผลในรายงาน เพื่อความโปร่งใสและอิสระในการแสดงความคิดเห็น
            </p>
          </div>
        </div>
        <span className="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1 rounded-xl shrink-0">
          ทั้งหมด {comments.length} ข้อความ
        </span>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => setFilterSentiment("all")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              filterSentiment === "all"
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            ทั้งหมด ({counts.all})
          </button>

          <button
            onClick={() => setFilterSentiment("positive")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              filterSentiment === "positive"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            เชิงบวก ({counts.positive})
          </button>

          <button
            onClick={() => setFilterSentiment("neutral")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              filterSentiment === "neutral"
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-blue-50 text-blue-700 hover:bg-blue-100"
            }`}
          >
            ข้อเสนอแนะ ({counts.neutral})
          </button>

          <button
            onClick={() => setFilterSentiment("negative")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              filterSentiment === "negative"
                ? "bg-rose-600 text-white shadow-sm"
                : "bg-rose-50 text-rose-700 hover:bg-rose-100"
            }`}
          >
            ข้อควรปรับปรุง ({counts.negative})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-72">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาข้อความความคิดเห็น..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-crimson/20 focus:border-crimson"
          />
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
        </div>
      </div>

      {/* Comments List */}
      <div className="space-y-3">
        {filteredComments.map((c) => (
          <div
            key={c.id}
            className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-slate-300 transition-all space-y-3 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center">
                  #{c.index}
                </span>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                  c.sentiment === 'positive' ? 'bg-emerald-100 text-emerald-800' :
                  c.sentiment === 'negative' ? 'bg-rose-100 text-rose-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {c.sentimentLabel}
                </span>

                {c.matchedThemes.map((th, ti) => (
                  <span key={ti} className="hidden sm:inline-block bg-slate-100 text-slate-600 text-[11px] font-medium px-2 py-0.5 rounded-md">
                    {th}
                  </span>
                ))}
              </div>

              {c.createdAt && (
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Calendar className="w-3.5 h-3.5" />
                  {new Date(c.createdAt).toLocaleDateString('th-TH')}
                </span>
              )}
            </div>

            <p className="text-sm text-slate-800 leading-relaxed font-normal whitespace-pre-wrap pl-9">
              {c.text}
            </p>
          </div>
        ))}

        {filteredComments.length === 0 && (
          <div className="bg-white p-16 text-center rounded-3xl border border-slate-200">
            <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium text-sm">ไม่พบความคิดเห็นในหมวดหมู่นี้</p>
            <p className="text-slate-400 text-xs mt-1">ลองเปลี่ยนตัวกรอง หรือล้างคำค้นหา</p>
          </div>
        )}
      </div>
    </div>
  );
};
