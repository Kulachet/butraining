import React, { useMemo } from "react";
import { AnalyticsData, getRatingsArray } from "./types";
import { UserCheck, Award, MessageCircle } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";

export const InstructorPerformanceTab: React.FC<{ data: AnalyticsData }> = ({ data }) => {
  const instructorStats = useMemo(() => {
    // Map instructorName -> stats
    // We group by instructorName on the course since multiple instructors might exist
    const statsMap: Record<string, any> = {};

    data.courses.forEach(course => {
      const instructorName = course.instructorName || "ไม่ระบุวิทยากร";
      if (!statsMap[instructorName]) {
        statsMap[instructorName] = {
          name: instructorName,
          coursesTaught: 0,
          evalCount: 0,
          q5Sum: 0, // เชี่ยวชาญ
          q6Sum: 0, // ถ่ายทอด
          q7Sum: 0, // เปิดโอกาส
          q8Sum: 0, // ตอบคำถาม
        };
      }
      
      statsMap[instructorName].coursesTaught += 1;

      const courseEvals = data.evaluations.filter(e => e.courseId === course.id);
      statsMap[instructorName].evalCount += courseEvals.length;

      courseEvals.forEach(e => {
        const ratingsArray = getRatingsArray(e.ratings);
        if (ratingsArray.length >= 8) {
          statsMap[instructorName].q5Sum += ratingsArray[4] || 0;
          statsMap[instructorName].q6Sum += ratingsArray[5] || 0;
          statsMap[instructorName].q7Sum += ratingsArray[6] || 0;
          statsMap[instructorName].q8Sum += ratingsArray[7] || 0;
        }
      });
    });

    const result = Object.values(statsMap).map(stat => {
      const count = stat.evalCount;
      const q5Avg = count > 0 ? stat.q5Sum / count : 0;
      const q6Avg = count > 0 ? stat.q6Sum / count : 0;
      const q7Avg = count > 0 ? stat.q7Sum / count : 0;
      const q8Avg = count > 0 ? stat.q8Sum / count : 0;
      const overallAvg = (q5Avg + q6Avg + q7Avg + q8Avg) / 4;

      return {
        name: stat.name,
        coursesTaught: stat.coursesTaught,
        evalCount: count,
        expertiseAvg: Number(q5Avg.toFixed(2)),
        teachingAvg: Number(q6Avg.toFixed(2)),
        engagementAvg: Number(q7Avg.toFixed(2)),
        qnaAvg: Number(q8Avg.toFixed(2)),
        overallAvg: Number(overallAvg.toFixed(2))
      };
    }).filter(s => s.evalCount > 0).sort((a, b) => b.overallAvg - a.overallAvg);

    return result;
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 shadow-sm p-6 flex flex-col">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Award className="w-5 h-5 text-indigo-500" />
            อันดับวิทยากร (Instructor Ranking by Score)
          </h3>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={instructorStats} margin={{ left: 10, right: 30, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                <XAxis type="number" domain={[0, 5]} hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  tickLine={false} 
                  axisLine={false}
                  tick={{ fill: '#475569', fontSize: 11, fontWeight: 'bold' }}
                  width={120}
                />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white border border-slate-200 text-slate-800 text-xs p-4 rounded-xl shadow-xl max-w-[250px]">
                          <p className="font-bold text-sm mb-1">{data.name}</p>
                          <p className="text-slate-500 mb-3">{data.coursesTaught} หลักสูตร • {data.evalCount} การประเมิน</p>
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center"><span className="text-slate-500">ความเชี่ยวชาญ</span><span className="font-bold">{data.expertiseAvg}</span></div>
                            <div className="flex justify-between items-center"><span className="text-slate-500">การถ่ายทอด</span><span className="font-bold">{data.teachingAvg}</span></div>
                            <div className="flex justify-between items-center"><span className="text-slate-500">การมีส่วนร่วม</span><span className="font-bold">{data.engagementAvg}</span></div>
                            <div className="flex justify-between items-center"><span className="text-slate-500">ตอบคำถาม</span><span className="font-bold">{data.qnaAvg}</span></div>
                            <div className="flex justify-between items-center pt-1.5 border-t border-slate-100 mt-1.5"><span className="text-slate-800 font-bold">รวม</span><span className="font-black text-crimson">{data.overallAvg}</span></div>
                          </div>
                        </div>
                      )
                    }
                    return null;
                  }}
                />
                <Bar dataKey="overallAvg" radius={[0, 4, 4, 0]} barSize={20}>
                  {instructorStats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index < 3 ? "#16a34a" : "#cbd5e1"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900 text-white rounded-3xl border border-slate-800 shadow-sm p-6 overflow-hidden relative">
          <div className="absolute -right-4 -bottom-4 opacity-5 pointer-events-none">
            <UserCheck className="w-48 h-48" />
          </div>
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            Top 3 Instructors
          </h3>
          <div className="space-y-4">
            {instructorStats.slice(0, 3).map((inst, idx) => (
              <div key={idx} className="bg-white/10 p-4 rounded-2xl flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center font-black shrink-0">
                  #{idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{inst.name}</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest">{inst.evalCount} Reviews</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xl font-black text-amber-400">{inst.overallAvg}</p>
                </div>
              </div>
            ))}
            {instructorStats.length === 0 && (
              <div className="text-slate-500 text-sm text-center py-4">ไม่มีข้อมูลวิทยากร</div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-indigo-500" />
            รายละเอียดผลประเมินวิทยากร
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-wider text-[11px]">ชื่อวิทยากร</th>
                <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-wider text-[11px] text-center">หลักสูตร</th>
                <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-wider text-[11px] text-center">จำนวนประเมิน</th>
                <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-wider text-[11px] text-center">ความเชี่ยวชาญ</th>
                <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-wider text-[11px] text-center">การถ่ายทอด</th>
                <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-wider text-[11px] text-center">เปิดโอกาส</th>
                <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-wider text-[11px] text-center">ตอบคำถาม</th>
                <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-wider text-[11px] text-center">เฉลี่ยรวม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {instructorStats.map((inst, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      {idx < 3 && <Award className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />}
                      {inst.name}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-600 text-center">{inst.coursesTaught}</td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-600 text-center">{inst.evalCount}</td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-700 text-center">{inst.expertiseAvg.toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-700 text-center">{inst.teachingAvg.toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-700 text-center">{inst.engagementAvg.toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-700 text-center">{inst.qnaAvg.toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm font-black text-indigo-700 text-center bg-indigo-50/30">{inst.overallAvg.toFixed(2)}</td>
                </tr>
              ))}
              {instructorStats.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm font-medium text-slate-400">ไม่มีข้อมูลผลประเมิน</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
