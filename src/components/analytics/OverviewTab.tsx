import React, { useMemo } from "react";
import { AnalyticsData, QUESTIONS, getRatingsArray } from "./types";
import { BookOpen, Users, UserCheck, CheckCircle, Award, Star, MessageSquareText, TrendingUp, Presentation } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

export const OverviewTab: React.FC<{ data: AnalyticsData }> = ({ data }) => {
  const stats = useMemo(() => {
    // Basic counts
    const totalCourses = data.courses.length;
    const totalRegistrations = data.registrations.length;
    
    // Attendee counts
    const attendedRegs = data.registrations.filter(r => r.attended);
    const totalAttendees = attendedRegs.length;
    
    // Competion & Certs
    // Notice: Based on system, just attending might mean completion, or certStatus 'sent'. 
    // We assume completion = attended for now, certs = certStatus === 'sent'
    const totalCompleted = attendedRegs.length; 
    const totalCerts = data.registrations.filter(r => r.certStatus === 'sent').length;

    // Evaluations
    const totalEvals = data.evaluations.length;
    
    // Calculate Average Satisfaction
    let avgSatisfaction = 0;
    if (totalEvals > 0) {
      const sum = data.evaluations.reduce((acc, curr) => {
        // Average of all 10 questions for this evaluation
        const qSum = getRatingsArray(curr.ratings).reduce((a: number, b: number) => a + b, 0);
        return acc + (qSum / 10);
      }, 0);
      avgSatisfaction = sum / totalEvals;
    }

    // Rates
    const attendanceRate = totalRegistrations > 0 ? (totalAttendees / totalRegistrations) * 100 : 0;
    const completionRate = totalAttendees > 0 ? (totalCompleted / totalAttendees) * 100 : 0;
    // Response rate based on total attendees
    const responseRate = totalAttendees > 0 ? (totalEvals / totalAttendees) * 100 : 0;

    return {
      totalCourses,
      totalRegistrations,
      totalAttendees,
      totalCompleted,
      totalCerts,
      totalEvals,
      avgSatisfaction: avgSatisfaction.toFixed(2),
      attendanceRate: attendanceRate.toFixed(1),
      completionRate: completionRate.toFixed(1),
      responseRate: responseRate.toFixed(1)
    };
  }, [data]);

  // Chart data: Satisfaction Distribution
  const satisfactionDistribution = useMemo(() => {
    let _4_5_to_5 = 0; // ดีมาก
    let _3_5_to_4_5 = 0; // ดี
    let _2_5_to_3_5 = 0; // ปานกลาง
    let below_2_5 = 0; // ต้องปรับปรุง

    data.evaluations.forEach(e => {
      const qSum = getRatingsArray(e.ratings).reduce((a: number, b: number) => a + b, 0);
      const avg = qSum / 10;
      if (avg >= 4.51) _4_5_to_5++;
      else if (avg >= 3.51) _3_5_to_4_5++;
      else if (avg >= 2.51) _2_5_to_3_5++;
      else below_2_5++;
    });

    return [
      { name: "ดีมาก (4.51-5.00)", value: _4_5_to_5, color: "#16a34a" }, // emerald-600
      { name: "ดี (3.51-4.50)", value: _3_5_to_4_5, color: "#3b82f6" }, // blue-500
      { name: "ปานกลาง (2.51-3.50)", value: _2_5_to_3_5, color: "#f59e0b" }, // amber-500
      { name: "ต้องปรับปรุง (<2.50)", value: below_2_5, color: "#dc2626" }, // red-600
    ].filter(item => item.value > 0);
  }, [data.evaluations]);

  const KPICard = ({ title, value, subValue, icon: Icon, colorClass, borderClass }: any) => (
    <div className={`bg-white p-6 rounded-3xl border-l-4 ${borderClass} border-y border-r border-y-slate-200 border-r-slate-200 shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow`}>
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${colorClass}`}>
        <Icon className="w-7 h-7" />
      </div>
      <div>
        <p className="text-sm font-bold text-slate-500 mb-1">{title}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black text-slate-800 tracking-tight">{value}</span>
          {subValue && <span className="text-sm font-semibold text-slate-400">{subValue}</span>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <KPICard 
          title="หลักสูตรอบรม" 
          value={stats.totalCourses} 
          subValue="หลักสูตร"
          icon={Presentation} 
          colorClass="bg-blue-50 text-blue-600" 
          borderClass="border-l-blue-600" 
        />
        <KPICard 
          title="ผู้ลงทะเบียนทั้งหมด" 
          value={stats.totalRegistrations} 
          subValue="คน"
          icon={Users} 
          colorClass="bg-indigo-50 text-indigo-600" 
          borderClass="border-l-indigo-600" 
        />
        <KPICard 
          title="ผู้เข้าอบรมจริง" 
          value={stats.totalAttendees} 
          subValue={`(${stats.attendanceRate}%)`}
          icon={UserCheck} 
          colorClass="bg-emerald-50 text-emerald-600" 
          borderClass="border-l-emerald-600" 
        />
        <KPICard 
          title="รับ Certificate แล้ว" 
          value={stats.totalCerts} 
          subValue="ใบ"
          icon={Award} 
          colorClass="bg-amber-50 text-amber-600" 
          borderClass="border-l-amber-500" 
        />
        <KPICard 
          title="ความพึงพอใจเฉลี่ย" 
          value={stats.avgSatisfaction} 
          subValue="เต็ม 5.00"
          icon={Star} 
          colorClass="bg-crimson/10 text-crimson" 
          borderClass="border-l-crimson" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center items-center gap-2">
          <MessageSquareText className="w-8 h-8 text-slate-400 mb-2" />
          <p className="text-sm font-bold text-slate-500">อัตราการตอบแบบประเมิน (Response Rate)</p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-slate-800">{stats.responseRate}%</span>
          </div>
          <p className="text-xs text-slate-400 font-medium mt-1">จากผู้เข้าอบรมทั้งหมด ({stats.totalEvals}/{stats.totalAttendees})</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center items-center gap-2">
          <CheckCircle className="w-8 h-8 text-slate-400 mb-2" />
          <p className="text-sm font-bold text-slate-500">อัตราการผ่านการอบรม (Completion Rate)</p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-slate-800">{stats.completionRate}%</span>
          </div>
          <p className="text-xs text-slate-400 font-medium mt-1">จากผู้เข้าอบรมทั้งหมด ({stats.totalCompleted}/{stats.totalAttendees})</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <h3 className="text-sm font-bold text-slate-600 mb-4 text-center">สัดส่วนระดับความพึงพอใจ</h3>
          <div className="flex-1 min-h-[160px] relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={satisfactionDistribution}
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {satisfactionDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
            {/* Absolute center text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-black text-slate-800">{stats.totalEvals}</span>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Responses</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
