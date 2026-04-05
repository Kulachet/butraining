import React, { useState, useEffect } from "react";
import { 
  Search, 
  Filter, 
  Download, 
  Mail, 
  FileText, 
  Award, 
  RefreshCw,
  ChevronDown,
  UserCheck,
  Users,
  QrCode,
  X,
  CheckCircle2,
  Loader2,
  Trash2
} from "lucide-react";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc,
  getDocs,
  orderBy,
  deleteDoc,
  getDoc
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { Course, Registration } from "../types";
import { cn, formatInstructorName } from "../lib/utils";
import toast from "react-hot-toast";
import { QRCodeSVG } from "qrcode.react";
import Papa from "papaparse";

export const RegistrantsList: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "attended">("all");
  const [showQrModal, setShowQrModal] = useState(false);
  const [instructorMap, setInstructorMap] = useState<Record<string, string>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{regId: string, courseId: string, sessionId: string | null} | null>(null);

  // Fetch instructors for mapping ID
  useEffect(() => {
    const fetchInstructors = async () => {
      try {
        const snap = await getDocs(collection(db, "instructors"));
        const map: Record<string, string> = {};
        snap.docs.forEach(doc => {
          const data = doc.data();
          if (data.email && data.id) {
            map[data.email] = data.id;
          }
        });
        setInstructorMap(map);
      } catch (error) {
        console.error("Error fetching instructors:", error);
      }
    };
    fetchInstructors();
  }, []);

  // Fetch all courses for the dropdown
  useEffect(() => {
    const q = query(collection(db, "courses"), orderBy("date", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCourses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Course[]);
    });
    return () => unsubscribe();
  }, []);

  // Fetch registrations when course changes
  useEffect(() => {
    if (!selectedCourseId) {
      setRegistrations([]);
      return;
    }

    setLoading(true);
    const q = query(
      collection(db, "registrations"), 
      where("courseId", "==", selectedCourseId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const regs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Registration[];
      // Sort by sequenceNumber in frontend
      regs.sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0));
      setRegistrations(regs);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching registrations:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [selectedCourseId]);

  const filteredRegistrations = registrations.filter(reg => {
    const matchesSearch = 
      reg.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      reg.userEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      reg.userDepartment?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesTab = filterTab === "all" || reg.attended;
    
    return matchesSearch && matchesTab;
  });

  const handleExportCSV = () => {
    if (filteredRegistrations.length === 0) {
      toast.error("ไม่มีข้อมูลให้ส่งออก");
      return;
    }

    const selectedCourse = courses.find(c => c.id === selectedCourseId);
    const data = filteredRegistrations.map(reg => ({
      "ลำดับ": reg.sequenceNumber,
      "รหัสอาจารย์": reg.instructorId || instructorMap[reg.userEmail] || "-",
      "ชื่อ-นามสกุล": formatInstructorName(reg.userName),
      "อีเมล": reg.userEmail,
      "หน่วยงาน": reg.userDepartment,
      "ตำแหน่ง": reg.userPosition,
      "สถานะการเข้าอบรม": reg.attended ? "มาอบรมจริง" : "ยังไม่ได้เช็คอิน",
      "วันที่ลงทะเบียน": new Date(reg.registeredAt).toLocaleString('th-TH')
    }));

    const csv = Papa.unparse(data);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `รายชื่อผู้สมัคร_${selectedCourse?.title || 'หลักสูตร'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("ส่งออกไฟล์ CSV เรียบร้อยแล้ว");
  };

  const handleAction = (action: string) => {
    if (!selectedCourseId) {
      toast.error("กรุณาเลือกหลักสูตรก่อน");
      return;
    }
    toast.success(`ระบบกำลังดำเนินการ: ${action}`);
  };

  const toggleAttendance = async (regId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, "registrations", regId), {
        attended: !currentStatus
      });
      toast.success(currentStatus ? "ยกเลิกการเช็คอิน" : "เช็คอินเรียบร้อย");
    } catch (error) {
      toast.error("เกิดข้อผิดพลาด");
    }
  };

  const handleDeleteClick = (regId: string, courseId: string, sessionId: string | null) => {
    setDeleteConfirm({ regId, courseId, sessionId });
  };

  const confirmDeleteRegistration = async () => {
    if (!deleteConfirm) return;
    const { regId, courseId, sessionId } = deleteConfirm;
    setDeleteConfirm(null);

    try {
      // 1. Delete registration doc
      await deleteDoc(doc(db, "registrations", regId));

      // 2. Update course seats
      const courseRef = doc(db, "courses", courseId);
      const courseDoc = await getDoc(courseRef);
      if (courseDoc.exists()) {
        const currentCourse = courseDoc.data() as Course;
        let updatedSessions = [...(currentCourse.sessions || [])];
        let updateData: any = { sessions: updatedSessions };
        
        if (sessionId) {
          const sessionIndex = updatedSessions.findIndex(s => s.sessionId === sessionId);
          if (sessionIndex !== -1 && updatedSessions[sessionIndex].enrolledSeats > 0) {
            updatedSessions[sessionIndex].enrolledSeats -= 1;
          }
        } else {
          // Legacy course without session ID
          if (updatedSessions.length > 0 && updatedSessions[0].enrolledSeats > 0) {
            updatedSessions[0].enrolledSeats -= 1;
          } else if (currentCourse.enrolledSeats !== undefined && currentCourse.enrolledSeats > 0) {
            updateData.enrolledSeats = currentCourse.enrolledSeats - 1;
          }
        }
        
        await updateDoc(courseRef, updateData);
      }

      toast.success("ลบผู้ลงทะเบียนเรียบร้อยแล้ว");
    } catch (error) {
      console.error("Error deleting registration:", error);
      toast.error("เกิดข้อผิดพลาดในการลบผู้ลงทะเบียน");
    }
  };

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-[28px] lg:text-[32px] font-bold text-[#333333] tracking-[0.02em] leading-[1.6]">
            รายชื่อ<br />ผู้ลงทะเบียน
          </h1>
          <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px] max-w-xs leading-[1.7]">
            ตรวจสอบและจัดการรายชื่ออาจารย์ที่สมัครเข้าร่วมอบรม
          </p>
        </div>

        {/* Action Buttons Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <button 
            onClick={() => handleAction("ส่งใบ Certificate")}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-[#4A4A4A] rounded-xl text-[13px] font-medium transition-all border border-slate-200"
          >
            <Award className="w-4 h-4" />
            ส่งใบ Certificate
          </button>
          <button 
            onClick={() => handleAction("ส่งอีเมลแจ้งเตือน")}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-[#4A4A4A] rounded-xl text-[13px] font-medium transition-all border border-slate-200"
          >
            <Mail className="w-4 h-4" />
            ส่งอีเมลแจ้งเตือน
          </button>
          <button 
            onClick={() => handleAction("ส่งแบบประเมินผล")}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-[#4A4A4A] rounded-xl text-[13px] font-medium transition-all border border-slate-200"
          >
            <FileText className="w-4 h-4" />
            ส่งแบบประเมินผล
          </button>
          <div className="flex bg-slate-100 rounded-xl p-1 border border-slate-200">
            <button 
              onClick={() => setFilterTab("all")}
              className={cn(
                "flex-1 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all",
                filterTab === "all" ? "bg-crimson text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              ทั้งหมด
            </button>
            <button 
              onClick={() => setFilterTab("attended")}
              className={cn(
                "flex-1 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all",
                filterTab === "attended" ? "bg-crimson text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              มาอบรมจริง
            </button>
          </div>
          <button 
            onClick={handleExportCSV}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-[#4A4A4A] rounded-xl text-[13px] font-medium transition-all border border-slate-200"
          >
            <Download className="w-4 h-4" />
            ส่งออก รายชื่อสมัคร (CSV)
          </button>
          <button 
            onClick={() => handleAction("ปรับปรุงลำดับที่")}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-[#4A4A4A] rounded-xl text-[13px] font-medium transition-all border border-slate-200"
          >
            <RefreshCw className="w-4 h-4" />
            ปรับปรุงลำดับที่
          </button>
          {selectedCourseId && (
            <button 
              onClick={() => setShowQrModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl text-[13px] font-medium transition-all border border-indigo-100"
            >
              <QrCode className="w-4 h-4" />
              QR Code Check-in
            </button>
          )}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col lg:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
          <input 
            type="text"
            placeholder="ค้นหาชื่อ, รหัส หรือหน่วยงาน..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-normal text-[14px] lg:text-[16px] text-[#4A4A4A]"
          />
        </div>
        
        <div className="flex items-center gap-4 w-full lg:w-auto">
          <div className="relative flex-1 lg:w-80">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select 
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium text-[14px] lg:text-[16px] appearance-none text-[#333333]"
            >
              <option value="">-- กรุณาเลือกหลักสูตร --</option>
              <option value="all_courses">ทุกหลักสูตร</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>{course.title} (วันที่อบรม: {course.date})</option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
          <div className="text-slate-400 text-[12px] lg:text-[13px] font-medium uppercase tracking-widest whitespace-nowrap">
            พบ {filteredRegistrations.length} รายการ
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden min-h-[400px]">
        {!selectedCourseId ? (
          <div className="h-[400px] flex flex-col items-center justify-center text-center p-12">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
              <Filter className="w-8 h-8 text-slate-200" />
            </div>
            <h3 className="text-[20px] lg:text-[24px] font-semibold text-[#333333] mb-2 tracking-[0.02em]">กรุณาเลือกหลักสูตรเพื่อดูรายชื่อ</h3>
            <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px]">เลือกจากเมนู "กรองตามหลักสูตร" ด้านบน</p>
          </div>
        ) : loading ? (
          <div className="h-[400px] flex items-center justify-center">
            <Loader2 className="w-10 h-10 text-crimson animate-spin" />
          </div>
        ) : filteredRegistrations.length === 0 ? (
          <div className="h-[400px] flex flex-col items-center justify-center text-center p-12">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
              <Users className="w-8 h-8 text-slate-200" />
            </div>
            <h3 className="text-[20px] lg:text-[24px] font-semibold text-[#333333] mb-2 tracking-[0.02em]">ไม่พบรายชื่อผู้สมัคร</h3>
            <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px]">ยังไม่มีผู้ลงทะเบียนในหลักสูตรนี้ หรือไม่พบข้อมูลที่ค้นหา</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-8 py-5 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-[0.2em]">ลำดับ</th>
                  <th className="px-6 py-5 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-[0.2em]">รหัสอาจารย์</th>
                  <th className="px-6 py-5 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-[0.2em]">ชื่อ-นามสกุล</th>
                  <th className="px-6 py-5 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-[0.2em]">หน่วยงาน</th>
                  <th className="px-6 py-5 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-[0.2em]">อีเมล</th>
                  <th className="px-8 py-5 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-[0.2em] text-center">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredRegistrations.map((reg, index) => (
                  <tr key={reg.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-8 py-4">
                      <span className="text-[14px] lg:text-[16px] font-bold text-slate-300 group-hover:text-crimson transition-colors">
                        {String(reg.sequenceNumber).padStart(2, '0')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[12px] lg:text-[13px] font-mono font-medium text-slate-400">
                        {reg.instructorId || instructorMap[reg.userEmail] || "-"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-[14px] lg:text-[16px] font-normal text-[#333333]">{formatInstructorName(reg.userName)}</span>
                        <span className="text-[12px] text-slate-400 font-medium uppercase tracking-wider">{reg.userPosition}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[12px] lg:text-[13px] font-medium text-[#4A4A4A] bg-slate-100 px-3 py-1 rounded-full">
                        {reg.userDepartment}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[12px] lg:text-[13px] font-normal text-slate-400">{reg.userEmail}</span>
                    </td>
                    <td className="px-8 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button 
                          onClick={() => toggleAttendance(reg.id, reg.attended)}
                          className={cn(
                            "inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-medium uppercase tracking-widest transition-all",
                            reg.attended 
                              ? "bg-emerald-50 text-emerald-600 border border-emerald-100" 
                              : "bg-slate-50 text-slate-400 border border-slate-100 hover:border-crimson/30 hover:text-crimson"
                          )}
                        >
                          {reg.attended ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              มาอบรมจริง
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-3 h-3" />
                              ยังไม่ได้เช็คอิน
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteClick(reg.id, reg.courseId, reg.sessionId || null)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                          title="ลบผู้ลงทะเบียน"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* QR Code Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setShowQrModal(false)}
          />
          <div className="relative bg-white rounded-[3rem] shadow-2xl p-12 max-w-md w-full text-center">
            <button 
              onClick={() => setShowQrModal(false)}
              className="absolute top-8 right-8 p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-6 h-6 text-slate-300" />
            </button>
            
            <div className="mb-8">
              <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <QrCode className="w-10 h-10 text-indigo-600" />
              </div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-2">QR Code Check-in</h3>
              <p className="text-slate-500 font-medium text-sm">
                ให้ผู้เข้าอบรมสแกน QR Code นี้เพื่อยืนยันการเข้าอบรม
              </p>
            </div>

            <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 mb-8 flex justify-center">
              <QRCodeSVG 
                value={`${window.location.origin}/#/checkin/${selectedCourseId}`}
                size={200}
                level="H"
                includeMargin={true}
              />
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                <p className="text-xs text-amber-700 font-bold leading-relaxed">
                  * ผู้เข้าอบรมต้องเข้าสู่ระบบด้วย @bu.ac.th ก่อนสแกนเพื่อบันทึกข้อมูล
                </p>
              </div>
              <button 
                onClick={() => window.print()}
                className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-lg"
              >
                พิมพ์ QR Code
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setDeleteConfirm(null)}
          />
          <div className="relative bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-8 h-8 text-red-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">ยืนยันการลบ</h3>
            <p className="text-slate-500 mb-8">
              คุณแน่ใจหรือไม่ว่าต้องการลบผู้ลงทะเบียนรายนี้? การกระทำนี้ไม่สามารถย้อนกลับได้
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={confirmDeleteRegistration}
                className="flex-1 py-3 px-4 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl transition-colors"
              >
                ยืนยันการลบ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
