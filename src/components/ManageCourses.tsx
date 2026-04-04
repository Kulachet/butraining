import React, { useState, useEffect, useMemo } from "react";
import { collection, getDocs, query, orderBy, deleteDoc, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Course, Instructor } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { 
  Plus, 
  Search, 
  Filter, 
  Edit3, 
  Trash2, 
  Eye, 
  Calendar, 
  MapPin, 
  Users, 
  ChevronDown,
  ArrowUpDown,
  Loader2,
  BookOpen
} from "lucide-react";
import toast from "react-hot-toast";
import { cn, formatInstructorName } from "../lib/utils";

interface Props {
  onCreateCourse: () => void;
  onEditCourse: (course: Course) => void;
  onViewApplicants: (course: Course) => void;
}

export const ManageCourses: React.FC<Props> = ({ onCreateCourse, onEditCourse, onViewApplicants }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters State
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [instructorFilter, setInstructorFilter] = useState("All Instructors");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [deptFilter, setDeptFilter] = useState("All Departments");
  const [sortBy, setSortBy] = useState("Training Date (Earliest)");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const coursesSnap = await getDocs(query(collection(db, "courses"), orderBy("createdAt", "desc")));
        const instructorsSnap = await getDocs(collection(db, "instructors"));
        
        setCourses(coursesSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Course[]);
        setInstructors(instructorsSnap.docs.map(d => ({ uid: d.id, ...d.data() })) as Instructor[]);
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("ไม่สามารถโหลดข้อมูลได้");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const departments = useMemo(() => {
    const depts = new Set(instructors.map(i => i.department));
    return Array.from(depts).filter(Boolean);
  }, [instructors]);

  const uniqueInstructors = useMemo(() => {
    const names = new Set(courses.map(c => c.instructorName));
    return Array.from(names).filter(Boolean).sort();
  }, [courses]);

  const filteredCourses = useMemo(() => {
    let result = [...courses];

    // Search
    if (search) {
      result = result.filter(c => 
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        c.instructorName.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Status
    if (statusFilter !== "All Status") {
      result = result.filter(c => c.status === statusFilter);
    }

    // Instructor
    if (instructorFilter !== "All Instructors") {
      result = result.filter(c => c.instructorName === instructorFilter);
    }

    // Department (Assuming course has department or we match via instructor)
    if (deptFilter !== "All Departments") {
      result = result.filter(c => c.department === deptFilter);
    }

    // Date Range (Simplified check)
    if (startDate) {
      result = result.filter(c => new Date(c.date) >= new Date(startDate));
    }
    if (endDate) {
      result = result.filter(c => new Date(c.date) <= new Date(endDate));
    }

    // Sort
    if (sortBy === "Title A-Z") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "Title Z-A") {
      result.sort((a, b) => b.title.localeCompare(a.title));
    } else if (sortBy === "Training Date (Earliest)") {
      result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    } else if (sortBy === "Training Date (Latest)") {
      result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else {
      // Latest Added
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return result;
  }, [courses, search, statusFilter, instructorFilter, startDate, endDate, deptFilter, sortBy]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("คุณแน่ใจหรือไม่ว่าต้องการลบหลักสูตรนี้?")) return;
    try {
      await deleteDoc(doc(db, "courses", id));
      setCourses(courses.filter(c => c.id !== id));
      toast.success("ลบหลักสูตรเรียบร้อยแล้ว");
    } catch (error) {
      toast.error("ลบไม่สำเร็จ");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-10 h-10 text-crimson animate-spin" />
        <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">กำลังโหลดหลักสูตร...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] lg:text-[32px] font-bold text-[#333333] tracking-[0.02em] leading-[1.6]">Manage Training Courses</h1>
        <button 
          onClick={onCreateCourse}
          className="bg-crimson hover:bg-crimson-dark text-white font-medium px-8 py-4 rounded-2xl shadow-lg shadow-crimson/10 transition-all flex items-center gap-2 text-[14px] lg:text-[16px] tracking-wide"
        >
          <Plus className="w-6 h-6" />
          Create Training Course
        </button>
      </div>

      {/* Filtering Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text"
            placeholder="Search Courses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] lg:text-[16px] font-normal text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all"
          />
        </div>

        <select 
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] lg:text-[16px] font-normal text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all appearance-none cursor-pointer"
        >
          <option>All Status</option>
          <option>Active</option>
          <option>Inactive</option>
        </select>

        <select 
          value={instructorFilter}
          onChange={(e) => setInstructorFilter(e.target.value)}
          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] lg:text-[16px] font-normal text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all appearance-none cursor-pointer"
        >
          <option>All Instructors</option>
          {uniqueInstructors.map(name => <option key={name} value={name}>{formatInstructorName(name)}</option>)}
        </select>

        <div className="flex gap-2">
          <input 
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all"
          />
          <input 
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all"
          />
        </div>

        <select 
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] lg:text-[16px] font-normal text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all appearance-none cursor-pointer"
        >
          <option>All Departments</option>
          {departments.map(d => <option key={d}>{d}</option>)}
        </select>

        <select 
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[14px] lg:text-[16px] font-normal text-[#4A4A4A] focus:ring-2 focus:ring-crimson outline-none transition-all appearance-none cursor-pointer"
        >
          <option value="Training Date (Earliest)">วันที่อบรม (เรียงจากใกล้สุด)</option>
          <option value="Training Date (Latest)">วันที่อบรม (เรียงจากไกลสุด)</option>
          <option value="Latest Added">เพิ่มล่าสุด</option>
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
              className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:border-crimson/20 transition-all grid grid-cols-1 md:grid-cols-12 gap-6 items-center"
            >
              {/* Column 0: Course Image */}
              <div className="md:col-span-2">
                <div className="aspect-video md:aspect-square rounded-2xl overflow-hidden bg-slate-100 border border-slate-100">
                  {(course.bannerImageBase64 || course.imageUrl) ? (
                    <img 
                      src={course.bannerImageBase64 || course.imageUrl} 
                      alt={course.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <BookOpen className="w-8 h-8" />
                    </div>
                  )}
                </div>
              </div>

              {/* Column 1: Course Info */}
              <div className="md:col-span-3 space-y-1">
                <div className="flex flex-col gap-1 mb-1">
                  <h3 className="text-[18px] lg:text-[20px] font-semibold text-crimson tracking-[0.02em] leading-[1.4] line-clamp-2">
                    {course.title}
                  </h3>
                  <div className="flex items-center gap-2">
                    {course.isVisible ? (
                      <span className="bg-green-50 text-green-600 text-[10px] font-medium px-2 py-0.5 rounded-full border border-green-100 flex items-center gap-1 tracking-widest uppercase">
                        <Eye className="w-3 h-3" /> Public
                      </span>
                    ) : (
                      <span className="bg-slate-50 text-slate-400 text-[10px] font-medium px-2 py-0.5 rounded-full border border-slate-100 flex items-center gap-1 tracking-widest uppercase">
                        <Eye className="w-3 h-3 opacity-50" /> Hidden
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[#4A4A4A] font-normal text-[13px] lg:text-[14px] tracking-wide leading-[1.6]">
                  <span className="text-slate-400">Instructor:</span>
                  {formatInstructorName(course.instructorName)}
                </div>
                <div className="flex items-center gap-2 text-crimson font-medium text-[13px] lg:text-[14px] tracking-wide leading-[1.6] bg-crimson/5 w-fit px-3 py-1.5 rounded-lg mt-2">
                  <Calendar className="w-4 h-4" />
                  {course.sessions && course.sessions.length > 0 ? (
                    <span>{course.sessions.length} Sessions | เริ่ม: {course.sessions[0].date}</span>
                  ) : (
                    <span>วันที่อบรม: {course.date}</span>
                  )}
                </div>
              </div>

              {/* Column 2: Stats */}
              <div className="md:col-span-2 flex flex-col gap-2">
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-widest leading-[1.6]">Total Seats</span>
                  <span className="text-[13px] lg:text-[14px] font-normal text-[#4A4A4A] tracking-wide leading-[1.7]">
                    {(() => {
                      let totalEnrolled = course.sessions?.reduce((sum, s) => sum + (s.enrolledSeats || 0), 0) || 0;
                      if (course.totalRegistrations && course.totalRegistrations > totalEnrolled) {
                        totalEnrolled = course.totalRegistrations;
                      }
                      const totalMax = course.sessions?.reduce((sum, s) => sum + (s.maxSeats || 0), 0) || course.maxSeats || 50;
                      return (
                        <>
                          {totalEnrolled}/{totalMax} 
                          <span className="text-slate-400 ml-1 font-normal">
                            ({Math.round((totalEnrolled / totalMax) * 100)}%)
                          </span>
                        </>
                      );
                    })()}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-widest leading-[1.6]">Location</span>
                  <span className="text-[13px] lg:text-[14px] font-normal text-[#4A4A4A] flex items-center gap-1.5 tracking-wide leading-[1.7]">
                    <MapPin className="w-3 h-3 text-crimson" />
                    {course.sessions && course.sessions.length > 0 
                      ? (course.sessions.length > 1 ? "Multiple" : course.sessions[0].locationDetail)
                      : (course.locationDetail || "TBA")}
                  </span>
                </div>
              </div>

              {/* Column 3: Status */}
              <div className="md:col-span-2">
                <div className={cn(
                  "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium uppercase tracking-widest leading-[1.6]",
                  course.status === 'Active' 
                    ? "bg-green-50 text-green-600 border border-green-100" 
                    : "bg-slate-50 text-slate-400 border border-slate-100"
                )}>
                  <div className={cn("w-1.5 h-1.5 rounded-full", course.status === 'Active' ? "bg-green-500" : "bg-slate-300")} />
                  {course.status || 'Active'}
                </div>
              </div>

              {/* Column 4: Actions */}
              <div className="md:col-span-3 flex flex-col gap-2">
                <button 
                  onClick={() => onViewApplicants(course)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-slate-100 hover:border-crimson hover:text-crimson text-[#4A4A4A] rounded-xl text-[14px] lg:text-[16px] font-medium transition-all tracking-wide leading-[1.7]"
                >
                  <Eye className="w-4 h-4" />
                  View Details
                </button>
                <button 
                  onClick={() => onEditCourse(course)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-slate-100 hover:border-crimson hover:text-crimson text-[#4A4A4A] rounded-xl text-[14px] lg:text-[16px] font-medium transition-all tracking-wide leading-[1.7]"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit Course
                </button>
                <button 
                  onClick={() => handleDelete(course.id)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-red-50 hover:border-red-500 hover:text-red-500 text-red-400 rounded-xl text-[14px] lg:text-[16px] font-medium transition-all tracking-wide leading-[1.7]"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Course
                </button>
              </div>
            </motion.div>
          ))}

          {filteredCourses.length === 0 && (
            <div className="bg-white py-20 rounded-3xl border border-dashed border-slate-200 text-center">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-10 h-10 text-slate-200" />
              </div>
              <p className="text-slate-400 font-bold">ไม่พบหลักสูตรที่ตรงตามเงื่อนไข</p>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
