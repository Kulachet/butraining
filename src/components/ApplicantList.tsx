import React, { useEffect, useState, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Registration, Course, SessionAttendance } from "../types";
import { RegistrationService } from "../lib/registrationService";
import { formatInstructorName, getCourseSessions, isMultiDayCourse, formatDateThai } from "../lib/utils";
import { motion } from "motion/react";
import { CheckCircle2, Circle, Download, Mail, Loader2, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";

interface Props {
  course: Course;
}

export const ApplicantList: React.FC<Props> = ({ course }) => {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [instructorMap, setInstructorMap] = useState<Record<string, string>>({});
  const [instructorRecords, setInstructorRecords] = useState<Record<string, { id: string; name: string; position?: string }>>({});

  useEffect(() => {
    import("firebase/firestore").then(({ getDocs }) => {
      const fetchInstructors = async () => {
        try {
          const snap = await getDocs(collection(db, "instructors"));
          const map: Record<string, string> = {};
          const records: Record<string, { id: string; name: string; position?: string }> = {};
          snap.docs.forEach(doc => {
            const data = doc.data();
            if (data.id) {
              const instObj = { id: data.id, name: data.name, position: data.position };
              records[data.id] = instObj;
              records[data.id.toLowerCase().trim()] = instObj;
              if (data.email) {
                const emailKey = data.email.toLowerCase().trim();
                map[data.email] = data.id;
                map[emailKey] = data.id;
                records[emailKey] = instObj;
              }
            }
          });
          setInstructorMap(map);
          setInstructorRecords(records);
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
      // Sort by sequenceNumber in frontend, fallback to registeredAt
      regs.sort((a, b) => {
        const seqA = a.sequenceNumber || 0;
        const seqB = b.sequenceNumber || 0;
        if (seqA !== seqB) return seqA - seqB;
        return new Date(a.registeredAt || 0).getTime() - new Date(b.registeredAt || 0).getTime();
      });
      setRegistrations(regs);
      setLoading(false);
    }, (error) => {
      console.error("Registrations fetch error:", error);
      toast.error("ไม่สามารถโหลดรายชื่อได้: " + error.message);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [course.id]);

  const isMulti = useMemo(() => isMultiDayCourse(course), [course]);

  const displaySessions = useMemo(() => {
    const activeSessions = getCourseSessions(course);
    const activeIds = new Set(activeSessions.map(s => s.id));
    
    const historicalSessions: Array<{ id: string; sessionName: string; date: string }> = [];
    registrations.forEach(r => {
      if (r.attendedSessions) {
        Object.entries(r.attendedSessions).forEach(([sId, rec]) => {
          const record = rec as SessionAttendance;
          if (!activeIds.has(sId) && !historicalSessions.some(h => h.id === sId)) {
            historicalSessions.push({
              id: sId,
              sessionName: record?.sessionName ? `${record.sessionName} (เดิม)` : `วันที่เดิม (${sId})`,
              date: record?.sessionDate || "",
            });
          }
        });
      }
    });

    return [...activeSessions, ...historicalSessions];
  }, [course, registrations]);

  const handleCheckIn = async (regId: string, currentStatus: boolean) => {
    try {
      await RegistrationService.toggleAttendance(regId, !currentStatus);
      toast.success(currentStatus ? "ยกเลิกการเช็คอิน" : "เช็คอินเรียบร้อย");
    } catch (error) {
      toast.error("เกิดข้อผิดพลาด");
    }
  };

  const handleToggleSession = async (
    regId: string, 
    sessionId: string, 
    currentStatus: boolean, 
    sessionDate?: string, 
    sessionName?: string
  ) => {
    try {
      await RegistrationService.toggleSessionAttendance(
        regId,
        sessionId,
        !currentStatus,
        sessionDate,
        sessionName
      );
      toast.success(!currentStatus ? "เช็คอินเรียบร้อย" : "ยกเลิกการเช็คอิน");
    } catch (error) {
      toast.error("เกิดข้อผิดพลาดในการบันทึกการเข้าอบรม");
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
    let csvContent = "";
    if (isMulti) {
      const headers = [
        "No.", 
        "Instructor ID", 
        "Name", 
        "Position", 
        "Department", 
        "Email", 
        ...displaySessions.map((s, idx) => `"${s.sessionName || `Day ${idx + 1}`}${s.date ? ` (${s.date})` : ''}"`),
        "Attendance Summary",
        "Overall Status"
      ];
      const rows = registrations.map((r, index) => {
        const emailKey = r.userEmail ? r.userEmail.toLowerCase().trim() : "";
        const idKey = r.instructorId ? r.instructorId.toLowerCase().trim() : "";
        const matched = (emailKey && instructorRecords[emailKey]) || (idKey && instructorRecords[idKey]);

        const resolvedId = matched?.id || r.instructorId || (r.userEmail ? (instructorMap[r.userEmail] || instructorMap[emailKey]) : undefined);
        const resolvedName = matched?.name || r.userName;
        const resolvedPos = matched?.position !== undefined ? matched.position : r.userPosition;

        let attendedDaysCount = 0;
        const sessionValues = displaySessions.map(s => {
          const att = r.attendedSessions?.[s.id];
          if (att?.attended) {
            attendedDaysCount += 1;
            const timeStr = att.checkInAt ? new Date(att.checkInAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
            return `"Attended${timeStr ? ` (${timeStr})` : ''}${att.checkInSequenceNumber ? ` #${att.checkInSequenceNumber}` : ''}"`;
          }
          return '"Not Checked In"';
        });

        return [
          index + 1,
          `"${resolvedId || "-"}"`,
          `"${formatInstructorName(resolvedName, resolvedId, resolvedPos)}"`,
          `"${resolvedPos || "-"}"`,
          `"${r.userDepartment || "-"}"`,
          `"${r.userEmail}"`,
          ...sessionValues,
          `"${attendedDaysCount}/${displaySessions.length} Days"`,
          `"${r.attended ? "Attended" : "Registered"}"`
        ];
      });
      csvContent = [
        headers.join(","),
        ...rows.map(row => row.join(","))
      ].join("\n");
    } else {
      const headers = ["No.", "Instructor ID", "Name", "Position", "Department", "Email", "Session", "Status"];
      const rows = registrations.map((r, index) => {
        const emailKey = r.userEmail ? r.userEmail.toLowerCase().trim() : "";
        const idKey = r.instructorId ? r.instructorId.toLowerCase().trim() : "";
        const matched = (emailKey && instructorRecords[emailKey]) || (idKey && instructorRecords[idKey]);

        const resolvedId = matched?.id || r.instructorId || (r.userEmail ? (instructorMap[r.userEmail] || instructorMap[emailKey]) : undefined);
        const resolvedName = matched?.name || r.userName;
        const resolvedPos = matched?.position !== undefined ? matched.position : r.userPosition;

        return [
          index + 1,
          `"${resolvedId || "-"}"`,
          `"${formatInstructorName(resolvedName, resolvedId, resolvedPos)}"`,
          `"${resolvedPos || "-"}"`,
          `"${r.userDepartment || "-"}"`,
          `"${r.userEmail}"`,
          `"${r.sessionName || "N/A"}"`,
          `"${r.attended ? "Attended" : "Registered"}"`
        ];
      });
      csvContent = [
        headers.join(","),
        ...rows.map(row => row.join(","))
      ].join("\n");
    }

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
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest w-16">No.</th>
                <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">รหัสอาจารย์</th>
                <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">ชื่อ-นามสกุล</th>
                <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">ตำแหน่ง/คณะ</th>
                
                {isMulti ? (
                  <>
                    {displaySessions.map((s, idx) => (
                      <th key={s.id} className="px-4 py-4 text-[12px] lg:text-[13px] font-medium text-slate-500 uppercase tracking-wider text-center whitespace-nowrap">
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-slate-700">{s.sessionName || `วันที่ ${idx + 1}`}</span>
                          {s.date && <span className="text-[11px] text-slate-400 font-normal">{formatDateThai(s.date)}</span>}
                        </div>
                      </th>
                    ))}
                    <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest text-center">ภาพรวม</th>
                  </>
                ) : (
                  <>
                    <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">เซสชัน</th>
                    <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">สถานะ</th>
                    <th className="px-6 py-4 text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest text-right">Action</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {registrations.map((reg, index) => {
                const emailKey = reg.userEmail ? reg.userEmail.toLowerCase().trim() : "";
                const idKey = reg.instructorId ? reg.instructorId.toLowerCase().trim() : "";
                const matched = (emailKey && instructorRecords[emailKey]) || (idKey && instructorRecords[idKey]);

                const resolvedId = matched?.id || reg.instructorId || (reg.userEmail ? (instructorMap[reg.userEmail] || instructorMap[emailKey]) : undefined);
                const resolvedName = matched?.name || reg.userName;
                const resolvedPos = matched?.position !== undefined ? matched.position : reg.userPosition;

                return (
                  <tr key={reg.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-300">
                      {String(index + 1).padStart(2, '0')}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[12px] lg:text-[13px] font-mono font-medium text-slate-400">
                        {resolvedId || "-"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-[14px] lg:text-[16px] font-normal text-[#333333]">
                          {formatInstructorName(resolvedName, resolvedId, resolvedPos)}
                        </span>
                        <span className="text-[12px] text-slate-400 font-normal">{reg.userEmail}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-[14px] lg:text-[16px] font-normal text-[#4A4A4A]">{resolvedPos || reg.userPosition || "-"}</span>
                        <span className="text-[12px] text-slate-400 font-normal">{reg.userDepartment}</span>
                      </div>
                    </td>

                    {isMulti ? (
                      <>
                        {displaySessions.map(s => {
                          const att = reg.attendedSessions?.[s.id];
                          const isAttended = att?.attended ?? false;
                          return (
                            <td key={s.id} className="px-3 py-4 text-center">
                              <button
                                onClick={() => handleToggleSession(reg.id, s.id, isAttended, s.date, s.sessionName)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all ${
                                  isAttended 
                                    ? "bg-green-100 text-green-700 hover:bg-green-200" 
                                    : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                                }`}
                                title={isAttended ? "คลิกเพื่อยกเลิกเช็คอิน" : "คลิกเพื่อเช็คอิน"}
                              >
                                {isAttended ? <CheckCircle2 className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                <span>{isAttended ? "มาอบรม" : "ยังไม่เช็คอิน"}</span>
                              </button>
                            </td>
                          );
                        })}
                        <td className="px-6 py-4 text-center">
                          {(() => {
                            const attendedCount = displaySessions.filter(s => reg.attendedSessions?.[s.id]?.attended).length;
                            const totalDays = displaySessions.length;
                            return (
                              <span className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold ${
                                attendedCount === totalDays && totalDays > 0
                                  ? "bg-green-100 text-green-700"
                                  : attendedCount > 0
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}>
                                {attendedCount}/{totalDays} วัน
                              </span>
                            );
                          })()}
                        </td>
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
                  </tr>
                );
              })}
              {registrations.length === 0 && (
                <tr>
                  <td colSpan={isMulti ? 5 + displaySessions.length : 7} className="px-6 py-20 text-center text-slate-400 font-medium">ยังไม่มีผู้ลงทะเบียน</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
