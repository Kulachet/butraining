import React from "react";
import { motion } from "motion/react";
import { Instructor } from "../types";
import { formatInstructorName } from "../lib/utils";
import { User, Mail, Building2, ShieldCheck, CreditCard } from "lucide-react";

interface InstructorProfileProps {
  instructor: Instructor;
}

export const InstructorProfile: React.FC<InstructorProfileProps> = ({ instructor }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-100"
    >
      <div className="p-12">
        <div className="flex items-center gap-6 mb-12">
          <div className="w-20 h-20 bg-crimson/10 rounded-3xl flex items-center justify-center text-crimson shadow-xl shadow-crimson/5">
            <User className="w-10 h-10" />
          </div>
          <div>
            <h2 className="text-3xl font-medium text-slate-800 tracking-tight mb-2">ข้อมูลโปรไฟล์อาจารย์</h2>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest">
              <ShieldCheck className="w-4 h-4 text-green-500" />
              <span>Verified Instructor Account</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
              <CreditCard className="w-3 h-3" /> รหัสอาจารย์
            </label>
            <div className="bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100 text-slate-800 font-light tracking-wide">
              {instructor.id || "N/A"}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
              <User className="w-3 h-3" /> ชื่อ-นามสกุล
            </label>
            <div className="bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100 text-slate-800 font-light tracking-wide">
              {formatInstructorName(instructor.name)}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
              <Mail className="w-3 h-3" /> อีเมลมหาวิทยาลัย
            </label>
            <div className="bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100 text-slate-800 font-light tracking-wide">
              {instructor.email}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
              <Building2 className="w-3 h-3" /> หน่วยงาน / คณะ
            </label>
            <div className="bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100 text-slate-800 font-light tracking-wide">
              {instructor.department}
            </div>
          </div>
        </div>

        <div className="mt-12 p-6 bg-crimson/5 rounded-3xl border border-crimson/10">
          <p className="text-xs text-crimson font-light leading-relaxed text-center tracking-wide">
            * ข้อมูลโปรไฟล์ถูกซิงค์จากฐานข้อมูลกลางของมหาวิทยาลัยโดยอัตโนมัติ <br />
            หากข้อมูลไม่ถูกต้อง กรุณาติดต่อสำนักพัฒนาการเรียนรู้
          </p>
        </div>
      </div>
    </motion.div>
  );
};
