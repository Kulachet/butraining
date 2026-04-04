import React from "react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  PieChart,
  Pie
} from "recharts";

const DATA = [
  { name: "ความรู้ที่ได้รับ", score: 4.8 },
  { name: "วิทยากร", score: 4.9 },
  { name: "สถานที่/ระบบ", score: 4.5 },
  { name: "ความพึงพอใจรวม", score: 4.74 },
];

const PIE_DATA = [
  { name: "ดีมาก", value: 75, color: "#991b1b" },
  { name: "ดี", value: 20, color: "#dc2626" },
  { name: "พอใช้", value: 5, color: "#f87171" },
];

export const AnalyticsDashboard: React.FC = () => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Evaluation Scores */}
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-[20px] lg:text-[24px] font-semibold text-[#333333] tracking-[0.02em] leading-[1.6]">ผลการประเมินความพึงพอใจ (เฉลี่ย)</h3>
          <span className="text-2xl font-bold text-crimson">4.74</span>
        </div>
        
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={DATA} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" domain={[0, 5]} hide />
              <YAxis 
                dataKey="name" 
                type="category" 
                axisLine={false} 
                tickLine={false}
                tick={{ fontSize: 12, fontWeight: 700, fill: "#64748b" }}
              />
              <Tooltip 
                cursor={{ fill: "#f8fafc" }}
                contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }}
              />
              <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={24}>
                {DATA.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 3 ? "#991b1b" : "#cbd5e1"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Distribution */}
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-[20px] lg:text-[24px] font-semibold text-[#333333] mb-8 tracking-[0.02em] leading-[1.6]">สัดส่วนระดับความพึงพอใจ</h3>
        
        <div className="flex items-center">
          <div className="h-64 w-1/2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={PIE_DATA}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {PIE_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          
          <div className="w-1/2 space-y-4">
            {PIE_DATA.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-[14px] lg:text-[16px] font-normal text-[#4A4A4A]">{item.name}</span>
                </div>
                <span className="text-[14px] lg:text-[16px] font-bold text-[#333333]">{item.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
