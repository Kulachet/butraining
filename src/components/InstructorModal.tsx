import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  UserCheck, 
  UserPlus, 
  Edit3, 
  AlertTriangle, 
  CreditCard, 
  User, 
  Mail, 
  Building2, 
  Award, 
  Loader2, 
  CheckCircle2, 
  Info 
} from "lucide-react";
import { Instructor } from "../types";
import { InstructorService, InstructorFormData } from "../lib/instructorService";
import toast from "react-hot-toast";

interface InstructorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  instructorToEdit?: Instructor | null;
  allInstructors: Instructor[];
}

export const InstructorModal: React.FC<InstructorModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  instructorToEdit,
  allInstructors,
}) => {
  const isEdit = Boolean(instructorToEdit);

  const [formData, setFormData] = useState<InstructorFormData>({
    id: "",
    name: "",
    email: "",
    department: "",
    position: "",
  });

  const [errors, setErrors] = useState<{
    id?: string;
    name?: string;
    email?: string;
    department?: string;
    general?: string;
  }>({});

  const [submitting, setSubmitting] = useState(false);

  // Extract unique departments for datalist autocomplete
  const existingDepartments = useMemo(() => {
    const depts = new Set<string>();
    allInstructors.forEach((inst) => {
      if (inst.department && inst.department.trim()) {
        depts.add(inst.department.trim());
      }
    });
    return Array.from(depts).sort();
  }, [allInstructors]);

  // Extract common academic positions for suggestions
  const commonPositions = [
    "อาจารย์",
    "อาจารย์ประจำ",
    "ผู้ช่วยศาสตราจารย์",
    "รองศาสตราจารย์",
    "ศาสตราจารย์",
    "ดร.",
  ];

  useEffect(() => {
    if (isOpen) {
      if (instructorToEdit) {
        setFormData({
          id: instructorToEdit.id || "",
          name: instructorToEdit.name || "",
          email: instructorToEdit.email || "",
          department: instructorToEdit.department || "",
          position: instructorToEdit.position || "",
          englishFullName: instructorToEdit.englishFullName || "",
          englishNameVerified: instructorToEdit.englishNameVerified === true,
        });
      } else {
        setFormData({
          id: "",
          name: "",
          email: "",
          department: "",
          position: "",
          englishFullName: "",
          englishNameVerified: false,
        });
      }
      setErrors({});
      setSubmitting(false);
    }
  }, [isOpen, instructorToEdit]);

  const isIdModified = useMemo(() => {
    if (!isEdit || !instructorToEdit) return false;
    return formData.id.trim() !== instructorToEdit.id.trim();
  }, [isEdit, instructorToEdit, formData.id]);

  const handleChange = (field: keyof InstructorFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear field-specific error as user types
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Client validation against all instructors
    const validation = InstructorService.validate(
      formData,
      allInstructors,
      instructorToEdit?.id
    );

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      if (isEdit && instructorToEdit) {
        await InstructorService.updateInstructor(formData, instructorToEdit);
        toast.success(`อัปเดตข้อมูลอาจารย์ ${formData.name} สำเร็จ`);
      } else {
        await InstructorService.createInstructor(formData);
        toast.success(`เพิ่มอาจารย์ ${formData.name} สำเร็จ`);
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error("Save instructor error:", err);
      const msg = err?.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล";
      setErrors({ general: msg });
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!submitting ? onClose : undefined}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl overflow-hidden my-8 z-10 border border-slate-100"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 sm:p-8 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                  isEdit ? "bg-amber-500/10 text-amber-600" : "bg-crimson/10 text-crimson"
                }`}>
                  {isEdit ? <Edit3 className="w-6 h-6" /> : <UserPlus className="w-6 h-6" />}
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-[#333333] tracking-tight">
                    {isEdit ? "แก้ไขข้อมูลอาจารย์" : "เพิ่มอาจารย์ใหม่"}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 font-normal mt-0.5">
                    {isEdit 
                      ? "แก้ไขรายละเอียดและสถานะของอาจารย์ในระบบ" 
                      : "บันทึกข้อมูลอาจารย์เข้าสู่ฐานข้อมูลกลางของระบบ"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* General Error Banner */}
            {errors.general && (
              <div className="mx-6 sm:mx-8 mt-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-600 text-sm">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <span>{errors.general}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5">
              {/* Row 1: Instructor ID */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-slate-400" />
                    รหัสประจำตัวอาจารย์ <span className="text-crimson">*</span>
                  </label>
                  {isEdit && instructorToEdit?.uid && (
                    <span className="text-[11px] bg-green-50 text-green-700 px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1 border border-green-200">
                      <UserCheck className="w-3 h-3 text-green-600" />
                      เชื่อมต่อบัญชี Google แล้ว
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={formData.id}
                  onChange={(e) => handleChange("id", e.target.value)}
                  placeholder="เช่น A67013 หรือ 12345"
                  className={`w-full px-4 py-3 bg-slate-50 border rounded-2xl text-[14px] sm:text-[15px] text-[#333333] font-medium outline-none transition-all uppercase ${
                    errors.id 
                      ? "border-red-300 focus:ring-2 focus:ring-red-400 bg-red-50/20" 
                      : "border-slate-200 focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                  }`}
                  disabled={submitting}
                />
                {errors.id ? (
                  <p className="text-xs text-red-500 font-medium pl-1">{errors.id}</p>
                ) : (
                  <p className="text-[11px] text-slate-400 pl-1">
                    รหัสประจำตัวที่ใช้อ้างอิงในระบบและเอกสารประเมิน
                  </p>
                )}

                {/* ID Migration Warning */}
                {isIdModified && (
                  <div className="mt-2 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-xs text-amber-800">
                    <Info className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                      <p className="font-semibold">กำลังเปลี่ยนรหัสอาจารย์:</p>
                      <p>
                        ระบบจะทำการย้ายประวัติการลงทะเบียนและหลักสูตรจากรหัส{" "}
                        <span className="font-mono font-bold bg-amber-100 px-1 py-0.5 rounded">
                          {instructorToEdit?.id}
                        </span>{" "}
                        ไปยังรหัสใหม่{" "}
                        <span className="font-mono font-bold bg-amber-100 px-1 py-0.5 rounded">
                          {formData.id.trim()}
                        </span>{" "}
                        โดยอัตโนมัติอย่างปลอดภัย
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Row 2: Full Name */}
              <div className="space-y-1.5">
                <label className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400" />
                  ชื่อ-นามสกุล <span className="text-crimson">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  placeholder="เช่น ผศ.ดร. สมชาย ใจดี"
                  className={`w-full px-4 py-3 bg-slate-50 border rounded-2xl text-[14px] sm:text-[15px] text-[#333333] font-medium outline-none transition-all ${
                    errors.name 
                      ? "border-red-300 focus:ring-2 focus:ring-red-400 bg-red-50/20" 
                      : "border-slate-200 focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                  }`}
                  disabled={submitting}
                />
                {errors.name && (
                  <p className="text-xs text-red-500 font-medium pl-1">{errors.name}</p>
                )}
              </div>

              {/* Row 2B: English Full Name (Optional) */}
              <div className="space-y-1.5">
                <label className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <User className="w-4 h-4 text-slate-400" />
                    ชื่อ-นามสกุล ภาษาอังกฤษ (English Name) <span className="text-slate-400 font-normal">(ถ้ามี)</span>
                  </span>
                  <span className="text-[11px] text-slate-400">สำหรับอีเมลยืนยันหลักสูตรภาษาอังกฤษ</span>
                </label>
                <input
                  type="text"
                  value={formData.englishFullName || ""}
                  onChange={(e) => handleChange("englishFullName", e.target.value)}
                  placeholder="เช่น Asst. Prof. Dr. Somchai Jaidee"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-[14px] sm:text-[15px] text-[#333333] font-medium outline-none transition-all focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                  disabled={submitting}
                />
                <p className="text-[11px] text-slate-400 pl-1">
                  ใช้สำหรับระบุชื่อในอีเมลยืนยันการลงทะเบียนหลักสูตรภาษาอังกฤษ (หากเว้นว่าง ระบบจะใช้ &quot;Dear Faculty Member&quot;)
                </p>
                {formData.englishFullName && formData.englishFullName.trim().length > 0 && (
                  <label className="flex items-center gap-2.5 mt-2 cursor-pointer select-none text-xs text-slate-700 bg-slate-100/80 hover:bg-slate-100 p-3 rounded-xl border border-slate-200 transition-colors">
                    <input
                      type="checkbox"
                      checked={Boolean(formData.englishNameVerified)}
                      onChange={(e) => setFormData(prev => ({ ...prev, englishNameVerified: e.target.checked }))}
                      className="rounded border-slate-300 text-crimson focus:ring-crimson w-4 h-4"
                      disabled={submitting}
                    />
                    <div>
                      <span className="font-semibold text-slate-800">อนุมัติการยืนยันชื่อภาษาอังกฤษ (Admin Verified)</span>
                      <p className="text-[11px] text-slate-500 m-0">อนุญาตให้ระบบใช้นามสกุล/ชื่อภาษาอังกฤษนี้ในอีเมลทางการแทน &quot;Dear Faculty Member&quot;</p>
                    </div>
                  </label>
                )}
              </div>

              {/* Row 3: University Email */}
              <div className="space-y-1.5">
                <label className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-slate-400" />
                  อีเมลมหาวิทยาลัย (University Email) <span className="text-crimson">*</span>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  placeholder="เช่น somchai.j@bu.ac.th"
                  className={`w-full px-4 py-3 bg-slate-50 border rounded-2xl text-[14px] sm:text-[15px] text-[#333333] font-medium outline-none transition-all ${
                    errors.email 
                      ? "border-red-300 focus:ring-2 focus:ring-red-400 bg-red-50/20" 
                      : "border-slate-200 focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                  }`}
                  disabled={submitting}
                />
                {errors.email ? (
                  <p className="text-xs text-red-500 font-medium pl-1">{errors.email}</p>
                ) : (
                  <p className="text-[11px] text-slate-400 pl-1">
                    ต้องเป็นอีเมลของมหาวิทยาลัยกรุงเทพเท่านั้น (@bu.ac.th)
                  </p>
                )}
              </div>

              {/* Row 4: Department & Academic Position */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-slate-400" />
                    คณะ / หน่วยงาน <span className="text-crimson">*</span>
                  </label>
                  <input
                    type="text"
                    list="departments-list"
                    value={formData.department}
                    onChange={(e) => handleChange("department", e.target.value)}
                    placeholder="เช่น คณะเทคโนโลยีสารสนเทศ"
                    className={`w-full px-4 py-3 bg-slate-50 border rounded-2xl text-[14px] sm:text-[15px] text-[#333333] font-medium outline-none transition-all ${
                      errors.department 
                        ? "border-red-300 focus:ring-2 focus:ring-red-400 bg-red-50/20" 
                        : "border-slate-200 focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                    }`}
                    disabled={submitting}
                  />
                  <datalist id="departments-list">
                    {existingDepartments.map((dept) => (
                      <option key={dept} value={dept} />
                    ))}
                  </datalist>
                  {errors.department && (
                    <p className="text-xs text-red-500 font-medium pl-1">{errors.department}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Award className="w-4 h-4 text-slate-400" />
                    ตำแหน่งทางวิชาการ <span className="text-slate-400 font-normal">(ถ้ามี)</span>
                  </label>
                  <input
                    type="text"
                    list="positions-list"
                    value={formData.position}
                    onChange={(e) => handleChange("position", e.target.value)}
                    placeholder="เช่น ผู้ช่วยศาสตราจารย์"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-[14px] sm:text-[15px] text-[#333333] font-medium outline-none transition-all focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                    disabled={submitting}
                  />
                  <datalist id="positions-list">
                    {commonPositions.map((pos) => (
                      <option key={pos} value={pos} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-6 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-6 py-3.5 rounded-2xl text-slate-600 font-semibold hover:bg-slate-100 transition-colors text-[14px] disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`px-8 py-3.5 rounded-2xl text-white font-semibold transition-all shadow-lg flex items-center gap-2 text-[14px] disabled:opacity-50 ${
                    isEdit 
                      ? "bg-amber-600 hover:bg-amber-700 shadow-amber-600/20" 
                      : "bg-crimson hover:bg-crimson-dark shadow-crimson/20"
                  }`}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      กำลังบันทึกข้อมูล...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      {isEdit ? "บันทึกการแก้ไข" : "เพิ่มอาจารย์"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
