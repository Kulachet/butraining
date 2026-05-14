import React, { useMemo, useState } from "react";
import { AnalyticsData, QUESTIONS, getScoreLevel, getRatingsArray } from "./types";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { BookOpen, Star, AlertTriangle, Filter } from "lucide-react";
import { format, parseISO } from "date-fns";

export const CourseEvaluationTab: React.FC<{ data: AnalyticsData }> = ({ data }) => {
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const { overallAvg, qAverages, bottom3, dimensions, courseComparison } = useMemo(() => {
    let qSums = new Array(10).fill(0);
    const totalEvals = data.evaluations.length;

    data.evaluations.forEach(e => {
      getRatingsArray(e.ratings).forEach((r: number, i: number) => {
        if (i < 10) qSums[i] += r;
      });
    });

    const qAvgs = qSums.map((sum, i) => totalEvals > 0 ? sum / totalEvals : 0);
    const overallAvg = qAvgs.reduce((a, b) => a + b, 0) / 10;

    // Dimension grouping
    // Content Quality: 1, 2, 3 (idx 0,1,2)
    // Practical Application: 4 (idx 3)
    // Instructor Quality: 5, 6, 7, 8 (idx 4,5,6,7)
    // Training Design: 9 (idx 8)
    // Overall Satisfaction: 10 (idx 9)
    const dimensions = [
      { subject: 'Content Quality', A: ((qAvgs[0] + qAvgs[1] + qAvgs[2]) / 3).toFixed(2), fullMark: 5 },
      { subject: 'Practical Application', A: qAvgs[3].toFixed(2), fullMark: 5 },
      { subject: 'Instructor Quality', A: ((qAvgs[4] + qAvgs[5] + qAvgs[6] + qAvgs[7]) / 4).toFixed(2), fullMark: 5 },
      { subject: 'Training Design', A: qAvgs[8].toFixed(2), fullMark: 5 },
      { subject: 'Overall Satisfaction', A: qAvgs[9].toFixed(2), fullMark: 5 },
    ];

    const qAvgsWithQuestions = qAvgs.map((avg, i) => ({
      questionId: i + 1,
      question: QUESTIONS[i],
      score: Number(avg.toFixed(2)),
      level: getScoreLevel(avg).label
    })).sort((a, b) => b.score - a.score);

    const bottom3 = [...qAvgsWithQuestions].reverse().slice(0, 3);

    // Course comparison
    const courseComparison = data.courses.map(course => {
      const courseRegs = data.registrations.filter(r => r.courseId === course.id);
      const attended = courseRegs.filter(r => r.attended);
      const evals = data.evaluations.filter(e => e.courseId === course.id);
      
      let crsAvg = 0;
      if (evals.length > 0) {
        const sum = evals.reduce((acc, curr) => acc + (getRatingsArray(curr.ratings).reduce((a:number, b:number) => a+b, 0) / 10), 0);
        crsAvg = Number((sum / evals.length).toFixed(2));
      }

      const completionRate = attended.length > 0 ? (attended.length / attended.length) * 100 : 0; // assuming attended = completed

      const status = crsAvg >= 4.51 ? 'Excellent' : crsAvg >= 3.51 ? 'Good' : 'Needs Attention';

      return {
        id: course.id,
        title: course.title,
        date: course.date,
        instructor: course.instructorName || "-",
        registrations: courseRegs.length,
        attended: attended.length,
        completionRate: Number(completionRate.toFixed(1)),
        avgScore: crsAvg,
        evalCount: evals.length,
        status,
        statusColor: crsAvg >= 4.51 ? 'text-emerald-600 bg-emerald-50' : crsAvg >= 3.51 ? 'text-blue-600 bg-blue-50' : 'text-red-600 bg-red-50'
      };
    });

    return { overallAvg, qAverages: qAvgsWithQuestions, bottom3, dimensions, courseComparison };
  }, [data]);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const sortedCourseComparison = useMemo(() => {
    let sortableItems = [...courseComparison];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        if (a[sortConfig.key as keyof typeof a] < b[sortConfig.key as keyof typeof b]) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (a[sortConfig.key as keyof typeof a] > b[sortConfig.key as keyof typeof b]) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [courseComparison, sortConfig]);


  const Th = ({ label, sortKey, className = "" }: { label: string, sortKey?: string, className?: string }) => (
    <th 
      className={`px-4 py-3 font-bold text-slate-500 uppercase tracking-wider text-[11px] ${sortKey ? "cursor-pointer hover:bg-slate-100" : ""} ${className}`}
      onClick={() => sortKey && handleSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortKey && sortConfig?.key === sortKey && (
          <span className="text-crimson font-black">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
        )}
      </div>
    </th>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Score by Question */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-400" />
            คะแนนเฉลี่ยรายข้อ (Evaluation Score by Question)
          </h3>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={qAverages} margin={{ left: 10, right: 30, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                <XAxis type="number" domain={[0, 5]} hide />
                <YAxis 
                  dataKey="questionId" 
                  type="category" 
                  tickLine={false} 
                  axisLine={false}
                  tick={{ fill: '#64748b', fontSize: 12, fontWeight: 'bold' }}
                  tickFormatter={(val) => `ข้อ ${val}`}
                  width={40}
                />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-white text-xs p-3 rounded-xl max-w-[250px] shadow-xl">
                          <p className="font-bold text-crimson mb-1">ข้อ {data.questionId}</p>
                          <p className="mb-2">{data.question}</p>
                          <div className="flex justify-between items-center bg-white/10 p-2 rounded-lg">
                            <span className="font-medium text-slate-300">คะแนนเฉลี่ย</span>
                            <span className="font-black text-amber-400 text-sm">{data.score}</span>
                          </div>
                        </div>
                      )
                    }
                    return null;
                  }}
                />
                <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={16}>
                  {qAverages.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getScoreLevel(entry.score).color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Dimension Radar */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 flex flex-col">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-500" />
            คะแนนเฉลี่ยตามมิติวิเคราะห์ (Dimension Analysis)
          </h3>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={dimensions}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: '#475569', fontSize: 11, fontWeight: 'bold' }} />
                <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fontSize: 10 }} />
                <Radar name="คะแนนเฉลี่ย" dataKey="A" stroke="#991b1b" fill="#991b1b" fillOpacity={0.6} />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom 3 Highlights */}
      <div className="bg-red-50/50 rounded-3xl border border-red-100 p-6">
        <h3 className="text-base font-bold text-red-800 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          หัวข้อที่ควรนำไปปรับปรุงเร่งด่วน (ได้คะแนนน้อยที่สุด 3 อันดับ)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {bottom3.map((item, idx) => (
            <div key={idx} className="bg-white p-4 rounded-2xl border border-red-100 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <span className="text-xs font-black text-red-600 bg-red-100 px-2 py-1 rounded-md">ข้อ {item.questionId}</span>
                <span className="text-lg font-black text-slate-800">{item.score}</span>
              </div>
              <p className="text-xs font-bold text-slate-600 leading-relaxed">{item.question}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Course Performance Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">เปรียบเทียบผลการอบรมรายหลักสูตร (Course Performance)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th label="ชื่อหลักสูตร" />
                <Th label="วันที่จัดอบรม" sortKey="date" />
                <Th label="ผู้เข้าอบรม (คน)" sortKey="attended" className="text-right" />
                <Th label="ตอบประเมิน" sortKey="evalCount" className="text-right" />
                <Th label="คะแนนความพึงพอใจเฉลี่ย" sortKey="avgScore" className="text-center" />
                <Th label="สถานะ" sortKey="avgScore" className="text-center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedCourseComparison.map(course => (
                <tr key={course.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-bold text-slate-800 line-clamp-1">{course.title}</p>
                    <p className="text-xs text-slate-500 line-clamp-1">{course.instructor}</p>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-slate-600 whitespace-nowrap">
                    {course.date}
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-700 text-right">
                    {course.attended} <span className="text-xs font-normal text-slate-400">/ {course.registrations}</span>
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-700 text-right">
                    {course.evalCount}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="inline-flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-lg">
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      <span className="text-sm font-black text-slate-800">{course.avgScore.toFixed(2)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${course.statusColor}`}>
                      {course.status}
                    </span>
                  </td>
                </tr>
              ))}
              {sortedCourseComparison.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm font-medium text-slate-400">ไม่มีข้อมูลหลักสูตร</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
