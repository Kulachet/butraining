import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  ArrowLeft, 
  Save, 
  X, 
  Upload, 
  Calendar, 
  Clock, 
  Users, 
  MapPin, 
  Trash2, 
  Info, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  Image as ImageIcon, 
  Check, 
  Plus,
  AlertTriangle,
  Lock
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Course, Instructor, CourseSession } from "../types";
import { db, auth } from "../lib/firebase";
import { 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  serverTimestamp 
} from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { cn, formatInstructorName, formatDateThai, getCourseSessions } from "../lib/utils";

export interface SessionFormItem {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  sessionName?: string;
}

const schema = z.object({
  title: z.string().min(5, "ชื่อหลักสูตรต้องมีอย่างน้อย 5 ตัวอักษร"),
  academicYear: z.string().min(1, "กรุณาระบุปีการศึกษา"),
  instructorName: z.string().min(1, "กรุณาระบุชื่อวิทยากร"),
  description: z.string().min(10, "กรุณากรอกรายละเอียดหลักสูตร"),
  date: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  locationDetail: z.string().min(1, "กรุณาระบุสถานที่"),
  maxSeats: z.number().min(1, "จำนวนที่รับต้องมากกว่า 0"),
  status: z.enum(["Active", "Inactive"]),
  isVisible: z.boolean(),
  language: z.enum(["th", "en"]).optional(),
  imageUrl: z.string().optional(),
  bannerImageBase64: z.string().optional(),
  driveFolderId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export const CourseEditorPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;
  
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [existingRegistrationsCount, setExistingRegistrationsCount] = useState<number>(0);

  // Training Schedule Sessions State
  const [sessions, setSessions] = useState<SessionFormItem[]>([]);
  const [sessionsInitial, setSessionsInitial] = useState<string>("");

  useEffect(() => {
    const fetchInstructors = async () => {
      try {
        const snap = await getDocs(collection(db, "instructors"));
        const instList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Instructor));
        setInstructors(instList);
      } catch (error) {
        console.error("Error fetching instructors:", error);
      }
    };
    fetchInstructors();
  }, []);

  const { register, handleSubmit, watch, setValue, formState: { errors, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      status: "Active",
      isVisible: true,
      academicYear: "2568",
      maxSeats: 40,
      locationDetail: "",
      language: "th",
    }
  });

  const watchImageUrl = watch("imageUrl");
  const watchBannerImageBase64 = watch("bannerImageBase64");
  const watchIsVisible = watch("isVisible");
  const watchLanguage = watch("language") || "th";

  // Track if sessions have changed from initial load
  const isSessionsDirty = JSON.stringify(sessions) !== sessionsInitial;
  const isMultiDay = sessions.length > 1;

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (isEdit) {
          const courseSnap = await getDoc(doc(db, "courses", id));
          if (courseSnap.exists()) {
            const data = { id: courseSnap.id, ...courseSnap.data() } as Course;
            
            // Check existing registrations
            const totalRegs = data.totalRegistrations || data.enrolledSeats || 0;
            setExistingRegistrationsCount(totalRegs);

            // Populate sessions using centralized getCourseSessions
            const loadedSessions = getCourseSessions(data);
            const initialFormSessions: SessionFormItem[] = loadedSessions.map((s, idx) => ({
              id: s.id || `session_${idx + 1}`,
              date: s.date || "",
              startTime: s.startTime || "09:00",
              endTime: s.endTime || "12:00",
              sessionName: s.sessionName || `วันที่ ${idx + 1}`,
            }));
            
            setSessions(initialFormSessions);
            setSessionsInitial(JSON.stringify(initialFormSessions));

            // Populate form values
            Object.keys(data).forEach((key) => {
              if (key !== "sessions") {
                setValue(key as any, (data as any)[key]);
              }
            });

            // Ensure language defaults to 'th' if missing or invalid
            setValue("language", data.language === "en" ? "en" : "th");
          } else {
            toast.error("ไม่พบข้อมูลหลักสูตร");
            navigate("/admin");
          }
        } else {
          // New Course: Initialize with 1 default session
          const todayStr = new Date().toISOString().split('T')[0];
          const defaultSession: SessionFormItem = {
            id: crypto.randomUUID(),
            date: todayStr,
            startTime: "09:00",
            endTime: "12:00",
            sessionName: "วันที่ 1",
          };
          setSessions([defaultSession]);
          setSessionsInitial(JSON.stringify([defaultSession]));
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, isEdit, setValue, navigate]);

  // Session Handlers
  const handleAddSession = () => {
    let nextDate = new Date().toISOString().split('T')[0];
    let nextStartTime = "09:00";
    let nextEndTime = "12:00";

    if (sessions.length > 0) {
      const lastSession = sessions[sessions.length - 1];
      nextStartTime = lastSession.startTime || "09:00";
      nextEndTime = lastSession.endTime || "12:00";
      if (lastSession.date) {
        try {
          const parts = lastSession.date.split("-").map(Number);
          if (parts.length === 3) {
            const d = new Date(parts[0], parts[1] - 1, parts[2] + 1);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            nextDate = `${y}-${m}-${day}`;
          }
        } catch {
          // fallback to today
        }
      }
    }

    const newSession: SessionFormItem = {
      id: crypto.randomUUID(),
      date: nextDate,
      startTime: nextStartTime,
      endTime: nextEndTime,
      sessionName: `วันที่ ${sessions.length + 1}`,
    };

    const updated = [...sessions, newSession];
    setSessions(updated);
    toast.success(`เพิ่มวันอบรมที่ ${updated.length} แล้ว`);
  };

  const handleRemoveSession = (sessionId: string) => {
    if (sessions.length <= 1) {
      toast.error("ต้องมีวันอบรมอย่างน้อย 1 วัน");
      return;
    }
    const updated = sessions.filter(s => s.id !== sessionId);
    setSessions(updated);
    toast.success("ลบวันอบรมเรียบร้อยแล้ว");
  };

  const handleUpdateSession = (sessionId: string, field: "date" | "startTime" | "endTime", value: string) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, [field]: value } : s));
  };

  const handleSortSessionsChronologically = () => {
    const sorted = [...sessions].sort((a, b) => {
      const dateCmp = (a.date || "").localeCompare(b.date || "");
      if (dateCmp !== 0) return dateCmp;
      return (a.startTime || "").localeCompare(b.startTime || "");
    });
    setSessions(sorted);
    toast.success("จัดเรียงลำดับวันอบรมตามวันที่เรียบร้อย");
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!auth.currentUser) {
      toast.error("กรุณาเข้าสู่ระบบก่อนอัปโหลดรูปภาพ");
      return;
    }

    setUploadProgress(10);
    toast.loading("กำลังประมวลผลรูปภาพ...", { id: "upload-toast" });

    try {
      const compressImage = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX_WIDTH = 1024;
              const MAX_HEIGHT = 1024;
              let width = img.width;
              let height = img.height;

              if (width > height) {
                if (width > MAX_WIDTH) {
                  height *= MAX_WIDTH / width;
                  width = MAX_WIDTH;
                }
              } else {
                if (height > MAX_HEIGHT) {
                  width *= MAX_HEIGHT / height;
                  height = MAX_HEIGHT;
                }
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx?.drawImage(img, 0, 0, width, height);
              
              const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
              resolve(dataUrl);
            };
            img.onerror = reject;
          };
          reader.onerror = reject;
        });
      };

      setUploadProgress(40);
      const base64Image = await compressImage(file);
      
      setUploadProgress(80);
      setValue("bannerImageBase64", base64Image, { shouldDirty: true });
      
      toast.success("ประมวลผลรูปภาพสำเร็จ", { id: "upload-toast" });
      setUploadProgress(100);
      
      setTimeout(() => setUploadProgress(null), 1000);
    } catch (error: any) {
      console.error("Image processing error:", error);
      toast.error("เกิดข้อผิดพลาดในการประมวลผลรูปภาพ", { id: "upload-toast" });
      setUploadProgress(null);
    }
  };

  // Validation function
  const validateSessions = (): boolean => {
    if (sessions.length === 0) {
      toast.error("ต้องมีกำหนดการอบรมอย่างน้อย 1 วัน");
      return false;
    }

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      if (!s.date) {
        toast.error(`กรุณาระบุวันที่จัดอบรมสำหรับวันที่ ${i + 1}`);
        return false;
      }
      if (!s.startTime) {
        toast.error(`กรุณาระบุเวลาเริ่มสำหรับวันที่ ${i + 1}`);
        return false;
      }
      if (!s.endTime) {
        toast.error(`กรุณาระบุเวลาสิ้นสุดสำหรับวันที่ ${i + 1}`);
        return false;
      }
      if (s.endTime <= s.startTime) {
        toast.error(`เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม ในวันที่ ${i + 1} (${s.startTime} - ${s.endTime})`);
        return false;
      }
    }

    // Duplicate and overlapping time check
    for (let i = 0; i < sessions.length; i++) {
      for (let j = i + 1; j < sessions.length; j++) {
        const s1 = sessions[i];
        const s2 = sessions[j];
        if (s1.date === s2.date) {
          if (s1.startTime === s2.startTime && s1.endTime === s2.endTime) {
            toast.error(`พบวันและเวลาอบรมที่ซ้ำซ้อนกันในวันที่ ${formatDateThai(s1.date)}`);
            return false;
          }
          if (s1.startTime < s2.endTime && s2.startTime < s1.endTime) {
            toast.error(`พบช่วงเวลาอบรมที่คาบเกี่ยวกันในวันที่ ${formatDateThai(s1.date)}`);
            return false;
          }
        }
      }
    }

    return true;
  };

  const handleCancelClick = () => {
    if (isDirty || isSessionsDirty) {
      setShowUnsavedModal(true);
    } else {
      navigate("/admin");
    }
  };

  const onSubmit = async (data: FormData) => {
    if (!validateSessions()) return;

    setSaving(true);
    try {
      let existingEnrolledSeats = 0;
      
      if (isEdit) {
        const courseSnap = await getDoc(doc(db, "courses", id));
        if (courseSnap.exists()) {
          const existingData = courseSnap.data();
          if (existingData.sessions && existingData.sessions.length > 0) {
            existingEnrolledSeats = existingData.sessions[0].enrolledSeats || 0;
          } else {
            existingEnrolledSeats = existingData.enrolledSeats || 0;
          }
          
          if (existingData.totalRegistrations && existingData.totalRegistrations > existingEnrolledSeats) {
            existingEnrolledSeats = existingData.totalRegistrations;
          }
        }
      }

      // Sort sessions chronologically for storage
      const sorted = [...sessions].sort((a, b) => {
        const dateCmp = (a.date || "").localeCompare(b.date || "");
        if (dateCmp !== 0) return dateCmp;
        return (a.startTime || "").localeCompare(b.startTime || "");
      });

      const multiDay = sorted.length > 1;

      // Construct sessions array with both id and sessionId for 100% backward compatibility
      const finalSessions: CourseSession[] = sorted.map((s, idx) => ({
        id: s.id,
        sessionId: s.id,
        sessionName: `วันที่ ${idx + 1}`,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        locationType: "On-site",
        locationDetail: data.locationDetail,
        maxSeats: data.maxSeats,
        enrolledSeats: existingEnrolledSeats,
      }));

      const courseData: any = {
        ...data,
        date: sorted[0].date,
        startTime: sorted[0].startTime,
        endTime: sorted[0].endTime,
        sessions: finalSessions,
        isMultiDay: multiDay,
        multiDayPublicationBlocked: false,
        isVisible: data.isVisible,
        updatedAt: serverTimestamp(),
      };

      // Remove undefined values to prevent Firestore errors
      Object.keys(courseData).forEach(key => {
        if (courseData[key] === undefined) {
          delete courseData[key];
        }
      });

      if (isEdit) {
        await setDoc(doc(db, "courses", id), courseData, { merge: true });
        toast.success("บันทึกการแก้ไขเรียบร้อย");
      } else {
        const newCourseRef = doc(collection(db, "courses"));
        await setDoc(newCourseRef, {
          ...courseData,
          id: newCourseRef.id,
          createdAt: serverTimestamp(),
        });
        toast.success("สร้างหลักสูตรใหม่เรียบร้อย");
      }
      navigate("/admin");
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error(`บันทึกไม่สำเร็จ: ${error.message || "กรุณาลองใหม่อีกครั้ง"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteDoc(doc(db, "courses", id));
      toast.success("ลบหลักสูตรเรียบร้อยแล้ว");
      navigate("/admin");
    } catch (error) {
      toast.error("ลบไม่สำเร็จ");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-12 h-12 text-crimson animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Sticky Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            <div className="flex items-center gap-4">
              <button 
                onClick={handleCancelClick}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                title="ย้อนกลับ"
              >
                <ArrowLeft className="w-6 h-6 text-slate-400" />
              </button>
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight font-sans">
                  {isEdit ? "แก้ไขหลักสูตร" : "สร้างหลักสูตรใหม่"}
                </h1>
                {isMultiDay && (
                  <span className="text-[11px] font-bold text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                    กำหนดการหลายวัน ({sessions.length} วัน) - Phase 1
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                type="button"
                onClick={handleCancelClick}
                className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={handleSubmit(onSubmit)}
                disabled={saving || (!isDirty && !isSessionsDirty)}
                className="bg-crimson hover:bg-crimson-dark text-white text-sm font-bold px-8 py-2.5 rounded-xl shadow-lg shadow-crimson/20 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[3rem] shadow-2xl border border-slate-200 overflow-hidden"
        >
          <div className="p-8 sm:p-12">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
              {/* Left Column: Form Fields */}
              <div className="lg:col-span-2 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  {/* Row 1: Title & Academic Year */}
                  <div className="md:col-span-3 space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">ชื่อหลักสูตร *</label>
                    <input 
                      {...register("title")}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                      placeholder="เช่น การใช้งาน AI เพื่อการสอน"
                    />
                    {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">ปีการศึกษา *</label>
                    <input 
                      {...register("academicYear")}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                      placeholder="2568"
                    />
                  </div>

                  {/* Row 2: Instructor, Location, Capacity, Status */}
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">วิทยากร *</label>
                    <input 
                      {...register("instructorName")}
                      list="instructors-list"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                      placeholder="ชื่อ-นามสกุล วิทยากร"
                    />
                    <datalist id="instructors-list">
                      {instructors.map(inst => (
                        <option key={inst.id} value={formatInstructorName(inst.name, inst.id, inst.position)} />
                      ))}
                    </datalist>
                    {errors.instructorName && <p className="text-red-500 text-xs mt-1">{errors.instructorName.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">ห้อง / สถานที่ *</label>
                    <input 
                      {...register("locationDetail")}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                      placeholder="เช่น C6-505"
                    />
                    {errors.locationDetail && <p className="text-red-500 text-xs mt-1">{errors.locationDetail.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">จำนวนที่รับ (ท่าน) *</label>
                    <input 
                      type="number"
                      {...register("maxSeats", { valueAsNumber: true })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                      placeholder="40"
                    />
                    {errors.maxSeats && <p className="text-red-500 text-xs mt-1">{errors.maxSeats.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        ภาษาหลักสูตร (Course Language)
                      </label>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {watchLanguage === "en" ? "EN: English UI & Email" : "TH: ภาษาไทย"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 p-1.5 bg-slate-100 rounded-2xl border border-slate-200 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setValue("language", "th", { shouldDirty: true, shouldValidate: true })}
                        className={cn(
                          "py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2",
                          watchLanguage === "th"
                            ? "bg-white text-crimson shadow-md border border-slate-200 ring-2 ring-crimson/20"
                            : "text-slate-600 hover:text-slate-900"
                        )}
                      >
                        <span className="text-sm">🇹🇭</span>
                        <span>TH ภาษาไทย</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setValue("language", "en", { shouldDirty: true, shouldValidate: true })}
                        className={cn(
                          "py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2",
                          watchLanguage === "en"
                            ? "bg-white text-crimson shadow-md border border-slate-200 ring-2 ring-crimson/20"
                            : "text-slate-600 hover:text-slate-900"
                        )}
                      >
                        <span className="text-sm">🇬🇧</span>
                        <span>EN English</span>
                      </button>
                    </div>
                    <input type="hidden" {...register("language")} />
                    <p className="text-[11px] text-slate-500 leading-normal">
                      กำหนดภาษาสำหรับการแสดงผลบนหน้าเว็บ (Public UI) กำหนดการอบรม และอีเมลยืนยันการลงทะเบียนของหลักสูตรนี้
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">สถานะหลักสูตร</label>
                    <select 
                      {...register("status")}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium appearance-none"
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                {/* Training Schedule Section (กำหนดการอบรม) */}
                <div className="space-y-4 pt-6 border-t border-slate-100">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-crimson" />
                        <h3 className="text-base font-bold text-slate-800">
                          กำหนดการอบรม (Training Schedule)
                        </h3>
                        {isMultiDay && (
                          <span className="text-[11px] font-bold bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full">
                            {sessions.length} วันอบรม (Multi-day)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 font-light mt-1">
                        รองรับทั้งการอบรมวันเดียว และการอบรมหลายวัน (วันที่ต่อเนื่องหรือไม่ต่อเนื่อง และเวลาเริ่ม-สิ้นสุดแตกต่างกันได้)
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {sessions.length > 1 && (
                        <button
                          type="button"
                          onClick={handleSortSessionsChronologically}
                          className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-medium border border-slate-200 transition-colors"
                          title="จัดเรียงตามลำดับวันที่"
                        >
                          จัดเรียงตามวันที่
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleAddSession}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-crimson text-white hover:bg-crimson-dark rounded-xl text-xs font-bold transition-all shadow-md shadow-crimson/10"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        + เพิ่มวันอบรม
                      </button>
                    </div>
                  </div>

                  {/* Existing Registrations Notice */}
                  {existingRegistrationsCount > 0 && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-900 space-y-1">
                        <p className="font-bold">หลักสูตรนี้มีผู้ลงทะเบียนแล้ว {existingRegistrationsCount} ท่าน</p>
                        <p className="font-light">
                          การแก้ไขหรือลบวันอบรมที่มีอยู่แล้วอาจส่งผลกระทบต่อกำหนดการของผู้เข้าอบรม โปรดตรวจสอบความถูกต้องและแจ้งเตือนผู้เข้าอบรมล่วงหน้า
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Multi-day Phase 1 Restriction Notice */}
                  {isMultiDay && (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-3">
                      <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                      <div className="text-xs text-blue-900 space-y-1">
                        <p className="font-bold">หลักสูตรแบบหลายวัน (Phase 1: Schedule Editor & Display)</p>
                        <p className="font-light">
                          ท่านสามารถกำหนดวันอบรมและบันทึกข้อมูลได้ตามปกติ แต่ระบบจะจำกัดการเผยแพร่สู่สาธารณะ (Public) ไว้ชั่วคราว เพื่อความปลอดภัยของข้อมูล จนกว่าระบบลงทะเบียนและเช็คอินแบบหลายวัน (Phase 2) จะเสร็จสมบูรณ์
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Sessions List */}
                  <div className="space-y-3">
                    {sessions.map((session, index) => {
                      const isTimeInvalid = session.startTime && session.endTime && session.endTime <= session.startTime;
                      return (
                        <div 
                          key={session.id}
                          className="p-4 bg-white border border-slate-200 rounded-2xl transition-all hover:border-slate-300 shadow-sm"
                        >
                          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-lg bg-crimson text-white text-xs font-bold flex items-center justify-center">
                                {index + 1}
                              </span>
                              <span className="text-xs font-bold text-slate-800">
                                วันที่ {index + 1} {session.date ? `(${formatDateThai(session.date)})` : ""}
                              </span>
                            </div>

                            {sessions.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveSession(session.id)}
                                className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg transition-colors flex items-center gap-1 text-xs"
                                title="ลบวันอบรมนี้"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span className="text-[11px] font-medium hidden sm:inline">ลบวันอบรม</span>
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-crimson" /> วันที่จัดอบรม *
                              </label>
                              <input
                                type="date"
                                value={session.date}
                                onChange={(e) => handleUpdateSession(session.id, "date", e.target.value)}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-crimson outline-none font-medium text-slate-800"
                                required
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <Clock className="w-3 h-3 text-crimson" /> เวลาเริ่ม *
                              </label>
                              <input
                                type="time"
                                value={session.startTime}
                                onChange={(e) => handleUpdateSession(session.id, "startTime", e.target.value)}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-crimson outline-none font-medium text-slate-800"
                                required
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <Clock className="w-3 h-3 text-crimson" /> เวลาสิ้นสุด *
                              </label>
                              <input
                                type="time"
                                value={session.endTime}
                                onChange={(e) => handleUpdateSession(session.id, "endTime", e.target.value)}
                                className={cn(
                                  "w-full px-3 py-2.5 bg-slate-50 border rounded-xl text-sm focus:ring-2 outline-none font-medium text-slate-800",
                                  isTimeInvalid ? "border-red-400 focus:ring-red-400 bg-red-50/50" : "border-slate-200 focus:ring-crimson"
                                )}
                                required
                              />
                            </div>
                          </div>

                          {isTimeInvalid && (
                            <p className="text-red-500 text-xs mt-2 flex items-center gap-1 font-medium">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              เวลาสิ้นสุด ({session.endTime}) ต้องอยู่หลังเวลาเริ่ม ({session.startTime})
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">รายละเอียดหลักสูตร *</label>
                  <textarea 
                    {...register("description")}
                    rows={6}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium resize-none"
                    placeholder="อธิบายรายละเอียดหลักสูตร วัตถุประสงค์ และสิ่งที่จะได้รับ..."
                  />
                  {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description.message}</p>}
                </div>

                {/* Visibility Toggle */}
                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox"
                      id="isVisible"
                      {...register("isVisible")}
                      className="w-5 h-5 rounded border-slate-300 text-crimson focus:ring-crimson cursor-pointer"
                    />
                    <label 
                      htmlFor="isVisible" 
                      className="text-sm font-bold text-slate-700 cursor-pointer"
                    >
                      แสดงผลบนหน้าหลัก (Public)
                    </label>
                  </div>
                  <div className="ml-auto flex items-center gap-2 text-slate-400">
                    <Info className="w-4 h-4" />
                    <span className="text-[10px] uppercase tracking-widest font-bold">Visibility Toggle</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Cover Upload */}
              <div className="lg:col-span-1 space-y-4">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Course Cover (3:4)</label>
                <div className="aspect-[3/4] bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200 overflow-hidden relative group transition-all hover:border-crimson/30">
                  {(watchBannerImageBase64 || watchImageUrl) ? (
                    <>
                      <img src={watchBannerImageBase64 || watchImageUrl} alt="Cover Preview" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <label className="cursor-pointer p-3 bg-white text-crimson rounded-xl hover:scale-110 transition-transform">
                          <Upload className="w-5 h-5" />
                          <input type="file" className="hidden" onChange={handleImageUpload} accept="image/*" />
                        </label>
                        <button 
                          type="button"
                          onClick={() => {
                            setValue("imageUrl", "");
                            setValue("bannerImageBase64", "");
                          }}
                          className="p-3 bg-white text-red-500 rounded-xl hover:scale-110 transition-transform"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <label className="w-full h-full flex flex-col items-center justify-center gap-4 text-slate-400 hover:text-crimson transition-colors cursor-pointer">
                      <div className="w-16 h-16 rounded-2xl bg-white shadow-sm flex items-center justify-center">
                        {uploadProgress !== null ? (
                          <Loader2 className="w-8 h-8 text-crimson animate-spin" />
                        ) : (
                          <ImageIcon className="w-8 h-8" />
                        )}
                      </div>
                      <div className="text-center w-full px-8">
                        <p className="font-bold text-sm uppercase tracking-widest mb-2">
                          {uploadProgress !== null ? "Processing..." : "Upload Cover"}
                        </p>
                        {uploadProgress !== null && (
                          <div className="w-full space-y-2">
                            <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                              <div 
                                className="bg-crimson h-full transition-all duration-300" 
                                style={{ width: `${uploadProgress}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-bold text-crimson">{Math.round(uploadProgress)}%</p>
                          </div>
                        )}
                        <p className="text-[10px] mt-1">Portrait Ratio 3:4</p>
                      </div>
                      <input type="file" className="hidden" onChange={handleImageUpload} accept="image/*" />
                    </label>
                  )}
                  {uploadProgress !== null && (
                    <div className="absolute bottom-0 left-0 w-full h-1 bg-slate-100">
                      <div 
                        className="h-full bg-crimson transition-all duration-300" 
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  )}
                </div>
                
                <div className="p-6 bg-crimson/5 rounded-3xl border border-crimson/10 space-y-3">
                  <div className="flex items-center gap-2 text-crimson">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Tips</span>
                  </div>
                  <p className="text-xs text-slate-600 font-light leading-relaxed">
                    แนะนำให้ใช้รูปภาพแนวตั้งขนาด 1200 x 1600 พิกเซล เพื่อความคมชัดสูงสุดบนหน้าหลัก
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4 pt-12 border-t border-slate-100 mt-12">
              <button 
                type="button"
                onClick={handleCancelClick}
                className="flex-1 px-8 py-4 bg-white border border-slate-200 text-slate-600 font-bold rounded-2xl hover:bg-slate-50 transition-all"
              >
                ยกเลิก
              </button>
              <button 
                type="button"
                onClick={handleSubmit(onSubmit)}
                disabled={saving || (!isDirty && !isSessionsDirty)}
                className="flex-1 px-8 py-4 bg-crimson hover:bg-crimson-dark text-white font-bold rounded-2xl shadow-xl shadow-crimson/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                {isEdit ? "อัปเดตหลักสูตร" : "สร้างหลักสูตร"}
              </button>
            </div>
          </div>
        </motion.div>

        {isEdit && (
          <div className="mt-12 text-center">
            <button 
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-red-400 hover:text-red-600 font-bold text-sm transition-colors flex items-center gap-2 mx-auto"
            >
              <Trash2 className="w-4 h-4" />
              ลบหลักสูตรนี้อย่างถาวร
            </button>
          </div>
        )}
      </main>

      {/* Unsaved Changes Confirmation Modal */}
      <AnimatePresence>
        {showUnsavedModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowUnsavedModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-[2rem] shadow-2xl p-8 max-w-md w-full text-center"
            >
              <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-amber-500" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">ยกเลิกการแก้ไขหรือไม่?</h3>
              <p className="text-slate-500 text-sm mb-6 leading-relaxed font-light">
                คุณมีข้อมูลที่ยังไม่ได้บันทึก หากออกจากหน้านี้ การแก้ไขทั้งหมดจะไม่ถูกบันทึก
              </p>
              <div className="flex flex-col gap-2.5">
                <button 
                  type="button"
                  onClick={() => navigate("/admin")}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3.5 rounded-xl transition-all text-sm"
                >
                  ออกจากหน้านี้โดยไม่บันทึก
                </button>
                <button 
                  type="button"
                  onClick={() => setShowUnsavedModal(false)}
                  className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3.5 rounded-xl transition-all text-sm"
                >
                  แก้ไขต่อ
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDeleteConfirm(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-[2rem] shadow-2xl p-10 max-w-md w-full text-center"
            >
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertCircle className="w-10 h-10 text-red-500" />
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-2">Are you absolutely sure?</h3>
              <p className="text-slate-500 font-medium mb-8">
                การลบหลักสูตรนี้จะทำให้ข้อมูลการลงทะเบียนทั้งหมดหายไป และไม่สามารถกู้คืนได้
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  type="button"
                  onClick={handleDelete}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-4 rounded-2xl transition-all"
                >
                  Yes, Delete Permanently
                </button>
                <button 
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-4 rounded-2xl transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
