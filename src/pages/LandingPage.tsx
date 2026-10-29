import React, { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy, where, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Course, Session, Registration } from "../types";
import { useAuth } from "../components/AuthProvider";
import { CourseCard } from "../components/CourseCard";
import { InstructorProfile } from "../components/InstructorProfile";
import { NewInstructorModal } from "../components/NewInstructorModal";
import { RegistrationService } from "../lib/registrationService";
import { motion, AnimatePresence } from "motion/react";
import { Search, Filter, Sparkles, Loader2, X, Clock, MapPin, CheckCircle2, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { cn, generateGoogleCalendarUrl, formatInstructorName, isMultiDayCourse } from "../lib/utils";
import { useLanguage } from "../contexts/LanguageContext";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

interface CancelTarget {
  courseId: string;
  courseTitle?: string;
  sessionId?: string;
  sessionName?: string;
  registrationId?: string;
}

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { lang, t } = useLanguage();
  const [courses, setCourses] = useState<Course[]>([]);
  const [userRegistrations, setUserRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState<string | null>(null);
  const { user, instructor, login, registerInstructor } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [courseToCancel, setCourseToCancel] = useState<CancelTarget | null>(null);
  
  // Search and Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ทั้งหมด");
  
  // Session Selection State
  const [selectedCourseForSession, setSelectedCourseForSession] = useState<Course | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  useEffect(() => {
    // Real-time listener for courses
    const q = query(
      collection(db, "courses"), 
      orderBy("date", "asc")
    );
    
    const unsubscribeCourses = onSnapshot(q, (querySnapshot) => {
      const fetchedCourses = querySnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter((course: any) => course.isVisible !== false && !course.archived)
        .sort((a: any, b: any) => {
          const dateA = new Date(a.date).getTime();
          const dateB = new Date(b.date).getTime();
          if (dateA !== dateB) return dateA - dateB;
          const timeA = a.startTime || a.sessions?.[0]?.startTime || "00:00";
          const timeB = b.startTime || b.sessions?.[0]?.startTime || "00:00";
          return timeA.localeCompare(timeB);
        }) as Course[];
      
      setCourses(fetchedCourses);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching courses:", error);
      setLoading(false);
    });

    return () => unsubscribeCourses();
  }, []);

  useEffect(() => {
    if (!user) {
      setUserRegistrations([]);
      return;
    }

    // Real-time listener for user registrations
    const regQ = query(
      collection(db, "registrations"),
      where("userId", "==", user.uid)
    );
    
    const unsubscribeRegs = onSnapshot(regQ, (regSnapshot) => {
      const regs = regSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Registration);
      setUserRegistrations(regs);
    }, (error) => {
      console.error("Error fetching registrations:", error);
    });

    return () => unsubscribeRegs();
  }, [user]);

  useEffect(() => {
    if (user && !instructor && !loading) {
      setShowModal(true);
    } else {
      setShowModal(false);
    }
  }, [user, instructor, loading]);

  const handleEvaluate = (courseId: string) => {
    navigate(`/evaluate/${courseId}`);
  };

  const handleRegisterClick = (courseId: string) => {
    if (!user) {
      login();
      return;
    }

    if (!instructor) {
      setShowModal(true);
      return;
    }

    const course = courses.find(c => c.id === courseId);
    if (!course) return;

    // Duplicate check
    const isAlreadyReg = userRegistrations.some(r => r.courseId === course.id);
    if (isAlreadyReg) {
      toast.error(lang === 'en' ? "You are already registered for this workshop" : "ท่านได้ลงทะเบียนหลักสูตรนี้ไปแล้ว");
      return;
    }

    const isMulti = isMultiDayCourse(course);
    if (isMulti) {
      // Phase 2A cohort-level registration: Register once for the entire workshop cohort
      handleFinalRegister(course);
    } else if (course.sessions && course.sessions.length > 1) {
      // Single-day course with alternate sessions
      setSelectedCourseForSession(course);
      setSelectedSessionId((course.sessions[0] as any).sessionId || course.sessions[0].id);
    } else {
      // Single session or legacy course
      const session = course.sessions?.[0] as any;
      handleFinalRegister(course, session);
    }
  };

  const handleFinalRegister = async (course: Course, session?: Session) => {
    setRegistering(course.id);
    try {
      await RegistrationService.registerForCourse(course, instructor!, session);
      
      const isMulti = isMultiDayCourse(course);
      toast.success(lang === 'en' ? "Registration successful!" : "ลงทะเบียนสำเร็จเรียบร้อยแล้ว!");
      
      // Auto-send Calendar Invite via GAS using backward-compatible payload contract
      const gasUrl = "https://script.google.com/macros/s/AKfycbyk4505Uis2F-0fKsX7X9iuDsrOfB7aPyD_TO00JUq_BMi9ZDUBzjSKFOFsNHrSVVxN/exec";
      const formattedGuestName = formatInstructorName(instructor!.name, instructor!.id, instructor!.position);
      const formattedSpeakerName = formatInstructorName(course.instructorName, course.instructorId);

      const locationText = session?.locationDetail || course.locationDetail || course.sessions?.[0]?.locationDetail || "ไม่ระบุ";
      const dateText = session?.date || course.date || course.sessions?.[0]?.date || "";
      const startText = session?.startTime || course.startTime || course.sessions?.[0]?.startTime || "09:00";
      const endText = session?.endTime || course.endTime || course.sessions?.[0]?.endTime || "16:00";

      const payload = {
        courseTitle: course.title,
        description: course.description || "",
        instructorName: formattedSpeakerName || course.instructorName || "",
        location: locationText,
        guestEmail: instructor!.email,
        guestName: formattedGuestName,
        recipientName: formattedGuestName,
        guestId: instructor!.id,
        guestPosition: instructor!.position || "",
        date: dateText,
        startTime: startText,
        endTime: endText
      };

      fetch(gasUrl, {
        method: "POST",
        mode: "no-cors", // Add no-cors to bypass strict CORS on Netlify
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify(payload)
      })
      .then(() => {
        if (isMulti) {
          toast.success(
            lang === 'en'
              ? "Calendar invite sent for Day 1. (Note: Additional workshop dates must be scheduled manually)"
              : "ส่งคำเชิญปฏิทินสำหรับวันแรกแล้ว (หมายเหตุ: วันอบรมถัดไปกรุณาบันทึกลงปฏิทินเพิ่มเติม)",
            { duration: 6000 }
          );
        } else {
          toast.success(
            lang === 'en' 
              ? "Calendar invitation sent. Please check your email." 
              : "ส่งคำเชิญลงปฏิทินเรียบร้อยแล้ว กรุณาตรวจสอบอีเมล"
          );
        }
      })
      .catch(err => {
        console.error("Calendar fetch error:", err);
        toast.error(
          lang === 'en'
            ? "Could not send automated Calendar invitation. Your registration remains confirmed."
            : "ไม่สามารถส่งคำเชิญลงปฏิทินอัตโนมัติได้ (การลงทะเบียนของท่านยังคงสมบูรณ์)"
        );
      });

      setSelectedCourseForSession(null);
    } catch (error: any) {
      console.error("Registration error:", error);
      const errorMessage = error.message || "";
      
      if (errorMessage.includes("Already registered")) {
        toast.error(lang === 'en' ? "You are already registered for this workshop" : "ท่านได้ลงทะเบียนหลักสูตรนี้ไปแล้ว");
      } else if (errorMessage.includes("Session is full") || errorMessage.includes("Course is full")) {
        toast.error(lang === 'en' ? "Sorry, this workshop is full" : "ขออภัย ที่นั่งสำหรับหลักสูตรนี้เต็มแล้ว");
      } else if (errorMessage.includes("permission-denied") || errorMessage.includes("insufficient permissions")) {
        toast.error("ไม่มีสิทธิ์ในการดำเนินการ (Permission Denied) กรุณาติดต่อผู้ดูแลระบบ");
      } else {
        toast.error(`การลงทะเบียนขัดข้อง: ${errorMessage || "กรุณาลองใหม่อีกครั้ง"}`);
      }
    } finally {
      setRegistering(null);
    }
  };

  const handleOpenCancelModal = (courseId: string, sessionId?: string) => {
    const course = courses.find(c => c.id === courseId);
    const matchingReg = userRegistrations.find(r => 
      r.courseId === courseId && (!sessionId || r.sessionId === sessionId)
    );

    const actualSessionId = sessionId || matchingReg?.sessionId || course?.sessions?.[0]?.sessionId;
    const actualSessionName = matchingReg?.sessionName || 
      course?.sessions?.find(s => s.sessionId === actualSessionId)?.sessionName;

    setCourseToCancel({
      courseId,
      sessionId: actualSessionId,
      courseTitle: course?.title || matchingReg?.courseTitle || "หลักสูตร",
      sessionName: actualSessionName,
      registrationId: matchingReg?.id,
    });
  };

  const handleConfirmCancel = async (target: CancelTarget) => {
    const currentUserId = user?.uid || instructor?.uid;
    if (!currentUserId) {
      toast.error("กรุณาเข้าสู่ระบบก่อนทำรายการ");
      return;
    }
    setRegistering(target.courseId);
    try {
      await RegistrationService.cancelRegistration(
        target.courseId, 
        currentUserId, 
        target.sessionId, 
        target.registrationId
      );
      toast.success("ยกเลิกการลงทะเบียนเรียบร้อยแล้ว");
      setCourseToCancel(null);
    } catch (error: any) {
      console.error("Cancel error:", error);
      const msg = error?.message || "";
      if (msg.includes("ไม่พบข้อมูลการลงทะเบียน")) {
        toast.error("ไม่พบข้อมูลการลงทะเบียน กรุณารีเฟรชหน้าแล้วลองอีกครั้ง");
      } else {
        toast.error(`ยกเลิกไม่สำเร็จ: ${msg || "กรุณาลองใหม่อีกครั้ง"}`);
      }
    } finally {
      setRegistering(null);
    }
  };

  const handleCancelSession = async (courseId: string, sessionId: string) => {
    const currentUserId = user?.uid || instructor?.uid;
    if (!currentUserId) {
      toast.error("กรุณาเข้าสู่ระบบก่อนทำรายการ");
      return;
    }
    setRegistering(courseId);
    try {
      const matchingReg = userRegistrations.find(r => r.courseId === courseId && r.sessionId === sessionId);
      await RegistrationService.cancelRegistration(courseId, currentUserId, sessionId, matchingReg?.id);
      toast.success("ยกเลิกการลงทะเบียนเรียบร้อยแล้ว");
      setSelectedCourseForSession(null);
    } catch (error: any) {
      console.error("Cancel session error:", error);
      const msg = error?.message || "";
      if (msg.includes("ไม่พบข้อมูลการลงทะเบียน")) {
        toast.error("ไม่พบข้อมูลการลงทะเบียน กรุณารีเฟรชหน้าแล้วลองอีกครั้ง");
      } else {
        toast.error(`ยกเลิกไม่สำเร็จ: ${msg || "กรุณาลองใหม่อีกครั้ง"}`);
      }
    } finally {
      setRegistering(null);
    }
  };

  const isAllCategory = selectedCategory === "ทั้งหมด" || selectedCategory === "All";
  const filteredCourses = courses.filter(course => {
    const matchesSearch = course.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (course.description && course.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          (course.instructorName && course.instructorName.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = isAllCategory || course.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Extract unique categories from courses
  const allCategoryLabel = lang === "en" ? "All" : "ทั้งหมด";
  const categories = [allCategoryLabel, ...Array.from(new Set(courses.map(c => c.category).filter(Boolean)))];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {!user ? (
        <div className="flex-1 relative flex flex-col items-center justify-center overflow-hidden px-4 py-16">
          {/* Background Image */}
          <div 
            className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
            style={{ 
              backgroundImage: `url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop')`,
            }}
          />
          {/* White Overlay to lighten the background */}
          <div className="absolute inset-0 z-0 bg-white/70" />

          {/* Prominent Language Switcher */}
          <div className="relative z-20 mb-8">
            <LanguageSwitcher size="md" className="shadow-lg bg-white/95 border-slate-300" />
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 text-center max-w-4xl mx-auto"
          >
            {lang === "en" ? (
              <>
                <h1 className="text-3xl md:text-5xl font-medium text-slate-800 mb-3 tracking-wide leading-tight">
                  Welcome to the Academic Training Portal
                </h1>
                <h1 className="text-3xl md:text-5xl font-medium text-crimson mb-8 tracking-wide leading-tight">
                  Learning Development Office
                </h1>
                <p className="text-lg md:text-xl text-slate-600 font-light tracking-wide leading-relaxed mb-12 max-w-2xl mx-auto">
                  Sign in with your Bangkok University Google account to explore and register for professional development workshops.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-3xl md:text-5xl font-medium text-slate-800 mb-2 tracking-wide leading-tight">
                  ยินดีต้อนรับสู่ระบบลงทะเบียน
                </h1>
                <h1 className="text-3xl md:text-5xl font-medium text-slate-800 mb-2 tracking-wide leading-tight">
                  การอบรมเชิงปฏิบัติการ
                </h1>
                <h1 className="text-3xl md:text-5xl font-medium text-crimson mb-10 tracking-wide leading-tight">
                  สำนักพัฒนาการเรียนรู้
                </h1>
                <p className="text-lg md:text-xl text-slate-600 font-light tracking-wide leading-relaxed mb-1">
                  กรุณาเข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัย
                </p>
                <p className="text-lg md:text-xl text-slate-600 font-light tracking-wide leading-relaxed mb-16">
                  เพื่อดำเนินการลงทะเบียนอบรม
                </p>
              </>
            )}
            
            <button 
              onClick={login}
              className="bg-crimson hover:bg-crimson-dark text-white font-medium px-10 py-4 rounded-2xl shadow-2xl shadow-crimson/10 transition-all flex items-center justify-center gap-4 mx-auto text-xl group cursor-pointer"
            >
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
              </div>
              {t("welcomeSignInButton")}
            </button>
          </motion.div>
        </div>
      ) : (
        <>
          {/* Hero Section for Logged In Users */}
          <section className="relative bg-white pt-20 pb-32 overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full opacity-5 pointer-events-none">
              <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-crimson blur-3xl" />
            </div>
            
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-left"
                >
                  <div className="inline-flex items-center gap-2 bg-crimson-light px-4 py-2 rounded-full text-crimson font-medium text-sm mb-8 tracking-wide">
                    <Sparkles className="w-4 h-4" />
                    <span>{t("heroBadge")}</span>
                  </div>
                  <h1 className="text-4xl md:text-5xl font-medium text-slate-800 mb-6 tracking-wide leading-tight">
                    {t("heroTitle1")}<br />
                    <span className="text-crimson">{t("heroTitle2")}</span>
                  </h1>
                  <p className="text-xl text-slate-500 font-light leading-relaxed mb-10 tracking-wide">
                    {t("heroSubtitle")}
                  </p>
                </motion.div>

                <div className="hidden lg:block">
                  {instructor && <InstructorProfile instructor={instructor} />}
                </div>
              </div>
            </div>
          </section>

          {/* Mobile Profile View */}
          <div className="lg:hidden px-4 mb-12">
            {instructor && <InstructorProfile instructor={instructor} />}
          </div>

          {/* Main Content Area */}
          <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 pb-20">
            <div className="w-full flex flex-col gap-6">
              {filteredCourses.length === 0 ? (
                <div className="bg-white p-12 rounded-3xl border border-slate-200 shadow-sm text-center">
                  <p className="text-slate-500 font-light">{t("noCoursesFound")}</p>
                </div>
              ) : (
                filteredCourses.map((course, index) => (
                  <motion.div
                    key={course.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <CourseCard 
                      course={course} 
                      onRegister={handleRegisterClick} 
                      onCancel={handleOpenCancelModal}
                      onEvaluate={handleEvaluate}
                      isLoading={registering === course.id}
                      isRegistered={userRegistrations.some(r => r.courseId === course.id)}
                    />
                  </motion.div>
                ))
              )}
            </div>
          </section>
        </>
      )}

      {/* Cancel Confirmation Modal */}
      <AnimatePresence>
        {courseToCancel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl relative z-10"
            >
              <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-bold text-center text-slate-800 mb-2">{t("cancelConfirmTitle")}</h3>
              {courseToCancel.courseTitle && (
                <p className="text-center font-medium text-slate-700 mb-1 px-4 truncate">
                  {courseToCancel.courseTitle}
                </p>
              )}
              {courseToCancel.sessionName && (
                <p className="text-center text-xs text-crimson font-medium mb-3">
                  {t("cancelSessionLabel")} {courseToCancel.sessionName}
                </p>
              )}
              <p className="text-center text-slate-500 mb-8 text-sm">
                {t("cancelConfirmDesc")}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setCourseToCancel(null)}
                  className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors disabled:opacity-50"
                  disabled={registering === courseToCancel.courseId}
                >
                  {t("cancelBack")}
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmCancel(courseToCancel)}
                  className="flex-1 py-3 px-4 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  disabled={registering === courseToCancel.courseId}
                >
                  {registering === courseToCancel.courseId ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    t("cancelConfirmAction")
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Session Selection Modal */}
      <AnimatePresence>
        {selectedCourseForSession && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedCourseForSession(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-[2.5rem] shadow-2xl p-8 max-w-lg w-full overflow-hidden"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-2xl font-medium text-slate-800 mb-1 tracking-wide">เลือกเซสชันที่ต้องการ</h3>
                  <p className="text-slate-500 font-light tracking-wide">{selectedCourseForSession.title}</p>
                </div>
                <button 
                  onClick={() => setSelectedCourseForSession(null)}
                  className="p-2 hover:bg-slate-50 rounded-full transition-colors"
                >
                  <X className="w-6 h-6 text-slate-300" />
                </button>
              </div>

              <div className="space-y-4 mb-8">
                {selectedCourseForSession.sessions.map((session) => {
                  const isRegisteredThisSession = userRegistrations.some(
                    r => r.courseId === selectedCourseForSession.id && r.sessionId === session.sessionId
                  );
                  return (
                    <button
                      key={session.sessionId}
                      onClick={() => setSelectedSessionId(session.sessionId)}
                      className={cn(
                        "w-full p-5 rounded-2xl border-2 text-left transition-all flex items-center justify-between group",
                        selectedSessionId === session.sessionId 
                          ? "border-crimson bg-crimson/5 ring-4 ring-crimson/10" 
                          : "border-slate-100 hover:border-slate-200 bg-slate-50",
                        isRegisteredThisSession && "border-green-100 bg-green-50/10"
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                          selectedSessionId === session.sessionId 
                            ? "bg-crimson text-white" 
                            : isRegisteredThisSession
                              ? "bg-green-600 text-white"
                              : "bg-white text-slate-400"
                        )}>
                          <Clock className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="font-black text-slate-900 flex items-center gap-2">
                            {session.sessionName}
                            {isRegisteredThisSession && (
                              <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                ลงทะเบียนแล้ว
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-slate-500 font-medium flex items-center gap-3 mt-1">
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {session.startTime} - {session.endTime}</span>
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {session.locationDetail}</span>
                          </div>
                        </div>
                      </div>
                      {selectedSessionId === session.sessionId && (
                        <CheckCircle2 className={cn("w-6 h-6", isRegisteredThisSession ? "text-green-600" : "text-crimson")} />
                      )}
                    </button>
                  );
                })}
              </div>

              {(() => {
                const isSelectedReg = userRegistrations.some(
                  r => r.courseId === selectedCourseForSession.id && r.sessionId === selectedSessionId
                );
                return (
                  <button
                    onClick={() => {
                      const session = selectedCourseForSession.sessions.find(s => s.sessionId === selectedSessionId);
                      if (isSelectedReg) {
                        handleOpenCancelModal(selectedCourseForSession.id, selectedSessionId!);
                        setSelectedCourseForSession(null);
                      } else {
                        handleFinalRegister(selectedCourseForSession, session);
                      }
                    }}
                    disabled={!selectedSessionId || registering === selectedCourseForSession.id}
                    className={cn(
                      "w-full font-medium py-4 rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 tracking-wide",
                      isSelectedReg
                        ? "bg-white hover:bg-red-50 text-red-500 border border-red-200 shadow-sm"
                        : "bg-crimson hover:bg-crimson-dark text-white shadow-crimson/10"
                    )}
                  >
                    {registering === selectedCourseForSession.id ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>{isSelectedReg ? "ยกเลิกการลงทะเบียนเซสชันนี้" : "ยืนยันการลงทะเบียน"}</>
                    )}
                  </button>
                );
              })()}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <NewInstructorModal 
        isOpen={showModal} 
        onClose={() => setShowModal(false)} 
        onSubmit={registerInstructor} 
      />
    </div>
  );
};
