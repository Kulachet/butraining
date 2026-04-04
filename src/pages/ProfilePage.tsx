import React from "react";
import { useAuth } from "../components/AuthProvider";
import { InstructorProfile } from "../components/InstructorProfile";
import { Navigate } from "react-router-dom";
import { Loader2, AlertCircle } from "lucide-react";

export const ProfilePage: React.FC = () => {
  const { user, instructor, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-10 h-10 text-crimson animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" />;
  }

  return (
    <div className="min-h-screen bg-slate-50 py-20 px-4">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-16">
          <h1 className="text-4xl font-medium text-slate-800 tracking-tight mb-4">โปรไฟล์ของฉัน</h1>
          <p className="text-slate-500 font-light tracking-wide">จัดการและตรวจสอบข้อมูลส่วนตัวของคุณ</p>
        </header>

        {instructor ? (
          <InstructorProfile instructor={instructor} />
        ) : (
          <div className="bg-white rounded-[2.5rem] p-12 shadow-xl border border-slate-100 text-center">
            <div className="w-20 h-20 bg-amber-50 rounded-3xl flex items-center justify-center text-amber-500 mx-auto mb-8">
              <AlertCircle className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-medium text-slate-800 mb-4">ไม่พบข้อมูลอาจารย์</h2>
            <p className="text-slate-500 font-light leading-relaxed max-w-md mx-auto mb-8">
              อีเมลของคุณ ({user.email}) ยังไม่ได้ถูกลงทะเบียนในฐานข้อมูลอาจารย์ <br />
              กรุณาลงทะเบียนข้อมูลเบื้องต้นเพื่อใช้งานระบบอย่างเต็มรูปแบบ
            </p>
            <button 
              onClick={() => window.location.href = "/"}
              className="bg-crimson text-white px-8 py-4 rounded-2xl font-medium shadow-lg shadow-crimson/10 hover:bg-crimson-dark transition-all"
            >
              กลับไปหน้าแรกเพื่อลงทะเบียน
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
