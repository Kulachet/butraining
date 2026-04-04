import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lock, ArrowRight } from "lucide-react";
import toast from "react-hot-toast";

export const PinGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pin, setPin] = useState("");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = localStorage.getItem("admin_session");
    if (session === "authorized") {
      setIsAuthorized(true);
    }
    setLoading(false);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === "ldo2569") {
      localStorage.setItem("admin_session", "authorized");
      setIsAuthorized(true);
      toast.success("ยินดีต้อนรับสู่ระบบผู้ดูแล");
    } else {
      toast.error("รหัส PIN ไม่ถูกต้อง");
      setPin("");
    }
  };

  if (loading) return null;

  if (isAuthorized) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-200"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 bg-crimson-light rounded-full flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-crimson" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Gateway</h1>
          <p className="text-slate-500 mt-2">กรุณากรอกรหัส PIN เพื่อเข้าสู่ระบบผู้ดูแล</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              className="w-full text-center text-3xl tracking-[1em] py-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-crimson focus:border-transparent outline-none transition-all"
              maxLength={7}
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="w-full bg-crimson hover:bg-crimson-dark text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            ยืนยันรหัส
            <ArrowRight className="w-5 h-5" />
          </button>
        </form>
      </motion.div>
    </div>
  );
};
