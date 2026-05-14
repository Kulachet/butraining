import React, { useMemo, useState } from "react";
import { AnalyticsData, getRatingsArray } from "./types";
import { MessageSquareText, ThumbsUp, ThumbsDown, Minus, Search, Lightbulb, TrendingUp, Filter } from "lucide-react";
import { format } from "date-fns";

export const FeedbackAnalysisTab: React.FC<{ data: AnalyticsData }> = ({ data }) => {
  const [filterMode, setFilterMode] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const feedbacks = useMemo(() => {
    return data.evaluations
      .filter(e => e.suggestion && e.suggestion.trim() !== "")
      .map(e => {
        const text = e.suggestion.toLowerCase() || "";
        const qSum = getRatingsArray(e.ratings).reduce((a:number, b:number) => a+b, 0);
        const avg = qSum / 10;
        
        let sentiment = "neutral";
        if (text.match(/ดี|เยี่ยม|ชื่นชม|ประทับใจ|ชอบ|ขอบคุณ|สุดยอด/)) sentiment = "positive";
        else if (text.match(/ปรับปรุง|ควรเพิ่ม|น้อยไป|ช้า|เร็ว|ไม่พอ|ปัญหา|น่าจะ/)) sentiment = "negative";
        else if (avg >= 4.5) sentiment = "positive";
        else if (avg <= 3.5) sentiment = "negative";

        let keywords = [];
        if (text.match(/เวลา|ระยะเวลา/)) keywords.push("เวลา");
        if (text.match(/วิทยากร|ผู้สอน|อาจารย์/)) keywords.push("วิทยากร");
        if (text.match(/เอกสาร|สไลด์|file/)) keywords.push("เอกสาร");
        if (text.match(/เนื้อหา|หัวข้อ/)) keywords.push("เนื้อหา");
        if (text.match(/จัดอีก|ครั้งหน้า/)) keywords.push("จัดอีก");

        const courseInfo = data.courses.find(c => c.id === e.courseId);

        return {
          id: e.id || Math.random().toString(),
          userName: e.userName || "ไม่ระบุ",
          courseName: courseInfo?.title || "ไม่ทราบหลักสูตร",
          text: e.suggestion,
          sentiment,
          keywords,
          createdAt: e.createdAt,
          score: avg
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [data]);

  const filteredFeedbacks = useMemo(() => {
    return feedbacks.filter(f => {
      const matchFilter = filterMode === "all" || f.sentiment === filterMode;
      const matchSearch = f.text.toLowerCase().includes(searchQuery.toLowerCase()) || f.courseName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchFilter && matchSearch;
    });
  }, [feedbacks, filterMode, searchQuery]);

  const aiInsights = useMemo(() => {
    const positiveCount = feedbacks.filter(f => f.sentiment === "positive").length;
    const negativeCount = feedbacks.filter(f => f.sentiment === "negative").length;
    
    // Most common keywords in negatives
    const negativeKeywords = feedbacks.filter(f => f.sentiment === "negative").flatMap(f => f.keywords);
    const keywordCounts = negativeKeywords.reduce((acc, curr) => {
      acc[curr] = (acc[curr] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const topIssue = Object.keys(keywordCounts).sort((a, b) => keywordCounts[b] - keywordCounts[a])[0];

    const avg = feedbacks.reduce((acc, curr) => acc + curr.score, 0) / (feedbacks.length || 1);

    return {
      positiveCount,
      negativeCount,
      topIssue: topIssue || "ไม่มีประเด็นเด่น",
      avgScore: avg.toFixed(2),
      isVeryGood: avg >= 4.5
    };
  }, [feedbacks]);

  return (
    <div className="space-y-6">
      {/* AI Insights Box */}
      <div className="bg-gradient-to-br from-indigo-900 to-slate-900 rounded-3xl p-8 border border-slate-800 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-crimson/20 blur-3xl rounded-full translate-x-1/3 -translate-y-1/3 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-yellow-400">
            <Lightbulb className="w-6 h-6 text-amber-400" />
            Strengths & Improvement Insights (วิเคราะห์อัตโนมัติ)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                  <ThumbsUp className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-bold text-emerald-400 mb-1">จุดแข็งของโครงการอบรม</p>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {aiInsights.isVeryGood ? "ผู้เข้าอบรมส่วนใหญ่มีความพึงพอใจในระดับดีมาก ชื่นชมในคุณภาพของวิทยากรและความทันสมัยของเนื้อหา" : "วิทยากรมีความรู้ความเชี่ยวชาญ และสามารถถ่ายทอดเนื้อหาได้ดี"} 
                    (ความคิดเห็นเชิงบวก {aiInsights.positiveCount} รายการ)
                  </p>
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-bold text-amber-400 mb-1">ประเด็นที่ควรปรับปรุง</p>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {aiInsights.negativeCount > 0 ? `พบข้อเสนอแนะเชิงปรับปรุง ${aiInsights.negativeCount} รายการ ประเด็นที่พบบ่อยที่สุดคือเรื่อง "${aiInsights.topIssue}" ควรพิจารณาปรับปรุงในการจัดอบรมครั้งต่อไป` : "ไม่พบประเด็นปัญหาที่ชัดเจนจากข้อเสนอแนะ"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Feedback List */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm flex flex-col">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <MessageSquareText className="w-5 h-5 text-indigo-500" />
            ความคิดเห็นและข้อเสนอแนะทั้งหมด ({feedbacks.length})
          </h3>
          
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="ค้นหาข้อความ..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            
            <select 
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
            >
              <option value="all">ทุก Sentiment</option>
              <option value="positive">🟢 Positive (ชื่นชม)</option>
              <option value="neutral">⚪️ Neutral (ทั่วไป)</option>
              <option value="negative">🔴 Negative (ปรับปรุง)</option>
            </select>
          </div>
        </div>

        <div className="p-6">
          <div className="space-y-4">
            {filteredFeedbacks.map((f, idx) => (
              <div key={f.id} className="p-5 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2">
                    {f.sentiment === 'positive' && <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-100 px-2 pl-1.5 py-0.5 rounded-full"><ThumbsUp className="w-3 h-3" /> POSITIVE</span>}
                    {f.sentiment === 'negative' && <span className="flex items-center gap-1 text-[11px] font-bold text-red-600 bg-red-100 px-2 pl-1.5 py-0.5 rounded-full"><ThumbsDown className="w-3 h-3" /> NEGATIVE</span>}
                    {f.sentiment === 'neutral' && <span className="flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-200 px-2 pl-1.5 py-0.5 rounded-full"><Minus className="w-3 h-3" /> NEUTRAL</span>}
                    <span className="text-[11px] font-semibold text-slate-400">{f.courseName}</span>
                  </div>
                  <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
                    {f.createdAt ? new Date(f.createdAt).toLocaleDateString('th-TH') : '-'}
                  </span>
                </div>
                
                <p className="text-sm text-slate-700 leading-relaxed mb-3">"{f.text}"</p>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {f.keywords.map((kw, i) => (
                      <span key={i} className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                        #{kw}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs font-bold text-slate-500">- {f.userName}</span>
                </div>
              </div>
            ))}
            
            {filteredFeedbacks.length === 0 && (
              <div className="text-center py-12 text-slate-400 text-sm">
                ไม่พบความคิดเห็นที่ตรงกับเงื่อนไข
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
