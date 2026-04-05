import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { LogOut, User, Settings, ShieldCheck } from "lucide-react";
import { cn, formatInstructorName } from "../lib/utils";

export const Navbar: React.FC = () => {
  const { user, instructor, login, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="sticky top-0 z-40 w-full bg-white/80 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20 items-center">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-12 h-12 bg-crimson rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform shadow-lg shadow-crimson/20">
              <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3L1 9L12 15L21 10.09V17H23V9M5 13.18V17.18L12 21L19 17.18V13.18L12 17L5 13.18Z" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-medium text-slate-800 leading-none tracking-wide">BU Academic Training</span>
              <span className="text-[10px] font-light text-slate-400 tracking-widest uppercase mt-1">LEARNING DEVELOPMENT OFFICE</span>
            </div>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            {isAdmin && (
              <Link to="/admin" className="flex items-center gap-1.5 text-sm font-medium text-crimson hover:text-crimson-dark transition-colors tracking-wide">
                <ShieldCheck className="w-4 h-4" />
                Admin Portal
              </Link>
            )}
          </div>

          <div className="flex items-center gap-4">
            {!user && (
              <div className="hidden sm:flex items-center justify-center w-10 h-10 rounded-full border border-slate-100 text-slate-300">
                <ShieldCheck className="w-5 h-5" />
              </div>
            )}
            {user ? (
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-end hidden sm:flex">
                    <span className="text-sm font-medium text-slate-800 tracking-wide">{instructor ? formatInstructorName(instructor.name) : user.displayName}</span>
                    <span className="text-[10px] font-light text-slate-500 tracking-widest">{instructor?.position || "Instructor"}</span>
                  </div>
                  <Link to="/profile" className="w-10 h-10 rounded-full border border-slate-100 p-0.5 overflow-hidden hover:border-crimson transition-all">
                    <img src={user.photoURL || ""} alt="avatar" className="w-full h-full rounded-full object-cover" />
                  </Link>
                </div>
                
                <button 
                  onClick={logout}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-all border border-transparent hover:border-red-100"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">ออกจากระบบ</span>
                </button>
              </div>
            ) : (
              <button 
                onClick={async () => {
                  await login();
                  navigate("/");
                }}
                className="bg-crimson hover:bg-crimson-dark text-white text-sm font-medium px-6 py-2.5 rounded-xl shadow-lg shadow-crimson/10 transition-all flex items-center gap-2 tracking-wide"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                เข้าสู่ระบบ
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
