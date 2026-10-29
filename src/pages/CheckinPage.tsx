import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import { Course, CourseSession, Registration } from "../types";
import { motion } from "motion/react";
import { CheckCircle2, Loader2, XCircle, ShieldCheck, MapPin, Calendar, Clock, ArrowRight, UserCheck } from "lucide-react";
import { RegistrationService } from "../lib/registrationService";
import { formatDateThai, formatSessionTime, getCourseSessions } from "../lib/utils";
import toast from "react-hot-toast";

export const CheckinPage: React.FC = () => {
  const { courseId, sessionId: routeSessionId } = useParams<{ courseId: string; sessionId?: string }>();
  const [searchParams] = useSearchParams();
  const querySessionId = searchParams.get("sessionId");
  const targetSessionId = routeSessionId || querySessionId || undefined;

  const navigate = useNavigate();
  const { user, loading: authLoading, login } = useAuth();
  
  const [course, setCourse] = useState<Course | null>(null);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<"loading" | "success" | "error" | "select_session">("loading");
  const [message, setMessage] = useState("");
  const [isAlreadyCheckedIn, setIsAlreadyCheckedIn] = useState(false);
  const [checkedSession, setCheckedSession] = useState<CourseSession | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [availableSessions, setAvailableSessions] = useState<CourseSession[]>([]);

  const executeCheckin = async (sessionParamId?: string) => {
    if (!user) {
      setChecking(false);
      setStatus("error");
      setMessage("กรุณาเข้าสู่ระบบด้วยบัญชี Google (@bu.ac.th) เพื่อดำเนินการเช็คอิน");
      return;
    }

    setChecking(true);
    setStatus("loading");

    try {
      const courseSnap = await getDoc(doc(db, "courses", courseId!));
      if (!courseSnap.exists()) {
        setStatus("error");
        setMessage("ไม่พบข้อมูลหลักสูตรในระบบ");
        return;
      }
      const courseData = { id: courseSnap.id, ...courseSnap.data() } as Course;
      setCourse(courseData);

      const result = await RegistrationService.checkInSession(courseId!, user.uid, sessionParamId);

      if (result.requiresSessionSelection) {
        setAvailableSessions(result.availableSessions || getCourseSessions(courseData));
        setRegistration(result.registration || null);
        setStatus("select_session");
        setMessage(result.message);
        return;
      }

      if (result.success) {
        setStatus("success");
        setMessage(result.message);
        setIsAlreadyCheckedIn(result.isAlreadyCheckedIn || false);
        setCheckedSession(result.session || null);
        setRegistration(result.registration || null);
      }
    } catch (error: any) {
      console.error("Checkin execution error:", error);
      setStatus("error");
      setMessage(error?.message || "เกิดข้อผิดพลาดในการเช็คอิน กรุณาลองใหม่อีกครั้ง");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!courseId) {
      setStatus("error");
      setMessage("ไม่พบรหัสหลักสูตร");
      setChecking(false);
      return;
    }

    executeCheckin(targetSessionId);
  }, [courseId, targetSessionId, user, authLoading]);

  if (authLoading || (checking && status === "loading")) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-8">
        <Loader2 className="w-12 h-12 text-crimson animate-spin mb-4" />
        <p className="text-slate-500 font-bold animate-pulse">กำลังตรวจสอบและบันทึกข้อมูลการเช็คอิน...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 py-12">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-[3rem] shadow-2xl border border-slate-200 p-8 sm:p-10 max-w-lg w-full text-center"
      >
        <div className="mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center shadow-lg">
              <ShieldCheck className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mb-1">BU Training Check-in</h1>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Learning Development Office</p>
        </div>

        {/* 1. SUCCESS STATE */}
        {status === "success" && (
          <div className="space-y-6">
            <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black text-slate-800">{message}</h2>
              {isAlreadyCheckedIn && (
                <p className="text-xs text-slate-500 font-light">
                  ระบบได้บันทึกการเช็คอินของคุณไว้ก่อนหน้านี้แล้ว
                </p>
              )}
            </div>

            {course && (
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 text-left space-y-3">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-0.5">หลักสูตร</span>
                  <p className="text-sm font-bold text-slate-800 leading-snug">{course.title}</p>
                </div>

                {checkedSession && (
                  <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                    <span className="font-bold text-crimson flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {checkedSession.sessionName || "วันอบรม"}: {formatDateThai(checkedSession.date)}
                    </span>
                    <span className="text-slate-500 font-light">
                      {formatSessionTime(checkedSession.startTime, checkedSession.endTime, "th")}
                    </span>
                  </div>
                )}

                {registration && (
                  <div className="pt-2 border-t border-slate-200/60 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 font-medium block">ผู้เข้าอบรม</span>
                      <span className="font-medium text-slate-700">{registration.userName}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 font-medium block">ลำดับเช็คอิน</span>
                      <span className="font-bold text-emerald-600">
                        #{registration.checkInSequenceNumber || registration.sequenceNumber || "-"}
                      </span>
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-200/60 flex items-center gap-1.5 text-xs text-slate-500">
                  <MapPin className="w-3.5 h-3.5 text-crimson shrink-0" />
                  <span>สถานที่: {checkedSession?.locationDetail || course.locationDetail || "On-site"}</span>
                </div>
              </div>
            )}

            <button 
              onClick={() => navigate("/")}
              className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-xl text-sm"
            >
              กลับไปหน้าแรก
            </button>
          </div>
        )}

        {/* 2. MULTI-DAY SESSION SELECTION STATE */}
        {status === "select_session" && (
          <div className="space-y-6 text-left">
            <div className="text-center space-y-1">
              <h2 className="text-lg font-bold text-slate-800">เลือกวันที่ต้องการเช็คอิน</h2>
              <p className="text-xs text-slate-500 font-light">
                หลักสูตรนี้จัดอบรมหลายวัน โปรดเลือกวันที่ท่านต้องการยืนยันการเข้าอบรม
              </p>
            </div>

            {course && (
              <div className="p-3.5 bg-crimson/5 rounded-2xl border border-crimson/10 text-xs">
                <span className="font-bold text-slate-800 line-clamp-1">{course.title}</span>
              </div>
            )}

            <div className="space-y-2.5">
              {availableSessions.map((session, idx) => {
                const sessionAtt = registration?.attendedSessions?.[session.id];
                const isAttended = sessionAtt?.attended;
                return (
                  <div 
                    key={session.id}
                    className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-3 hover:border-slate-300 transition-all"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-crimson text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-slate-800 text-sm">
                          วันที่ {idx + 1} ({formatDateThai(session.date)})
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 font-light flex items-center gap-1.5 pl-7">
                        <Clock className="w-3 h-3 text-crimson" />
                        <span>{formatSessionTime(session.startTime, session.endTime, "th")}</span>
                      </div>
                    </div>

                    {isAttended ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-700 text-xs font-bold shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        เช็คอินแล้ว
                      </span>
                    ) : (
                      <button
                        onClick={() => executeCheckin(session.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-crimson hover:bg-crimson-dark text-white text-xs font-bold shadow-md shadow-crimson/10 transition-all shrink-0"
                      >
                        เช็คอินวันนี้
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <button 
              onClick={() => navigate("/")}
              className="w-full py-3.5 bg-slate-100 text-slate-600 font-medium rounded-xl hover:bg-slate-200 transition-all text-sm text-center"
            >
              ยกเลิกและกลับไปหน้าแรก
            </button>
          </div>
        )}

        {/* 3. ERROR STATE */}
        {status === "error" && (
          <div className="space-y-6">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm">
              <XCircle className="w-10 h-10 text-red-500" />
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-black text-slate-800">{message}</h2>
              <p className="text-slate-500 text-xs font-light leading-relaxed">
                {user 
                  ? "หากท่านลงทะเบียนในหลักสูตรนี้แล้ว กรุณาตรวจสอบว่าท่านเข้าสู่ระบบด้วยบัญชีเดียวกัน หรือติดต่อเจ้าหน้าที่สำนักพัฒนาการเรียนรู้" 
                  : "กรุณาเข้าสู่ระบบด้วยบัญชี Google มหาวิทยาลัยกรุงเทพ (@bu.ac.th)"
                }
              </p>
            </div>

            {user ? (
              <div className="flex flex-col gap-2.5">
                <button 
                  onClick={() => executeCheckin(targetSessionId)}
                  className="w-full py-3.5 bg-crimson text-white font-bold rounded-xl hover:bg-crimson-dark transition-all shadow-md shadow-crimson/10 text-sm"
                >
                  ลองเช็คอินใหม่อีกครั้ง
                </button>
                <button 
                  onClick={() => navigate("/")}
                  className="w-full py-3.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-all text-sm"
                >
                  กลับไปหน้าแรก
                </button>
              </div>
            ) : (
              <button 
                onClick={login}
                className="w-full py-4 bg-crimson text-white font-bold rounded-2xl hover:bg-crimson-dark transition-all shadow-xl text-sm"
              >
                เข้าสู่ระบบด้วย Google
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
};
