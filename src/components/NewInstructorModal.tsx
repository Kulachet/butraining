import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { X, UserPlus } from "lucide-react";

const schema = z.object({
  name: z.string().min(2, "กรุณากรอกชื่อ-นามสกุล"),
  position: z.string().min(2, "กรุณากรอกตำแหน่งทางวิชาการ"),
  department: z.string().min(2, "กรุณากรอกคณะ/ภาควิชา"),
});

type FormData = z.infer<typeof schema>;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: FormData) => Promise<void>;
}

export const NewInstructorModal: React.FC<Props> = ({ isOpen, onClose, onSubmit }) => {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-crimson-light rounded-lg flex items-center justify-center">
                  <UserPlus className="w-6 h-6 text-crimson" />
                </div>
                <h2 className="text-xl font-medium text-slate-800 tracking-wide">ลงทะเบียนอาจารย์ใหม่</h2>
              </div>
              <button onClick={onClose} className="text-slate-300 hover:text-slate-500 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-light text-slate-500 tracking-wide">ชื่อ-นามสกุล</label>
                <input
                  {...register("name")}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-crimson focus:border-transparent outline-none transition-all font-light tracking-wide"
                  placeholder="เช่น ผศ.ดร. สมชาย ใจดี"
                />
                {errors.name && <p className="text-xs text-red-500 font-light">{errors.name.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-light text-slate-500 tracking-wide">ตำแหน่งทางวิชาการ</label>
                <input
                  {...register("position")}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-crimson focus:border-transparent outline-none transition-all font-light tracking-wide"
                  placeholder="เช่น อาจารย์ประจำ, ผู้ช่วยศาสตราจารย์"
                />
                {errors.position && <p className="text-xs text-red-500 font-light">{errors.position.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-light text-slate-500 tracking-wide">คณะ/ภาควิชา</label>
                <input
                  {...register("department")}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-crimson focus:border-transparent outline-none transition-all font-light tracking-wide"
                  placeholder="เช่น คณะเทคโนโลยีสารสนเทศและนวัตกรรม"
                />
                {errors.department && <p className="text-xs text-red-500 font-light">{errors.department.message}</p>}
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-crimson hover:bg-crimson-dark text-white font-medium py-4 rounded-xl shadow-lg shadow-crimson/10 transition-all disabled:opacity-50 tracking-wide"
                >
                  {isSubmitting ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
