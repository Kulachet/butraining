import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  UserPlus,
  Edit3,
  Search,
  UserCheck,
  Mail,
  Building2,
  Award,
  CreditCard,
  User,
  Clock,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Course, Instructor, Registration } from "../types";
import {
  RegistrationService,
  WalkInFormInput,
  findDuplicateCourseRegistration,
  validateWalkInFormData,
  getRegistrationSource,
} from "../lib/registrationService";
import { getCourseSessions, isMultiDayCourse, formatDateThai } from "../lib/utils";
import toast from "react-hot-toast";

interface WalkInModalProps {
  isOpen: boolean;
  onClose: () => void;
  course: Course;
  courseRegistrations: Registration[];
  allInstructors: Instructor[];
  editingRegistration?: Registration | null;
  onSaved?: (saved: Registration, mode: "created" | "updated" | "checked_in") => void;
}

function toLocalDateTimeInputValue(isoOrDate?: string | Date | null): string {
  const date =
    isoOrDate instanceof Date
      ? isoOrDate
      : isoOrDate
      ? new Date(isoOrDate)
      : new Date();
  const validDate = isNaN(date.getTime()) ? new Date() : date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${validDate.getFullYear()}-${pad(validDate.getMonth() + 1)}-${pad(
    validDate.getDate()
  )}T${pad(validDate.getHours())}:${pad(validDate.getMinutes())}`;
}

export const WalkInModal: React.FC<WalkInModalProps> = ({
  isOpen,
  onClose,
  course,
  courseRegistrations,
  allInstructors,
  editingRegistration,
  onSaved,
}) => {
  const isEdit = Boolean(editingRegistration);
  const courseSessions = useMemo(() => getCourseSessions(course), [course]);
  const isMulti = useMemo(() => isMultiDayCourse(course), [course]);

  const [entryMode, setEntryMode] = useState<"master" | "manual">("master");
  const [instructorSearch, setInstructorSearch] = useState("");
  const [selectedMasterUidOrId, setSelectedMasterUidOrId] = useState<string>("");

  const [formData, setFormData] = useState<WalkInFormInput>({
    instructorId: "",
    userName: "",
    userEmail: "",
    userDepartment: "",
    userPosition: "",
    checkInAt: toLocalDateTimeInputValue(new Date()),
    sessionId: courseSessions[0]?.id || "default",
    confirmAttended: false,
  });

  const [isCustomDepartment, setIsCustomDepartment] = useState(false);
  const [errors, setErrors] = useState<{
    userName?: string;
    userEmail?: string;
    userDepartment?: string;
    checkInAt?: string;
    confirmAttended?: string;
    general?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);
  const [markingExisting, setMarkingExisting] = useState(false);

  const existingDepartments = useMemo(() => {
    const depts = new Set<string>();
    allInstructors.forEach((inst) => {
      const trimmed = inst.department?.trim();
      if (trimmed) depts.add(trimmed);
    });
    return Array.from(depts).sort((a, b) => a.localeCompare(b, "th"));
  }, [allInstructors]);

  const departmentOptions = useMemo(() => {
    const options = [...existingDepartments];
    const currentDept = (formData.userDepartment || "").trim();
    if (currentDept && !options.includes(currentDept)) {
      options.unshift(currentDept);
    }
    return options;
  }, [existingDepartments, formData.userDepartment]);

  const commonPositions = [
    "อาจารย์",
    "อาจารย์ประจำ",
    "ผู้ช่วยศาสตราจารย์",
    "รองศาสตราจารย์",
    "ศาสตราจารย์",
    "ดร.",
    "บุคลากรสายสนับสนุน",
  ];

  useEffect(() => {
    if (!isOpen) return;

    const defaultSessionId = courseSessions[0]?.id || "default";

    if (editingRegistration) {
      const rawDept = editingRegistration.userDepartment || "";
      const trimmedDept = rawDept.trim();
      setEntryMode("manual");
      setInstructorSearch("");
      setSelectedMasterUidOrId("");
      setFormData({
        instructorId: editingRegistration.instructorId || "",
        userName: editingRegistration.userName || "",
        userEmail: editingRegistration.userEmail || "",
        userDepartment: existingDepartments.includes(trimmedDept) ? trimmedDept : rawDept,
        userPosition: editingRegistration.userPosition || "",
        checkInAt: toLocalDateTimeInputValue(editingRegistration.checkInAt || new Date()),
        sessionId: editingRegistration.sessionId || defaultSessionId,
        confirmAttended: Boolean(editingRegistration.attended),
      });
      setIsCustomDepartment(false);
    } else {
      setEntryMode(allInstructors.length > 0 ? "master" : "manual");
      setInstructorSearch("");
      setSelectedMasterUidOrId("");
      setFormData({
        instructorId: "",
        userName: "",
        userEmail: "",
        userDepartment: "",
        userPosition: "",
        checkInAt: toLocalDateTimeInputValue(new Date()),
        sessionId: defaultSessionId,
        confirmAttended: false,
      });
      setIsCustomDepartment(existingDepartments.length === 0);
    }

    setErrors({});
    setSubmitting(false);
    setMarkingExisting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingRegistration, course.id]);

  const filteredInstructors = useMemo(() => {
    const q = instructorSearch.trim().toLowerCase();
    const sorted = [...allInstructors].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "th")
    );
    if (!q) return sorted.slice(0, 40);
    return sorted
      .filter(
        (inst) =>
          (inst.name || "").toLowerCase().includes(q) ||
          (inst.id || "").toLowerCase().includes(q) ||
          (inst.email || "").toLowerCase().includes(q) ||
          (inst.department || "").toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [allInstructors, instructorSearch]);

  const duplicateRegistration = useMemo(() => {
    return findDuplicateCourseRegistration(courseRegistrations, {
      email: formData.userEmail,
      instructorId: formData.instructorId,
      excludeRegId: editingRegistration?.id,
    });
  }, [
    courseRegistrations,
    formData.userEmail,
    formData.instructorId,
    editingRegistration?.id,
  ]);

  const duplicateAlreadyAttended = useMemo(() => {
    if (!duplicateRegistration) return false;
    if (isMulti && formData.sessionId) {
      return Boolean(duplicateRegistration.attendedSessions?.[formData.sessionId]?.attended);
    }
    return Boolean(duplicateRegistration.attended);
  }, [duplicateRegistration, isMulti, formData.sessionId]);

  const handleSelectInstructor = (inst: Instructor) => {
    const key = inst.uid || inst.id || inst.email;
    setSelectedMasterUidOrId(key);
    const trimmedDept = (inst.department || "").trim();
    setFormData((prev) => ({
      ...prev,
      instructorId: inst.id || "",
      userName: inst.name || "",
      userEmail: (inst.email || "").toLowerCase().trim(),
      userDepartment: trimmedDept,
      userPosition: inst.position || "",
    }));
    setIsCustomDepartment(Boolean(trimmedDept && !existingDepartments.includes(trimmedDept)));
    setErrors({});
  };

  const handleFieldChange = <K extends keyof WalkInFormInput>(
    field: K,
    value: WalkInFormInput[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field in errors) {
      setErrors((prev) => ({ ...prev, [field]: undefined, general: undefined }));
    }
  };

  const handleMarkExistingAttended = async () => {
    if (!duplicateRegistration) return;
    setMarkingExisting(true);
    setErrors({});
    try {
      const updated = await RegistrationService.markExistingAsAttended({
        registrationId: duplicateRegistration.id,
        course,
        checkInAt: formData.checkInAt,
        sessionId: formData.sessionId,
      });
      toast.success(`บันทึกเช็คอินให้ "${updated.userName}" เรียบร้อยแล้ว`);
      onSaved?.(updated, "checked_in");
      onClose();
    } catch (err: any) {
      console.error("Mark existing attended error:", err);
      const msg = err?.message || "ไม่สามารถบันทึกเช็คอินได้";
      setErrors({ general: msg });
      toast.error(msg);
    } finally {
      setMarkingExisting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = validateWalkInFormData(formData, {
      requireAttendanceConfirmation: !isEdit,
    });
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    if (duplicateRegistration) {
      setErrors({
        general: `พบรายชื่อ "${duplicateRegistration.userName}" (${duplicateRegistration.userEmail}) อยู่ในหลักสูตรนี้แล้ว ไม่สามารถบันทึกซ้ำได้`,
      });
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      if (isEdit && editingRegistration) {
        const updated = await RegistrationService.updateWalkInParticipant(
          editingRegistration.id,
          course,
          formData
        );
        toast.success(`อัปเดตข้อมูล Walk-in ของ ${updated.userName} เรียบร้อยแล้ว`);
        onSaved?.(updated, "updated");
      } else {
        const created = await RegistrationService.addWalkInParticipant(course, formData);
        toast.success(`เพิ่มผู้เข้าอบรม Walk-in "${created.userName}" สำเร็จ`);
        onSaved?.(created, "created");
      }
      onClose();
    } catch (err: any) {
      console.error("Walk-in save error:", err);
      const msg =
        err?.code === "permission-denied"
          ? "คุณไม่มีสิทธิ์บันทึกข้อมูล Walk-in กรุณาตรวจสอบสิทธิ์ผู้ดูแลระบบ"
          : err?.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล Walk-in";
      setErrors({ general: msg });
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!submitting && !markingExisting ? onClose : undefined}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden my-8 z-10 border border-slate-100 max-h-[92vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/70 shrink-0">
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
                    isEdit
                      ? "bg-amber-500/10 text-amber-600"
                      : "bg-crimson/10 text-crimson"
                  }`}
                >
                  {isEdit ? <Edit3 className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-[#333333] tracking-tight">
                    {isEdit
                      ? "แก้ไขข้อมูลผู้เข้าอบรม Walk-in"
                      : "เพิ่มผู้เข้าอบรม Walk-in"}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                    หลักสูตร: {course.title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting || markingExisting}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Entry Method Selector (Create mode only) */}
              {!isEdit && (
                <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setEntryMode("master")}
                    className={`flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                      entryMode === "master"
                        ? "bg-white text-crimson shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    เลือกจากฐานข้อมูลอาจารย์ ({allInstructors.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryMode("manual")}
                    className={`flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                      entryMode === "manual"
                        ? "bg-white text-crimson shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    กรอกข้อมูลด้วยตนเอง (Manual)
                  </button>
                </div>
              )}

              {/* Searchable Instructor Master Picker */}
              {!isEdit && entryMode === "master" && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={instructorSearch}
                      onChange={(e) => setInstructorSearch(e.target.value)}
                      placeholder="ค้นหาชื่ออาจารย์, รหัสอาจารย์, อีเมล หรือคณะ..."
                      className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                    />
                  </div>
                  <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl">
                    {filteredInstructors.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        ไม่พบรายชื่ออาจารย์ที่ค้นหา — สามารถสลับไปแท็บ &ldquo;กรอกข้อมูลด้วยตนเอง&rdquo; ได้
                      </div>
                    ) : (
                      filteredInstructors.map((inst) => {
                        const key = inst.uid || inst.id || inst.email;
                        const isSelected = selectedMasterUidOrId === key;
                        const alreadyInCourse = findDuplicateCourseRegistration(
                          courseRegistrations,
                          { email: inst.email, instructorId: inst.id }
                        );
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => handleSelectInstructor(inst)}
                            className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors ${
                              isSelected ? "bg-crimson/5" : ""
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-slate-800 truncate">
                                  {inst.name}
                                </span>
                                {inst.id && (
                                  <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                    {inst.id}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 truncate">
                                {inst.email} • {inst.department || "-"}
                              </div>
                            </div>
                            {alreadyInCourse ? (
                              <span
                                className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  alreadyInCourse.attended
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {alreadyInCourse.attended
                                  ? "มาอบรมแล้ว"
                                  : "ลงทะเบียนไว้แล้ว"}
                              </span>
                            ) : isSelected ? (
                              <CheckCircle2 className="w-4 h-4 text-crimson shrink-0" />
                            ) : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Duplicate Detection Banner */}
              {duplicateRegistration && (
                <div
                  className={`p-4 rounded-2xl border flex flex-col gap-3 ${
                    duplicateAlreadyAttended
                      ? "bg-red-50 border-red-200 text-red-800"
                      : "bg-amber-50 border-amber-200 text-amber-900"
                  }`}
                >
                  <div className="flex items-start gap-2.5 text-sm">
                    <AlertTriangle
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        duplicateAlreadyAttended ? "text-red-600" : "text-amber-600"
                      }`}
                    />
                    <div className="space-y-1">
                      <p className="font-bold">
                        {duplicateAlreadyAttended
                          ? "ผู้เข้าร่วมรายนี้ถูกบันทึกการเข้าอบรมในหลักสูตรนี้แล้ว"
                          : "พบรายชื่อลงทะเบียนไว้แล้วในหลักสูตรนี้ (ยังไม่ได้เช็คอิน)"}
                      </p>
                      <p className="text-xs opacity-90">
                        ชื่อ: <b>{duplicateRegistration.userName}</b> ({duplicateRegistration.userEmail}) • ประเภท:{" "}
                        <span className="font-semibold uppercase">
                          {getRegistrationSource(duplicateRegistration) === "walk_in"
                            ? "Walk-in"
                            : "Online"}
                        </span>
                      </p>
                    </div>
                  </div>

                  {!isEdit && !duplicateAlreadyAttended && (
                    <button
                      type="button"
                      onClick={handleMarkExistingAttended}
                      disabled={markingExisting}
                      className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                    >
                      {markingExisting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <UserCheck className="w-4 h-4" />
                      )}
                      ยืนยันเช็คอินรายชื่อที่ลงทะเบียนไว้แล้ว (ไม่สร้างรายการซ้ำ)
                    </button>
                  )}
                </div>
              )}

              {/* General Error Banner */}
              {errors.general && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2.5 text-red-700 text-xs sm:text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errors.general}</span>
                </div>
              )}

              {/* Form Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                    รหัสอาจารย์ <span className="text-slate-400 font-normal">(ถ้ามี)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.instructorId || ""}
                    onChange={(e) => handleFieldChange("instructorId", e.target.value)}
                    placeholder="เช่น A67013"
                    disabled={submitting}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-[#333333] uppercase outline-none focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    ชื่อ-นามสกุล <span className="text-crimson">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.userName}
                    onChange={(e) => handleFieldChange("userName", e.target.value)}
                    placeholder="เช่น ผศ.ดร. สมชาย ใจดี"
                    disabled={submitting}
                    className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-sm text-[#333333] outline-none ${
                      errors.userName
                        ? "border-red-300 bg-red-50/30"
                        : "border-slate-200 focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                    }`}
                  />
                  {errors.userName && (
                    <p className="text-xs text-red-500 font-medium">{errors.userName}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    อีเมลมหาวิทยาลัย (@bu.ac.th) <span className="text-crimson">*</span>
                  </label>
                  <input
                    type="email"
                    value={formData.userEmail}
                    onChange={(e) => handleFieldChange("userEmail", e.target.value)}
                    placeholder="somchai.j@bu.ac.th"
                    disabled={submitting}
                    className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-sm text-[#333333] outline-none ${
                      errors.userEmail
                        ? "border-red-300 bg-red-50/30"
                        : "border-slate-200 focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                    }`}
                  />
                  {errors.userEmail && (
                    <p className="text-xs text-red-500 font-medium">{errors.userEmail}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-slate-400" />
                    ตำแหน่งทางวิชาการ <span className="text-slate-400 font-normal">(ถ้ามี)</span>
                  </label>
                  <input
                    type="text"
                    list="walkin-positions-list"
                    value={formData.userPosition || ""}
                    onChange={(e) => handleFieldChange("userPosition", e.target.value)}
                    placeholder="เช่น ผู้ช่วยศาสตราจารย์"
                    disabled={submitting}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-[#333333] outline-none focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                  />
                  <datalist id="walkin-positions-list">
                    {commonPositions.map((pos) => (
                      <option key={pos} value={pos} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="walkin-department-field"
                      className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                    >
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      คณะ / หน่วยงาน <span className="text-crimson">*</span>
                    </label>
                    {isCustomDepartment && departmentOptions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomDepartment(false);
                          handleFieldChange("userDepartment", departmentOptions[0] || "");
                        }}
                        className="text-[11px] font-medium text-crimson hover:underline"
                      >
                        เลือกจากรายการ
                      </button>
                    )}
                  </div>
                  {isCustomDepartment ? (
                    <input
                      id="walkin-department-field"
                      type="text"
                      value={formData.userDepartment}
                      onChange={(e) => handleFieldChange("userDepartment", e.target.value)}
                      placeholder="เช่น คณะเทคโนโลยีสารสนเทศและนวัตกรรม"
                      disabled={submitting}
                      className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-sm text-[#333333] outline-none ${
                        errors.userDepartment
                          ? "border-red-300 bg-red-50/30"
                          : "border-slate-200 focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                      }`}
                    />
                  ) : (
                    <select
                      id="walkin-department-field"
                      value={formData.userDepartment}
                      onChange={(e) => {
                        if (e.target.value === "__CUSTOM_DEPARTMENT__") {
                          setIsCustomDepartment(true);
                          handleFieldChange("userDepartment", "");
                        } else {
                          handleFieldChange("userDepartment", e.target.value);
                        }
                      }}
                      disabled={submitting}
                      className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-sm text-[#333333] outline-none ${
                        errors.userDepartment
                          ? "border-red-300 bg-red-50/30"
                          : "border-slate-200 focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                      }`}
                    >
                      <option value="">-- เลือกคณะ / หน่วยงาน --</option>
                      {departmentOptions.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                      <option value="__CUSTOM_DEPARTMENT__">+ กรอกคณะ / หน่วยงานใหม่...</option>
                    </select>
                  )}
                  {errors.userDepartment && (
                    <p className="text-xs text-red-500 font-medium">{errors.userDepartment}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    วัน-เวลาเช็คอินเข้าอบรม <span className="text-crimson">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.checkInAt}
                    onChange={(e) => handleFieldChange("checkInAt", e.target.value)}
                    disabled={submitting}
                    className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-sm text-[#333333] outline-none ${
                      errors.checkInAt
                        ? "border-red-300 bg-red-50/30"
                        : "border-slate-200 focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                    }`}
                  />
                  {errors.checkInAt && (
                    <p className="text-xs text-red-500 font-medium">{errors.checkInAt}</p>
                  )}
                </div>
              </div>

              {/* Multi-day Session Selector */}
              {isMulti && courseSessions.length > 1 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    วันที่ / รอบอบรมที่เข้าร่วม
                  </label>
                  <select
                    value={formData.sessionId || courseSessions[0]?.id || ""}
                    onChange={(e) => handleFieldChange("sessionId", e.target.value)}
                    disabled={submitting}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-[#333333] outline-none focus:border-crimson focus:ring-2 focus:ring-crimson/10"
                  >
                    {courseSessions.map((s, idx) => (
                      <option key={s.id} value={s.id}>
                        {s.sessionName || `วันที่ ${idx + 1}`}{" "}
                        {s.date ? `(${formatDateThai(s.date)})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Explicit Attendance Confirmation Checkbox */}
              <div
                className={`p-4 rounded-2xl border transition-colors ${
                  errors.confirmAttended
                    ? "bg-red-50/60 border-red-300"
                    : formData.confirmAttended
                    ? "bg-emerald-50/60 border-emerald-200"
                    : "bg-slate-50 border-slate-200"
                }`}
              >
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.confirmAttended}
                    onChange={(e) => handleFieldChange("confirmAttended", e.target.checked)}
                    disabled={submitting}
                    className="mt-0.5 w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
                  />
                  <div className="space-y-0.5">
                    <span className="text-sm font-bold text-slate-800 block">
                      ยืนยันว่าผู้เข้าร่วมได้เข้าอบรมจริง
                    </span>
                    <span className="text-xs text-slate-500 block">
                      ระบบจะบันทึกสถานะมาอบรมจริง (attended = true) พร้อมชื่อบัญชีผู้ดูแลระบบที่บันทึก และนับรวมในรายงานผู้เข้าอบรมจริงทันที (ไม่สร้างบัญชีผู้ใช้หรือบันทึกแบบประเมินแทน)
                    </span>
                  </div>
                </label>
                {errors.confirmAttended && (
                  <p className="text-xs text-red-600 font-medium mt-2 pl-7">
                    {errors.confirmAttended}
                  </p>
                )}
              </div>

              {/* Footer Actions */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting || markingExisting}
                  className="px-5 py-2.5 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 transition-colors text-sm disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={
                    submitting ||
                    markingExisting ||
                    Boolean(duplicateRegistration) ||
                    (!isEdit && !formData.confirmAttended)
                  }
                  className={`px-6 py-2.5 rounded-xl text-white font-semibold transition-all shadow-md flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed ${
                    isEdit
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-crimson hover:bg-crimson-dark"
                  }`}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      กำลังบันทึก...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      {isEdit ? "บันทึกการแก้ไข" : "บันทึกผู้เข้าอบรม Walk-in"}
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
