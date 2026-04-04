/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HashRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./components/AuthProvider";
import { Navbar } from "./components/Navbar";
import { LandingPage } from "./pages/LandingPage";
import { AdminPortal } from "./pages/AdminPortal";
import { CourseEditorPage } from "./pages/CourseEditorPage";
import { ProfilePage } from "./pages/ProfilePage";
import { CheckinPage } from "./pages/CheckinPage";
import { Toaster } from "react-hot-toast";

const AppContent = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-crimson border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-bold text-slate-500 tracking-widest uppercase">Loading Portal...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/admin" element={<AdminPortal />} />
          <Route path="/admin/course/new" element={<CourseEditorPage />} />
          <Route path="/admin/course/edit/:id" element={<CourseEditorPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/checkin/:courseId" element={<CheckinPage />} />
          {/* Add more routes as needed */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      
      <footer className="bg-white border-t border-slate-100 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] text-center">
            © 2026 BANGKOK UNIVERSITY - LEARNING DEVELOPMENT OFFICE
          </p>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Toaster position="top-right" />
        <AppContent />
      </Router>
    </AuthProvider>
  );
}
