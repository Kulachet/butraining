import React, { useEffect, useState } from "react";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Registration, Course } from "../types";
import { RegistrationService } from "../lib/registrationService";
import { formatInstructorName } from "../lib/utils";
import { motion } from "motion/react";
import { CheckCircle2, Circle, Download, Mail, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

interface Props {
  course: Course;
}

export const ApplicantList: React.FC<Props> = ({ course }) => {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [instructorMap, setInstructorMap] = useState<Record<string, string>>({});

  useEffect(() => {
    import("firebase/firestore").then(({ getDocs }) => {
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
    });
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "registrations"),
      where("courseId", "==", course.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const regs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Registration[];
      // Sort by sequenceNumber in frontend
      regs.sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0));
      setRegistrations(regs);
      setLoading(false);
    }, (error) => {
      console.error("Registrations fetch error:", error);
      toast.error("ไม่สามารถโหลดรายชื่อได้: " + error.message);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [course.id]);

  const handleCheckIn = async (regId: string, currentStatus: boolean) => {
    try {
      await RegistrationService.toggleAttendance(regId, !currentStatus);
      toast.success(currentStatus ? "ยกเลิกการเช็คอิน" : "เช็คอินเรียบร้อย");
    } catch (error) {
      toast.error("เกิดข้อผิดพลาด");
    }
  };

  const handleSendCertificates = async () => {
    if (!course.driveFolderId) {
      toast.error("กรุณาระบุ Google Drive Folder ID ในการตั้งค่าหลักสูตร");
      return;
    }
    
    setProcessing(true);
    try {
      await RegistrationService.sendCertificates(course, registrations);
      toast.success("ส่งประกาศนียบัตรเข้าคิวเรียบร้อยแล้ว");
    } catch (error) {
      toast.error("เกิดข้อผิดพลาดในการส่ง");
    } finally {
      setProcessing(false);
    }
  };

  const exportCSV = () => {
    const headers = ["No.", "Instructor ID", "Name", "Position", "Department", "Email", "Session", "Status"];
    const rows = registrations.map(r => [
      r.sequenceNumber,
      r.instructorId || instructorMap[r.userEmail] || "-",
      formatInstructorName(r.userName),
      r.userPosition,
      r.userDepartment,
      r.userEmail,
      r.sessionName || "N/A",
      r.attended ? "Attended" : "Registered"
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `applicants_${course.id}.csv`;
    link.click();
  };

  if (loading) return <div className="p-8 text-center text-slate-400">กำลังโหลดรายชื่อ...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-[20px] lg:text-[24px] font-semibold text-[#333333] tracking-[0.02em] leading-[1.6]">รายชื่อผู้ลงทะเบียน ({registrations.length})</h3>
        <div className="flex items-center gap-3">
          <button 
            onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#4A4A4A] rounded-xl font-medium text-[14px] lg:text-[16px] transition-all"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button 
            onClick={handleSendCertificates}
            disabled={processing}
            className="flex items-center gap-2 px-4 py-2 bg-crimson hover:bg-crimson-dark text-white rounded-xl font-medium text-[14px] lg:text-[16px] transition-all disabled:opacity-50"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            ส่งประกาศนียบัตร
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest w-16">No.</th>
              <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">รหัสอาจารย์</th>
              <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">ชื่อ-นามสกุล</th>
              <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">ตำแหน่ง/คณะ</th>
              <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">เซสชัน</th>
              <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">สถานะ</th>
              <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {registrations.map((reg) => (
              <tr key={reg.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-bold text-slate-300">{reg.sequenceNumber}</td>
                <td className="px-6 py-4">
                  <span className="text-[12px] lg:text-[13px] font-mono font-medium text-slate-400">
                    {reg.instructorId || instructorMap[reg.userEmail] || "-"}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="text-[14px] lg:text-[16px] font-normal text-[#333333]">{formatInstructorName(reg.userName)}</span>
                    <span className="text-[12px] text-slate-400 font-normal">{reg.userEmail}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="text-[14px] lg:text-[16px] font-normal text-[#4A4A4A]">{reg.userPosition}</span>
                    <span className="text-[12px] text-slate-400 font-normal">{reg.userDepartment}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-[14px] lg:text-[16px] font-normal text-[#4A4A4A]">{reg.sessionName || "-"}</span>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] lg:text-[13px] font-medium ${reg.attended ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-400"}`}>
                    {reg.attended ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                    {reg.attended ? "Attended" : "Registered"}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button 
                    onClick={() => handleCheckIn(reg.id, reg.attended)}
                    className={`px-4 py-1.5 rounded-lg text-[12px] lg:text-[13px] font-medium transition-all ${reg.attended ? "bg-slate-100 text-slate-500 hover:bg-slate-200" : "bg-crimson text-white hover:bg-crimson-dark shadow-sm"}`}
                  >
                    {reg.attended ? "ยกเลิกเช็คอิน" : "เช็คอิน"}
                  </button>
                </td>
              </tr>
            ))}
            {registrations.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-20 text-center text-slate-400 font-medium">ยังไม่มีผู้ลงทะเบียน</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {processing && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 text-crimson animate-spin" />
            <div className="text-center">
              <h4 className="font-black text-slate-900">กำลังประมวลผล...</h4>
              <p className="text-sm text-slate-500">กรุณารอสักครู่ ระบบกำลังส่งอีเมลประกาศนียบัตร</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
