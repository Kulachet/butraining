import React, { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy, where, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Course, Session } from "../types";
import { useAuth } from "../components/AuthProvider";
import { CourseCard } from "../components/CourseCard";
import { InstructorProfile } from "../components/InstructorProfile";
import { NewInstructorModal } from "../components/NewInstructorModal";
import { RegistrationService } from "../lib/registrationService";
import { motion, AnimatePresence } from "motion/react";
import { Search, Filter, Sparkles, Loader2, X, Clock, MapPin, CheckCircle2, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { cn, generateGoogleCalendarUrl } from "../lib/utils";

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [userRegistrations, setUserRegistrations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState<string | null>(null);
  const { user, instructor, login, registerInstructor } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [courseToCancel, setCourseToCancel] = useState<string | null>(null);
  
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
        .filter((course: any) => course.isVisible !== false)
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
      const registeredCourseIds = regSnapshot.docs.map(doc => doc.data().courseId);
      setUserRegistrations(registeredCourseIds);
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

    if (course.sessions && course.sessions.length > 1) {
      setSelectedCourseForSession(course);
      setSelectedSessionId(course.sessions[0].sessionId);
    } else {
      // Single session or legacy course
      const session = course.sessions?.[0];
      handleFinalRegister(course, session);
    }
  };

  const handleFinalRegister = async (course: Course, session?: Session) => {
    setRegistering(course.id);
    try {
      await RegistrationService.registerForCourse(course, instructor!, session);
      
      setUserRegistrations(prev => [...prev, course.id]);
      toast.success("ลงทะเบียนสำเร็จ! ระบบกำลังส่งคำเชิญลงปฏิทินของคุณ...");
      
      // Auto-send Calendar Invite via GAS
      const gasUrl = "https://script.google.com/macros/s/AKfycbzSvCdEpfWsC4NL-BKp1SqpbKpsJtENDVcFGoL23DNHlChwW9HPNtnMCkxjQelMN8AT/exec";
      const payload = {
        courseTitle: course.title,
        description: course.description || "",
        instructorName: course.instructorName || "",
        location: session?.locationDetail || course.locationDetail || "ไม่ระบุ",
        guestEmail: instructor!.email,
        date: session?.date || course.date,
        startTime: session?.startTime || course.startTime || "09:00",
        endTime: session?.endTime || course.endTime || "16:00"
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
        // With no-cors, we can't read the JSON response, so we assume success if no network error
        toast.success("ส่งคำเชิญลงปฏิทินเรียบร้อยแล้ว กรุณาตรวจสอบอีเมล");
      })
      .catch(err => {
        console.error("Calendar fetch error:", err);
        toast.error("ไม่สามารถส่งคำเชิญลงปฏิทินได้");
      });

      setSelectedCourseForSession(null);
    } catch (error: any) {
      console.error("Registration error:", error);
      const errorMessage = error.message || "";
      
      if (errorMessage.includes("Already registered")) {
        toast.error("ท่านได้ลงทะเบียนหลักสูตรนี้ไปแล้ว");
      } else if (errorMessage.includes("Session is full")) {
        toast.error("ขออภัย เซสชันนี้เต็มแล้ว");
      } else if (errorMessage.includes("permission-denied") || errorMessage.includes("insufficient permissions")) {
        toast.error("ไม่มีสิทธิ์ในการดำเนินการ (Permission Denied) กรุณาติดต่อผู้ดูแลระบบ");
      } else {
        toast.error(`การลงทะเบียนขัดข้อง: ${errorMessage || "กรุณาลองใหม่อีกครั้ง"}`);
      }
    } finally {
      setRegistering(null);
    }
  };

  const handleConfirmCancel = async (courseId: string) => {
    if (!instructor) return;
    setRegistering(courseId);
    try {
      await RegistrationService.cancelRegistration(courseId, instructor.uid);
      setUserRegistrations(prev => prev.filter(id => id !== courseId));
      toast.success("ยกเลิกการลงทะเบียนเรียบร้อยแล้ว");
      setCourseToCancel(null);
    } catch (error: any) {
      console.error("Cancel error:", error);
      toast.error(`ยกเลิกไม่สำเร็จ: ${error.message}`);
    } finally {
      setRegistering(null);
    }
  };

  const filteredCourses = courses.filter(course => {
    const matchesSearch = course.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (course.description && course.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          (course.instructorName && course.instructorName.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === "ทั้งหมด" || course.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Extract unique categories from courses
  const categories = ["ทั้งหมด", ...Array.from(new Set(courses.map(c => c.category).filter(Boolean)))];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {!user ? (
        <div className="flex-1 relative flex flex-col items-center justify-center overflow-hidden px-4">
          {/* Background Image */}
          <div 
            className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
            style={{ 
              backgroundImage: `url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop')`,
            }}
          />
          {/* White Overlay to lighten the background */}
          <div className="absolute inset-0 z-0 bg-white/70" />

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 text-center max-w-4xl mx-auto"
          >
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
            
            <button 
              onClick={login}
              className="bg-crimson hover:bg-crimson-dark text-white font-medium px-10 py-4 rounded-2xl shadow-2xl shadow-crimson/10 transition-all flex items-center justify-center gap-4 mx-auto text-xl group"
            >
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
              </div>
              เข้าสู่ระบบด้วย Google
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
                    <span>Bangkok University Training Portal</span>
                  </div>
                  <h1 className="text-4xl md:text-5xl font-medium text-slate-800 mb-6 tracking-wide leading-tight">
                    พัฒนาศักยภาพอาจารย์<br />
                    <span className="text-crimson">สู่ความเป็นเลิศทางวิชาการ</span>
                  </h1>
                  <p className="text-xl text-slate-500 font-light leading-relaxed mb-10 tracking-wide">
                    ยกระดับทักษะการสอนและการวิจัยด้วยหลักสูตรที่ทันสมัย ออกแบบมาเพื่ออาจารย์มหาวิทยาลัยกรุงเทพโดยเฉพาะ
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
                  <p className="text-slate-500 font-light">ไม่พบหลักสูตรที่ค้นหา</p>
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
                      onCancel={setCourseToCancel}
                      onEvaluate={handleEvaluate}
                      isLoading={registering === course.id}
                      isRegistered={userRegistrations.includes(course.id)}
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
              <h3 className="text-2xl font-bold text-center text-slate-800 mb-2">ยืนยันการยกเลิก</h3>
              <p className="text-center text-slate-500 mb-8">
                คุณต้องการยกเลิกการลงทะเบียนหลักสูตรนี้ใช่หรือไม่? ที่นั่งของคุณจะถูกคืนเข้าสู่ระบบ
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setCourseToCancel(null)}
                  className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors"
                  disabled={registering === courseToCancel}
                >
                  ย้อนกลับ
                </button>
                <button
                  onClick={() => handleConfirmCancel(courseToCancel)}
                  className="flex-1 py-3 px-4 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                  disabled={registering === courseToCancel}
                >
                  {registering === courseToCancel ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "ยืนยันการยกเลิก"
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
                {selectedCourseForSession.sessions.map((session) => (
                  <button
                    key={session.sessionId}
                    onClick={() => setSelectedSessionId(session.sessionId)}
                    className={cn(
                      "w-full p-5 rounded-2xl border-2 text-left transition-all flex items-center justify-between group",
                      selectedSessionId === session.sessionId 
                        ? "border-crimson bg-crimson/5 ring-4 ring-crimson/10" 
                        : "border-slate-100 hover:border-slate-200 bg-slate-50"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                        selectedSessionId === session.sessionId ? "bg-crimson text-white" : "bg-white text-slate-400"
                      )}>
                        <Clock className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-black text-slate-900">{session.sessionName}</div>
                        <div className="text-sm text-slate-500 font-medium flex items-center gap-3 mt-1">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {session.startTime} - {session.endTime}</span>
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {session.locationDetail}</span>
                        </div>
                      </div>
                    </div>
                    {selectedSessionId === session.sessionId && (
                      <CheckCircle2 className="w-6 h-6 text-crimson" />
                    )}
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  const session = selectedCourseForSession.sessions.find(s => s.sessionId === selectedSessionId);
                  handleFinalRegister(selectedCourseForSession, session);
                }}
                disabled={!selectedSessionId || registering === selectedCourseForSession.id}
                className="w-full bg-crimson hover:bg-crimson-dark text-white font-medium py-4 rounded-2xl shadow-xl shadow-crimson/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50 tracking-wide"
              >
                {registering === selectedCourseForSession.id ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>ยืนยันการลงทะเบียน</>
                )}
              </button>
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
