import React, { useMemo } from "react";
import { AnalyticsData, getRatingsArray } from "./types";
import { Download, TrendingUp, BarChart3, LineChart as LineChartIcon, Printer } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, AreaChart, Area } from "recharts";
import Papa from "papaparse";
import toast from "react-hot-toast";

export const KPIReportTab: React.FC<{ data: AnalyticsData }> = ({ data }) => {
  const trendData = useMemo(() => {
    // Process data to group by month
    const monthsMap: Record<string, any> = {};

    // Generate last 6 months just as baseline
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthsMap[mKey] = {
        name: d.toLocaleString('th-TH', { month: 'short' }),
        courses: 0,
        participants: 0,
        completed: 0,
        certs: 0,
        evalCount: 0,
        evalSum: 0
      };
    }

    data.courses.forEach(c => {
      if (!c.date) return;
      // try to parse date. Assuming YYYY-MM-DD or similar standard format
      try {
        const d = new Date(c.date);
        if (isNaN(d.getTime())) return;
        
        const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthsMap[mKey]) {
          monthsMap[mKey] = {
            name: d.toLocaleString('th-TH', { month: 'short' }),
            courses: 0, participants: 0, completed: 0, certs: 0, evalCount: 0, evalSum: 0
          };
        }
        monthsMap[mKey].courses += 1;

        // Find regs for this course
        const regs = data.registrations.filter(r => r.courseId === c.id);
        const attended = regs.filter(r => r.attended);
        const certs = regs.filter(r => r.certStatus === 'sent');
        
        monthsMap[mKey].participants += regs.length;
        monthsMap[mKey].completed += attended.length;
        monthsMap[mKey].certs += certs.length;

        // Find evals
        const evals = data.evaluations.filter(e => e.courseId === c.id);
        monthsMap[mKey].evalCount += evals.length;
        monthsMap[mKey].evalSum += evals.reduce((acc, curr) => acc + (getRatingsArray(curr.ratings).reduce((a:number,b:number) => a+b, 0) / 10), 0);

      } catch (e) {}
    });

    return Object.keys(monthsMap).sort().map(key => {
      const m = monthsMap[key];
      return {
        key,
        name: m.name,
        courses: m.courses,
        participants: m.participants,
        completed: m.completed,
        certs: m.certs,
        completionRate: m.participants > 0 ? Number(((m.completed / m.participants) * 100).toFixed(1)) : 0,
        avgSatisfaction: m.evalCount > 0 ? Number((m.evalSum / m.evalCount).toFixed(2)) : 0
      };
    });

  }, [data]);

  const handleExportCSV = (type: 'evaluations' | 'registrations' | 'feedback' | 'summary') => {
    let csvData: any[] = [];
    let filename = "";

    if (type === 'evaluations') {
      csvData = data.evaluations.map((e, index) => {
        const row: any = { ลำดับ: index + 1, 'ชื่อ-นามสกุล': e.userName, อีเมล: e.userEmail };
        const ratingsArray = getRatingsArray(e.ratings);
        for (let i = 0; i < 10; i++) row[`ข้อที่ ${i+1}`] = ratingsArray[i] || "-";
        row["ข้อเสนอแนะ"] = e.suggestion || "-";
        return row;
      });
      filename = "ผลประเมินทั้งหมด.csv";
    } 
    else if (type === 'registrations') {
      csvData = data.registrations.map((r, i) => ({
        ลำดับ: i+1,
        'ชื่อ-นามสกุล': r.userName,
        อีเมล: r.userEmail,
        หลักสูตร: r.courseTitle || r.courseId,
        สถานะเข้าร่วม: r.attended ? "เข้าอบรม" : "ไม่เข้าอบรม",
        สถานะใบประกาศ: r.certStatus === 'sent' ? "ส่งแล้ว" : "ยังไม่ส่ง"
      }));
      filename = "รายชื่อผู้ลงทะเบียนและเข้าอบรม.csv";
    }
    else if (type === 'feedback') {
      csvData = data.evaluations.filter(e => e.suggestion).map((e, i) => ({
        ลำดับ: i+1,
        'ชื่อ-นามสกุล': e.userName,
        หลักสูตร: e.courseId,
        ข้อเสนอแนะ: e.suggestion
      }));
      filename = "ข้อเสนอแนะจากผู้เข้าอบรม.csv";
    }
    else if (type === 'summary') {
      csvData = trendData.map(t => ({
        เดือน: t.name,
        'จำนวนหลักสูตร': t.courses,
        'ผู้ลงทะเบียน': t.participants,
        'ผ่านการอบรม(คน)': t.completed,
        'อัตราการผ่าน(%)': t.completionRate,
        'คะแนนความพึงพอใจ': t.avgSatisfaction
      }));
      filename = "Executive_Summary_Report.csv";
    }

    if (csvData.length === 0) {
      toast.error("ไม่มีข้อมูลสำหรับดาวน์โหลด");
      return;
    }

    const csv = Papa.unparse(csvData);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`ดาวน์โหลดไฟล์ ${filename} เรียบร้อยแล้ว`);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div>
          <h3 className="text-xl font-bold text-slate-800">Export & Reports</h3>
          <p className="text-sm text-slate-500 mt-1">ดาวน์โหลดข้อมูลดิบและรายงานผู้บริหาร</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => handleExportCSV('summary')} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-xl flex items-center gap-2 transition-colors">
            <Download className="w-4 h-4" /> Executive Summary
          </button>
          <button onClick={() => handleExportCSV('evaluations')} className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-sm font-bold rounded-xl flex items-center gap-2 transition-colors">
            <Download className="w-4 h-4" /> ผลประเมินทั้งหมด
          </button>
          <button onClick={() => handleExportCSV('registrations')} className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-sm font-bold rounded-xl flex items-center gap-2 transition-colors">
            <Download className="w-4 h-4" /> ข้อมูลผู้เข้าร่วม
          </button>
          <button onClick={handlePrint} className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-bold rounded-xl flex items-center gap-2 transition-colors">
            <Printer className="w-4 h-4" /> พิมพ์ Dashboard (PDF)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend: Satisfaction */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <LineChartIcon className="w-5 h-5 text-indigo-500" />
            แนวโน้มคะแนนความพึงพอใจรายเดือน
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ left: 0, right: 20, top: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis domain={[0, 5]} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Line type="monotone" dataKey="avgSatisfaction" name="Satisfaction" stroke="#991b1b" strokeWidth={3} dot={{ r: 4, fill: '#991b1b', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trend: Participants & Completion */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
            ผู้เข้าอบรม vs ผูัผ่านการอบรมรายเดือน
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ left: 0, right: 20, top: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Area type="monotone" dataKey="participants" name="ผู้ลงทะเบียน" stroke="#94a3b8" fill="#e2e8f0" fillOpacity={0.6} />
                <Area type="monotone" dataKey="completed" name="ผ่านการอบรม" stroke="#16a34a" fill="#bbf7d0" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
