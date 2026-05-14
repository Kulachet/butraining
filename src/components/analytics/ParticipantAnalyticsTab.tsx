import React, { useMemo } from "react";
import { AnalyticsData } from "./types";
import { Users, FileX, CheckCircle, Award, Target } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, LabelList } from "recharts";

export const ParticipantAnalyticsTab: React.FC<{ data: AnalyticsData }> = ({ data }) => {
  const stats = useMemo(() => {
    const registered = data.registrations.length;
    const attended = data.registrations.filter(r => r.attended).length;
    const noShow = registered - attended;
    
    // Assuming attended = completed based on existing data structure
    const completed = attended;
    const failed = attended - completed;
    
    const certified = data.registrations.filter(r => r.certStatus === 'sent').length;

    const attendanceRate = registered > 0 ? (attended / registered) * 100 : 0;
    const completionRate = attended > 0 ? (completed / attended) * 100 : 0;
    const certIssuedRate = completed > 0 ? (certified / completed) * 100 : 0;

    return {
      registered,
      attended,
      noShow,
      completed,
      failed,
      certified,
      attendanceRate,
      completionRate,
      certIssuedRate
    };
  }, [data]);

  const funnelData = [
    { name: "Registered (ลงทะเบียน)", value: stats.registered, fill: "#cbd5e1" },
    { name: "Attended (เข้าอบรม)", value: stats.attended, fill: "#3b82f6" },
    { name: "Completed (ผ่านเกณฑ์)", value: stats.completed, fill: "#16a34a" },
    { name: "Certified (รับใบประกาศ)", value: stats.certified, fill: "#f59e0b" },
  ];

  const StatBox = ({ title, value, sub, icon: Icon, colorClass }: any) => (
    <div className={`p-4 rounded-2xl border flex flex-col justify-center items-start gap-2 bg-white ${colorClass.border}`}>
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${colorClass.bg} ${colorClass.text}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{title}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black text-slate-800">{value}</span>
          {sub && <span className="text-xs font-semibold text-slate-400">{sub}</span>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatBox title="ผู้ลงทะเบียน" value={stats.registered} icon={Users} colorClass={{ bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' }} />
        <StatBox title="เข้าอบรมจริง" value={stats.attended} sub={`(${stats.attendanceRate.toFixed(1)}%)`} icon={UserCheck} colorClass={{ bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100' }} />
        <StatBox title="ไม่เข้าอบรม" value={stats.noShow} icon={FileX} colorClass={{ bg: 'bg-slate-50', text: 'text-slate-400', border: 'border-slate-100' }} />
        <StatBox title="ผ่านเกณฑ์" value={stats.completed} sub={`(${stats.completionRate.toFixed(1)}%)`} icon={CheckCircle} colorClass={{ bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' }} />
        <StatBox title="ไม่ผ่านเกณฑ์" value={stats.failed} icon={Target} colorClass={{ bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-100' }} />
        <StatBox title="ส่ง Certificate" value={stats.certified} sub={`(${stats.certIssuedRate.toFixed(1)}%)`} icon={Award} colorClass={{ bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100' }} />
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 lg:p-10">
        <div className="flex flex-col items-center mb-8">
          <h3 className="text-xl font-bold text-slate-800">Conversion Funnel ผู้เข้าอบรม (Participant Funnel)</h3>
          <p className="text-slate-500 text-sm mt-1">แสดงสัดส่วนผู้ลงทะเบียนจนถึงผู้ได้รับใบประกาศนียบัตร</p>
        </div>
        
        <div className="h-[400px] w-full max-w-4xl mx-auto">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnelData} layout="vertical" margin={{ left: 20, right: 100, top: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
              <XAxis type="number" hide />
              <YAxis 
                dataKey="name" 
                type="category" 
                axisLine={false} 
                tickLine={false}
                tick={{ fill: '#475569', fontSize: 13, fontWeight: 'bold' }}
                width={200}
              />
              <Tooltip 
                cursor={{ fill: '#f8fafc' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={40}>
                <LabelList dataKey="value" position="right" style={{ fill: '#0f172a', fontWeight: 'black', fontSize: 20 }} />
                {funnelData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// Also define UserCheck briefly if missing
const UserCheck = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <polyline points="16 11 18 13 22 9" />
  </svg>
);
