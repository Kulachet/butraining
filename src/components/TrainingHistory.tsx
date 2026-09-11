import React, { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, onSnapshot, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Course } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { 
  Search, 
  Calendar, 
  MapPin, 
  Eye, 
  RotateCcw, 
  Loader2, 
  BookOpen, 
  Archive,
  Clock,
  CheckCircle2
} from "lucide-react";
import toast from "react-hot-toast";
import { cn, formatInstructorName } from "../lib/utils";
import { useAuth } from "./AuthProvider";

interface Props {
  onViewApplicants: (course: Course) => void;
}

function formatArchivedDate(archivedAt: any): string {
  if (!archivedAt) return "-";
  try {
    let date: Date;
    if (typeof archivedAt.toDate === "function") {
      date = archivedAt.toDate();
    } else if (archivedAt.seconds) {
      date = new Date(archivedAt.seconds * 1000);
    } else {
      date = new Date(archivedAt);
    }
    if (isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("th-TH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

export const TrainingHistory: React.FC<Props> = ({ onViewApplicants }) => {
  const { user, isAdmin } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filters State
  const [search, setSearch] = useState("");
  const [instructorFilter, setInstructorFilter] = useState("All Instructors");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortBy, setSortBy] = useState("Archived Date (Latest)");

  // Confirmation Modal
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  useEffect(() => {
    const q = query(collection(db, "courses"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Course[];
      setCourses(all);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching courses for history:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Filter archived courses only
  const archivedCourses = useMemo(() => {
    return courses.filter(c => c.archived === true);
  }, [courses]);

  const uniqueInstructors = useMemo(() => {
    const names = new Set(archivedCourses.map(c => c.instructorName));
    return Array.from(names).filter(Boolean).sort();
  }, [archivedCourses]);

  const filteredCourses = useMemo(() => {
    let result = [...archivedCourses];

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(c => 
        (c.title || "").toLowerCase().includes(q) ||
        (c.instructorName || "").toLowerCase().includes(q)
      );
    }

    // Instructor filter
    if (instructorFilter !== "All Instructors") {
      result = result.filter(c => c.instructorName === instructorFilter);
    }

    // Date range (training date)
    if (startDate) {
      result = result.filter(c => new Date(c.date) >= new Date(startDate));
    }
    if (endDate) {
      result = result.filter(c => new Date(c.date) <= new Date(endDate));
    }

    // Sort
    if (sortBy === "Title A-Z") {
      result.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    } else if (sortBy === "Title Z-A") {
      result.sort((a, b) => (b.title || "").localeCompare(a.title || ""));
    } else if (sortBy === "Training Date (Earliest)") {
      result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    } else if (sortBy === "Training Date (Latest)") {
      result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else {
      // Archived Date (Latest)
      result.sort((a, b) => {
        const getArchiveTime = (item: Course) => {
          if (!item.archivedAt) return 0;
          if (typeof item.archivedAt.toDate === "function") return item.archivedAt.toDate().getTime();
          if (item.archivedAt.seconds) return item.archivedAt.seconds * 1000;
          return new Date(item.archivedAt).getTime() || 0;
        };
        return getArchiveTime(b) - getArchiveTime(a);
      });
    }

    return result;
  }, [archivedCourses, search, instructorFilter, startDate, endDate, sortBy]);

  const handleRestoreClick = (course: Course) => {
    if (!isAdmin) {
      toast.error("คุณไม่มีสิทธิ์ดำเนินการนี้");
      return;
    }
    if (!course.archived) {
      toast.error("หลักสูตรนี้ไม่ได้อยู่ในสถานะประวัติ");
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: "ยืนยันการคืนค่าหลักสูตร",
      message: "คุณต้องการคืนค่าหลักสูตรนี้กลับไปยังรายการจัดการหลักสูตรที่กำลังใช้งานใช่หรือไม่?",
      onConfirm: async () => {
        setActionLoading(course.id);
        setConfirmModal(null);
        try {
          await updateDoc(doc(db, "courses", course.id), {
            archived: false,
            restoredAt: serverTimestamp(),
            restoredBy: user?.uid || "",
            restoredByEmail: user?.email || "",
          });
          toast.success("คืนค่าหลักสูตรเรียบร้อยแล้ว");
        } catch (error: any) {
          console.error("Restore course error:", error);
          toast.error(`เกิดข้อผิดพลาดในการคืนค่าหลักสูตร: ${error.message || "กรุณาลองใหม่อีกครั้ง"}`);
        } finally {
          setActionLoading(null);
        }
      }
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-10 h-10 text-crimson animate-spin" />
        <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">กำลังโหลดประวัติการจัดการอบรม...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-2xl bg-slate-900 flex items-center justify-center text-white shadow-sm">
              <Archive className="w-5 h-5" />
            </div>
            <h1 className="text-[28px] lg:text-[32px] font-bold text-[#333333] tracking-[0.02em] leading-[1.6]">
              ประวัติการจัดการอบรม
            </h1>
          </div>
          <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px] tracking-wide leading-[1.7]">
            รายการหลักสูตรที่ถูกเก็บเข้าประวัติ สามารถดูรายละเอียดผู้เข้าร่วม หรือคืนค่ากลับสู่รายการจัดการหลักสูตรได้ตลอดเวลา
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-100/80 px-4 py-2.5 rounded-2xl text-[13px] font-medium text-slate-600 self-start md:self-auto">
          <Archive className="w-4 h-4 text-slate-500" />
          <span>ทั้งหมด {archivedCourses.length} หลักสูตร</span>
        </div>
      </div>

      {/* Filtering Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text"
            placeholder="ค้นหาตามชื่อหลักสูตร หรือวิทยากร..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] lg:text-[16px] font-normal text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all"
          />
        </div>

        <select 
          value={instructorFilter}
          onChange={(e) => setInstructorFilter(e.target.value)}
          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] lg:text-[16px] font-normal text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all appearance-none cursor-pointer"
        >
          <option>All Instructors</option>
          {uniqueInstructors.map(name => (
            <option key={name} value={name}>{formatInstructorName(name)}</option>
          ))}
        </select>

        <div className="flex gap-2">
          <input 
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            title="วันที่อบรมเริ่มต้น"
            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all"
          />
          <input 
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            title="วันที่อบรมสิ้นสุด"
            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all"
          />
        </div>

        <select 
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] lg:text-[16px] font-normal text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all appearance-none cursor-pointer"
        >
          <option value="Archived Date (Latest)">วันที่เก็บเข้าประวัติ (ล่าสุด)</option>
          <option value="Training Date (Earliest)">วันที่อบรม (เรียงจากใกล้สุด)</option>
          <option value="Training Date (Latest)">วันที่อบรม (เรียงจากไกลสุด)</option>
          <option value="Title A-Z">ชื่อหลักสูตร A-Z</option>
          <option value="Title Z-A">ชื่อหลักสูตร Z-A</option>
        </select>
      </div>

      {/* Course List */}
      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {filteredCourses.map((course) => (
            <motion.div
              layout
              key={course.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:border-slate-300 transition-all grid grid-cols-1 md:grid-cols-12 gap-6 items-center"
            >
              {/* Column 0: Course Image */}
              <div className="md:col-span-2">
                <div className="aspect-video md:aspect-square rounded-2xl overflow-hidden bg-slate-100 border border-slate-100 relative">
                  {(course.bannerImageBase64 || course.imageUrl) ? (
                    <img 
                      src={course.bannerImageBase64 || course.imageUrl} 
                      alt={course.title}
                      className="w-full h-full object-cover filter grayscale-[40%]"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <BookOpen className="w-8 h-8" />
                    </div>
                  )}
                  <span className="absolute top-2 left-2 bg-slate-900/85 backdrop-blur-sm text-white text-[10px] font-medium px-2 py-0.5 rounded-md flex items-center gap-1">
                    <Archive className="w-3 h-3" /> ประวัติ
                  </span>
                </div>
              </div>

              {/* Column 1: Course Info */}
              <div className="md:col-span-4 space-y-1">
                <div className="flex flex-col gap-1 mb-1">
                  <h3 className="text-[18px] lg:text-[20px] font-semibold text-slate-800 tracking-[0.02em] leading-[1.4] line-clamp-2">
                    {course.title}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-slate-100 text-slate-600 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-slate-200 flex items-center gap-1 tracking-wider uppercase">
                      <Archive className="w-3 h-3" /> เก็บเข้าประวัติแล้ว
                    </span>
                    {course.archivedAt && (
                      <span className="text-slate-400 text-[11px] font-normal flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatArchivedDate(course.archivedAt)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[#4A4A4A] font-normal text-[13px] lg:text-[14px] tracking-wide leading-[1.6]">
                  <span className="text-slate-400">Instructor:</span>
                  {formatInstructorName(course.instructorName)}
                </div>
                <div className="flex items-center gap-2 text-slate-600 font-medium text-[13px] lg:text-[14px] tracking-wide leading-[1.6] bg-slate-100 w-fit px-3 py-1.5 rounded-lg mt-2">
                  <Calendar className="w-4 h-4 text-slate-500" />
                  {course.sessions && course.sessions.length > 0 ? (
                    <span>{course.sessions.length} Sessions | เริ่ม: {course.sessions[0].date}</span>
                  ) : (
                    <span>วันที่อบรม: {course.date}</span>
                  )}
                </div>
              </div>

              {/* Column 2: Stats */}
              <div className="md:col-span-3 flex flex-col gap-2">
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-widest leading-[1.6]">Total Seats</span>
                  <span className="text-[13px] lg:text-[14px] font-normal text-[#4A4A4A] tracking-wide leading-[1.7]">
                    {(() => {
                      const hasSessions = course.sessions && course.sessions.length > 0;
                      const totalEnrolled = hasSessions 
                        ? course.sessions!.reduce((sum, s) => sum + (s.enrolledSeats || 0), 0) 
                        : (course.enrolledSeats || 0);
                      const totalMax = hasSessions 
                        ? course.sessions!.reduce((sum, s) => sum + (s.maxSeats || 0), 0) 
                        : (course.maxSeats || 50);
                      return (
                        <>
                          {totalEnrolled}/{totalMax} 
                          <span className="text-slate-400 ml-1 font-normal">
                            ({totalMax > 0 ? Math.round((totalEnrolled / totalMax) * 100) : 0}%)
                          </span>
                        </>
                      );
                    })()}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-widest leading-[1.6]">Location</span>
                  <span className="text-[13px] lg:text-[14px] font-normal text-[#4A4A4A] flex items-center gap-1.5 tracking-wide leading-[1.7]">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    {course.sessions && course.sessions.length > 0 
                      ? (course.sessions.length > 1 ? "Multiple" : course.sessions[0].locationDetail)
                      : (course.locationDetail || "TBA")}
                  </span>
                </div>
              </div>

              {/* Column 3: Actions */}
              <div className="md:col-span-3 flex flex-col gap-2">
                <button 
                  onClick={() => onViewApplicants(course)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-[#4A4A4A] rounded-xl text-[14px] lg:text-[15px] font-medium transition-all tracking-wide leading-[1.7]"
                >
                  <Eye className="w-4 h-4 text-slate-500" />
                  ดูรายละเอียด / ผู้สมัคร
                </button>
                <button 
                  onClick={() => handleRestoreClick(course)}
                  disabled={actionLoading === course.id}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100/70 text-emerald-700 rounded-xl text-[14px] lg:text-[15px] font-semibold transition-all tracking-wide leading-[1.7] disabled:opacity-50"
                >
                  {actionLoading === course.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  ) : (
                    <RotateCcw className="w-4 h-4 text-emerald-600" />
                  )}
                  คืนค่าหลักสูตร
                </button>
              </div>
            </motion.div>
          ))}

          {archivedCourses.length === 0 && (
            <div className="bg-white py-20 rounded-3xl border border-dashed border-slate-200 text-center">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                <Archive className="w-10 h-10" />
              </div>
              <p className="text-slate-500 font-bold text-lg">ยังไม่มีหลักสูตรในประวัติการจัดการอบรม</p>
              <p className="text-slate-400 text-sm mt-1">เมื่อคุณกด "เก็บเข้าประวัติ" ในหน้าจัดการหลักสูตร หลักสูตรจะมาแสดงที่นี่</p>
            </div>
          )}

          {archivedCourses.length > 0 && filteredCourses.length === 0 && (
            <div className="bg-white py-20 rounded-3xl border border-dashed border-slate-200 text-center">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                <Search className="w-10 h-10" />
              </div>
              <p className="text-slate-400 font-bold">ไม่พบหลักสูตรที่ตรงตามเงื่อนไข</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Confirm Restore Modal */}
      <AnimatePresence>
        {confirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl"
            >
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                <RotateCcw className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-[#333333] mb-2">{confirmModal.title}</h3>
              <p className="text-[#4A4A4A] mb-8 leading-relaxed text-[15px]">
                {confirmModal.message}
              </p>
              
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={actionLoading !== null}
                  onClick={() => setConfirmModal(null)}
                  className="px-6 py-2.5 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={actionLoading !== null}
                  onClick={confirmModal.onConfirm}
                  className="px-6 py-2.5 rounded-xl font-medium text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {actionLoading !== null && <Loader2 className="w-4 h-4 animate-spin" />}
                  คืนค่าหลักสูตร
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
