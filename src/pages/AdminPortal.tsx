import React, { useState, useEffect } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Course } from "../types";
import { PinGate } from "../components/PinGate";
import { ApplicantList } from "../components/ApplicantList";
import { AnalyticsDashboard } from "../components/AnalyticsDashboard";
import { ManageCourses } from "../components/ManageCourses";
import { CSVUploader } from "../components/CSVUploader";
import { InstructorList } from "../components/InstructorList";
import { RegistrantsList } from "../components/RegistrantsList";
import { 
  Plus, 
  LayoutDashboard, 
  Users, 
  BookOpen, 
  Settings, 
  LogOut, 
  ChevronRight, 
  Edit3, 
  Users2,
  Calendar,
  MapPin,
  ShieldCheck,
  Search,
  Filter,
  FileText,
  BarChart3,
  UserCheck
} from "lucide-react";
import toast from "react-hot-toast";

import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";

export const AdminPortal: React.FC = () => {
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState(() => {
    return sessionStorage.getItem("adminActiveTab") || "dashboard";
  });

  useEffect(() => {
    sessionStorage.setItem("adminActiveTab", activeTab);
  }, [activeTab]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [viewingApplicants, setViewingApplicants] = useState<Course | null>(null);

  useEffect(() => {
    const q = query(collection(db, "courses"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCourses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Course[]);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("admin_session");
    window.location.reload();
  };

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-12 h-12 border-4 border-crimson border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">Access Denied</h1>
          <p className="text-slate-500 mt-2">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p>
          <button onClick={() => navigate("/")} className="mt-4 text-crimson font-medium hover:underline">กลับไปหน้าหลัก</button>
        </div>
      </div>
    );
  }

  return (
    <PinGate>
      <div className="min-h-screen bg-slate-50 flex">
        {/* Sidebar */}
        <aside className="w-72 bg-white border-r border-slate-200 flex flex-col sticky top-0 h-screen">
          <div className="p-8 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg shadow-slate-200">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-black text-slate-900 leading-none tracking-tight">Admin Portal</span>
                <span className="text-[10px] font-bold text-slate-400 tracking-widest uppercase mt-1">LDO Management</span>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-2">
            <button 
              onClick={() => { setActiveTab("dashboard"); setViewingApplicants(null); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-[15px] transition-all tracking-wide ${activeTab === "dashboard" ? "bg-slate-50 text-[#333333]" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}
            >
              <LayoutDashboard className="w-5 h-5" />
              แดชบอร์ด
            </button>
            <button 
              onClick={() => { setActiveTab("courses"); setViewingApplicants(null); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-[15px] transition-all tracking-wide ${activeTab === "courses" ? "bg-slate-50 text-[#333333]" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}
            >
              <BookOpen className="w-5 h-5" />
              จัดการหลักสูตร
            </button>
            <button 
              onClick={() => { setActiveTab("instructors"); setViewingApplicants(null); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-[15px] transition-all tracking-wide ${activeTab === "instructors" ? "bg-slate-50 text-[#333333]" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}
            >
              <Users className="w-5 h-5" />
              ข้อมูลอาจารย์
            </button>
            <button 
              onClick={() => { setActiveTab("registrants"); setViewingApplicants(null); }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-[15px] transition-all tracking-wide ${activeTab === "registrants" ? "bg-slate-900 text-white shadow-xl shadow-slate-200" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}
            >
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5" />
                รายชื่อผู้สมัคร
              </div>
              {activeTab === "registrants" && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
            </button>
            <button 
              onClick={() => { setActiveTab("evaluations"); setViewingApplicants(null); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-[15px] transition-all tracking-wide ${activeTab === "evaluations" ? "bg-slate-50 text-[#333333]" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}
            >
              <BarChart3 className="w-5 h-5" />
              ผลการประเมิน
            </button>
          </nav>

          <div className="p-4 border-t border-slate-100">
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-[15px] text-red-400 hover:bg-red-50 transition-all tracking-wide"
            >
              <LogOut className="w-5 h-5" />
              ออกจากระบบ
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-12">
          {viewingApplicants ? (
            <div className="space-y-8">
              <button 
                onClick={() => setViewingApplicants(null)}
                className="flex items-center gap-2 text-[14px] font-semibold text-slate-400 hover:text-crimson transition-colors"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
                กลับไปที่รายการหลักสูตร
              </button>
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-8">
                {(viewingApplicants.bannerImageBase64 || viewingApplicants.imageUrl) && (
                  <div className="w-32 h-32 rounded-2xl overflow-hidden bg-slate-100 border border-slate-100 flex-shrink-0">
                    <img 
                      src={viewingApplicants.bannerImageBase64 || viewingApplicants.imageUrl} 
                      alt={viewingApplicants.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                )}
                <div className="flex-1 flex items-center justify-between">
                  <div>
                    <h1 className="text-[28px] lg:text-[32px] font-bold text-[#333333] tracking-[0.02em] leading-[1.6]">{viewingApplicants.title}</h1>
                    <div className="flex items-center gap-4 mt-4 text-[#4A4A4A] font-normal text-[14px] lg:text-[16px] tracking-wide leading-[1.7]">
                      <span className="flex items-center gap-2 bg-crimson/5 text-crimson px-3 py-1.5 rounded-lg font-medium">
                        <Calendar className="w-4 h-4" /> วันที่อบรม: {viewingApplicants.date}
                      </span>
                      <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {viewingApplicants.locationDetail || viewingApplicants.locationType}</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => navigate(`/admin/course/edit/${viewingApplicants.id}`)}
                    className="p-3 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl transition-all"
                  >
                    <Edit3 className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <ApplicantList course={viewingApplicants} />
            </div>
          ) : (
            <>
              {activeTab === "dashboard" && (
                <>
                  <header className="mb-12">
                    <h1 className="text-[28px] lg:text-[32px] font-bold text-[#333333] tracking-[0.02em] leading-[1.6]">Dashboard Overview</h1>
                    <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px] mt-1 tracking-wide leading-[1.7]">ยินดีต้อนรับกลับมา, ผู้ดูแลระบบ</p>
                  </header>
                  <AnalyticsDashboard />
                </>
              )}

              {activeTab === "courses" && (
                <ManageCourses 
                  onCreateCourse={() => navigate("/admin/course/new")}
                  onEditCourse={(course) => navigate(`/admin/course/edit/${course.id}`)}
                  onViewApplicants={(course) => setViewingApplicants(course)}
                />
              )}

              {activeTab === "instructors" && (
                <div className="space-y-8">
                  <header className="mb-12">
                    <h1 className="text-[28px] lg:text-[32px] font-bold text-[#333333] tracking-[0.02em] leading-[1.6]">จัดการข้อมูลอาจารย์</h1>
                    <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px] mt-1 tracking-wide leading-[1.7]">ซิงค์ข้อมูลจาก CSV และตรวจสอบรายชื่ออาจารย์ในระบบ</p>
                  </header>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1">
                      <CSVUploader />
                    </div>
                    
                    <div className="lg:col-span-2">
                      <InstructorList />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "registrants" && (
                <RegistrantsList />
              )}

              {activeTab === "evaluations" && (
                <>
                  <header className="mb-12">
                    <h1 className="text-[28px] lg:text-[32px] font-bold text-[#333333] tracking-[0.02em] leading-[1.6]">ผลการประเมิน</h1>
                    <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px] mt-1 leading-[1.7]">สรุปผลการประเมินความพึงพอใจรายหลักสูตร</p>
                  </header>
                  <div className="bg-white rounded-[3rem] border border-slate-200 shadow-sm overflow-hidden p-20 text-center">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                      <BarChart3 className="w-10 h-10 text-slate-200" />
                    </div>
                    <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px] leading-[1.7]">ฟีเจอร์ผลการประเมินกำลังอยู่ในการพัฒนา</p>
                  </div>
                </>
              )}

              {activeTab === "settings" && (
                <>
                  <header className="mb-12">
                    <h1 className="text-[28px] lg:text-[32px] font-bold text-[#333333] tracking-[0.02em] leading-[1.6]">ตั้งค่าระบบ</h1>
                    <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px] mt-1 leading-[1.7]">ปรับแต่งการทำงานของพอร์ทัล</p>
                  </header>
                  <div className="bg-white rounded-[3rem] border border-slate-200 shadow-sm overflow-hidden p-20 text-center">
                    <p className="text-[#4A4A4A] font-normal text-[14px] lg:text-[16px] leading-[1.7]">ฟีเจอร์ตั้งค่าระบบกำลังอยู่ในการพัฒนา</p>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </PinGate>
  );
};
