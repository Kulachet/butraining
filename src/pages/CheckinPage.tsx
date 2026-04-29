import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { 
  doc, 
  getDoc, 
  query, 
  collection, 
  where, 
  getDocs, 
  updateDoc 
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import { Course, Registration } from "../types";
import { motion } from "motion/react";
import { CheckCircle2, Loader2, XCircle, ShieldCheck, MapPin, Calendar, Clock } from "lucide-react";
import toast from "react-hot-toast";

export const CheckinPage: React.FC = () => {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, login } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<"success" | "error" | "loading">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const performCheckin = async () => {
      if (authLoading) return;
      if (!user) {
        setChecking(false);
        setStatus("error");
        setMessage("กรุณาเข้าสู่ระบบก่อนเช็คอิน");
        return;
      }

      try {
        // 1. Fetch Course
        const courseSnap = await getDoc(doc(db, "courses", courseId!));
        if (!courseSnap.exists()) {
          setStatus("error");
          setMessage("ไม่พบข้อมูลหลักสูตร");
          return;
        }
        const courseData = courseSnap.data() as Course;
        setCourse(courseData);

        // 2. Find Registration for this user and course
        const regRef = doc(db, "registrations", `${courseId}_${user.uid}`);
        const regSnap = await getDoc(regRef);

        if (!regSnap.exists()) {
          setStatus("error");
          setMessage("คุณยังไม่ได้ลงทะเบียนในหลักสูตรนี้");
          return;
        }

        const regData = regSnap.data() as Registration;

        if (regData.attended) {
          setStatus("success");
          setMessage("คุณได้เช็คอินเรียบร้อยแล้วก่อนหน้านี้");
        } else {
          // 3. Update Attendance
          // Optimization: Only count attended registrations or get the specific max number
          // We'll use a simple count of already attended people as the sequence number for now
          // to avoid listing ALL registrations which might be large or restricted.
          const attendedQ = query(
            collection(db, "registrations"), 
            where("courseId", "==", courseId),
            where("attended", "==", true)
          );
          const attendedSnap = await getDocs(attendedQ);
          let currentAttendeesCount = attendedSnap.size;

          try {
            await updateDoc(regRef, {
              attended: true,
              checkInAt: new Date().toISOString(),
              checkInSequenceNumber: currentAttendeesCount + 1
            });
            setStatus("success");
            setMessage("เช็คอินสำเร็จ! ยินดีต้อนรับเข้าสู่การอบรม");
          } catch (updateError: any) {
            console.error("Update error:", updateError);
            if (updateError.message?.includes("permission-denied") || updateError.code === "permission-denied") {
              throw new Error("ไม่มีสิทธิ์ในการบันทึกข้อมูล (Permission Denied) กรุณาติดต่อผู้ดูแลระบบเพื่อตรวจสอบ Security Rules");
            }
            throw updateError;
          }
        }
      } catch (error: any) {
        console.error("Checkin error detail:", error);
        setStatus("error");
        
        let errorMsg = "เกิดข้อผิดพลาดในการเช็คอิน กรุณาลองใหม่อีกครั้ง";
        if (error instanceof Error) {
          if (error.message.includes("Permission Denied") || error.message.includes("permission-denied")) {
            errorMsg = "ไม่สามารถบันทึกข้อมูลได้เนื่องจากข้อจำกัดด้านสิทธิ์เข้าถึง (Security Rules)";
          } else if (error.message.includes("not found")) {
            errorMsg = error.message;
          }
        }
        setMessage(errorMsg);
      } finally {
        setChecking(false);
      }
    };

    performCheckin();
  }, [courseId, user, authLoading]);

  if (authLoading || (checking && status === "loading")) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-8">
        <Loader2 className="w-12 h-12 text-crimson animate-spin mb-4" />
        <p className="text-slate-500 font-bold animate-pulse">กำลังตรวจสอบข้อมูลการเช็คอิน...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-[3rem] shadow-2xl border border-slate-200 p-10 max-w-md w-full text-center"
      >
        <div className="mb-8">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center shadow-lg">
              <ShieldCheck className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mb-2">BU Training Check-in</h1>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">LDO Management System</p>
        </div>

        {status === "success" ? (
          <div className="space-y-6">
            <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-black text-slate-800">{message}</h2>
              {course && (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-left space-y-2">
                  <p className="text-sm font-bold text-slate-700 line-clamp-1">{course.title}</p>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1 uppercase tracking-wider">
                      <Calendar className="w-3 h-3" /> {course.date}
                    </span>
                    <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1 uppercase tracking-wider">
                      <MapPin className="w-3 h-3" /> {course.locationDetail || "On-site"}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <button 
              onClick={() => navigate("/")}
              className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-xl"
            >
              กลับไปหน้าหลัก
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-12 h-12 text-red-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-black text-slate-800">{message}</h2>
              <p className="text-slate-500 text-sm font-medium">
                {user ? "หากคุณแน่ใจว่าลงทะเบียนแล้ว กรุณาลองใหม่อีกครั้ง หรือติดต่อผู้ดูแลระบบ" : "กรุณาเข้าสู่ระบบด้วย @bu.ac.th เพื่อดำเนินการต่อ"}
              </p>
            </div>
            {user ? (
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => window.location.reload()}
                  className="w-full py-4 bg-crimson text-white font-bold rounded-2xl hover:bg-crimson-dark transition-all shadow-xl"
                >
                  ลองสแกนใหม่อีกครั้ง
                </button>
                <button 
                  onClick={() => navigate("/")}
                  className="w-full py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all"
                >
                  กลับไปหน้าหลัก
                </button>
              </div>
            ) : (
              <button 
                onClick={login}
                className="w-full py-4 bg-crimson text-white font-bold rounded-2xl hover:bg-crimson-dark transition-all shadow-xl"
              >
                เข้าสู่ระบบเพื่อเช็คอิน
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
};
