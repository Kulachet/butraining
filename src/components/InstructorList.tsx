import React, { useEffect, useState } from "react";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Instructor } from "../types";
import { formatInstructorName } from "../lib/utils";
import { User, Mail, Building2, CreditCard, Loader2, Search, AlertCircle } from "lucide-react";

export const InstructorList: React.FC = () => {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "instructors"), 
      orderBy("id", "asc"),
      limit(500)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as Instructor[];
      setInstructors(data);
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error("Error in instructors listener:", err);
      setError("ไม่สามารถโหลดรายชื่ออาจารย์ได้ (Permission Denied)");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const filteredInstructors = instructors.filter(inst => 
    inst.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inst.id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inst.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20">
        <Loader2 className="w-10 h-10 text-crimson animate-spin mb-4" />
        <p className="text-slate-400 font-light tracking-wide">กำลังโหลดรายชื่ออาจารย์...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-3xl border border-red-100 p-20 text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-red-500 font-medium">{error}</p>
        <p className="text-slate-400 text-sm mt-2">กรุณาตรวจสอบว่าคุณเข้าสู่ระบบด้วยสิทธิ์ผู้ดูแลระบบ</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-full">
      <div className="p-6 border-b border-slate-50 flex flex-col sm:flex-row items-center justify-between gap-4">
        <h3 className="text-[20px] lg:text-[24px] font-semibold text-[#333333] tracking-[0.02em] leading-[1.6]">รายชื่ออาจารย์ทั้งหมด</h3>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="ค้นหาชื่อ หรือ รหัสอาจารย์..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-[14px] lg:text-[16px] font-normal text-[#4A4A4A] focus:ring-1 focus:ring-crimson/20"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50">
              <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest border-b border-slate-50">รหัสอาจารย์</th>
              <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest border-b border-slate-50">ชื่อ-นามสกุล</th>
              <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest border-b border-slate-50">อีเมล</th>
              <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest border-b border-slate-50">หน่วยงาน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredInstructors.length > 0 ? (
              filteredInstructors.map((inst) => (
                <tr key={inst.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-3 h-3 text-slate-300" />
                      <span className="text-[14px] lg:text-[16px] font-medium text-[#333333]">{inst.id}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <User className="w-3 h-3 text-slate-300" />
                      <span className="text-[14px] lg:text-[16px] font-normal text-[#4A4A4A] tracking-wide leading-[1.7]">{formatInstructorName(inst.name)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Mail className="w-3 h-3 text-slate-300" />
                      <span className="text-[14px] lg:text-[16px] font-normal text-slate-400">{inst.email}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3 h-3 text-slate-300" />
                      <span className="text-[14px] lg:text-[16px] font-normal text-slate-400 tracking-wide leading-[1.7]">{inst.department}</span>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-6 py-20 text-center text-slate-400 font-light tracking-wide">
                  ไม่พบข้อมูลอาจารย์ที่ค้นหา
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
