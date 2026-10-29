import React, { useEffect, useState, useMemo } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Instructor } from "../types";
import { formatInstructorName } from "../lib/utils";
import { 
  User, 
  Mail, 
  Building2, 
  CreditCard, 
  Loader2, 
  Search, 
  AlertCircle, 
  Plus, 
  Edit3, 
  UserCheck, 
  Sparkles,
  X,
  Users
} from "lucide-react";
import { InstructorModal } from "./InstructorModal";

export const InstructorList: React.FC = () => {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInstructor, setEditingInstructor] = useState<Instructor | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "instructors"), 
      orderBy("id", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((docSnap) => {
        const docData = docSnap.data();
        return {
          ...docData,
          firebaseId: docSnap.id,
          id: docData.id || docSnap.id, // Prefer the recorded ID from data, fallback to doc ID
        };
      }) as Instructor[];
      setInstructors(data);
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error("Error in instructors listener:", err);
      setError("ไม่สามารถโหลดรายชื่ออาจารย์ได้ (Permission Denied)");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Multi-field search: ID, Name, Email, and Department
  const filteredInstructors = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return instructors;

    return instructors.filter((inst) => 
      (inst.name && inst.name.toLowerCase().includes(term)) ||
      (inst.id && inst.id.toLowerCase().includes(term)) ||
      (inst.email && inst.email.toLowerCase().includes(term)) ||
      (inst.department && inst.department.toLowerCase().includes(term)) ||
      (inst.position && inst.position.toLowerCase().includes(term))
    );
  }, [instructors, searchTerm]);

  const handleOpenAddModal = () => {
    setEditingInstructor(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (inst: Instructor) => {
    setEditingInstructor(inst);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingInstructor(null);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl border border-slate-100 p-20 flex flex-col items-center justify-center shadow-sm">
        <Loader2 className="w-10 h-10 text-crimson animate-spin mb-4" />
        <p className="text-slate-400 font-light tracking-wide">กำลังโหลดรายชื่ออาจารย์...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-3xl border border-red-100 p-20 text-center shadow-sm">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-red-500 font-medium">{error}</p>
        <p className="text-slate-400 text-sm mt-2">กรุณาตรวจสอบว่าคุณเข้าสู่ระบบด้วยสิทธิ์ผู้ดูแลระบบ</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-full">
      {/* Header with Search and Add Instructor Button */}
      <div className="p-6 sm:p-8 border-b border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-[20px] lg:text-[24px] font-semibold text-[#333333] tracking-[0.02em] leading-[1.6]">
              รายชื่ออาจารย์ทั้งหมด
            </h3>
            <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full">
              {instructors.length} ท่าน
            </span>
          </div>
          <p className="text-[13px] text-slate-400 mt-0.5">
            จัดการฐานข้อมูลกลาง ตรวจสอบสิทธิ์ และอัปเดตข้อมูลอาจารย์
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="ค้นหารหัส, ชื่อ, อีเมล หรือคณะ..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-200/80 rounded-2xl text-[14px] text-[#4A4A4A] font-medium placeholder:text-slate-400 focus:bg-white focus:border-crimson focus:ring-2 focus:ring-crimson/10 outline-none transition-all"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Add Instructor Button */}
          <button
            onClick={handleOpenAddModal}
            className="flex items-center justify-center gap-2 bg-crimson hover:bg-crimson-dark text-white px-5 py-2.5 rounded-2xl font-semibold text-[14px] shadow-lg shadow-crimson/15 transition-all flex-shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            เพิ่มอาจารย์
          </button>
        </div>
      </div>

      {/* Instructors Table */}
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/70 border-b border-slate-100">
              <th className="px-6 py-4 text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
                รหัสอาจารย์
              </th>
              <th className="px-6 py-4 text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
                ชื่อ-นามสกุล / ตำแหน่ง
              </th>
              <th className="px-6 py-4 text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
                อีเมล
              </th>
              <th className="px-6 py-4 text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
                หน่วยงาน / คณะ
              </th>
              <th className="px-6 py-4 text-[12px] font-semibold text-slate-500 uppercase tracking-wider text-right">
                การจัดการ
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredInstructors.length > 0 ? (
              filteredInstructors.map((inst) => {
                const isLinked = Boolean(inst.uid);
                return (
                  <tr key={inst.id} className="hover:bg-slate-50/60 transition-colors group">
                    {/* ID */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-mono text-[14px] font-bold text-slate-800 tracking-wide">
                          {inst.id}
                        </span>
                        {inst.isManual && (
                          <span className="text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200/60 px-1.5 py-0.5 rounded-md" title="สร้าง/แก้ไขด้วยตนเอง">
                            ปรับปรุงเอง
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Name & Academic Position */}
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0 mt-0.5 font-semibold text-xs">
                          {inst.name ? inst.name.charAt(0) : "อ"}
                        </div>
                        <div>
                          <div className="text-[14px] lg:text-[15px] font-semibold text-[#333333] leading-snug">
                            {formatInstructorName(inst.name, inst.id, inst.position)}
                          </div>
                          {inst.position && (
                            <div className="text-[12px] text-crimson font-medium mt-0.5">
                              {inst.position}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Email & Google Link Status */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="text-[14px] text-slate-600 font-medium">{inst.email}</span>
                      </div>
                      {isLinked ? (
                        <div className="flex items-center gap-1 text-[11px] text-green-600 font-medium mt-1">
                          <UserCheck className="w-3 h-3" />
                          <span>เชื่อมต่อ Google แล้ว</span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 font-normal mt-1">
                          ยังไม่เข้าสู่ระบบ
                        </div>
                      )}
                    </td>

                    {/* Department */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="text-[13px] lg:text-[14px] text-slate-600 font-normal line-clamp-2">
                          {inst.department || "ไม่ระบุ"}
                        </span>
                      </div>
                    </td>

                    {/* Action: Edit */}
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleOpenEditModal(inst)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-slate-600 hover:text-crimson hover:bg-crimson/5 border border-slate-200 hover:border-crimson/20 text-xs font-semibold transition-all shadow-sm"
                        title={`แก้ไขข้อมูล ${inst.name}`}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        แก้ไข
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="px-6 py-16 text-center">
                  <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                    <Users className="w-10 h-10 text-slate-300 mb-3" />
                    <p className="text-[15px] font-semibold text-slate-600">ไม่พบข้อมูลอาจารย์</p>
                    <p className="text-[13px] text-slate-400 mt-1">
                      {searchTerm 
                        ? `ไม่พบข้อมูลที่ตรงกับ "${searchTerm}" กรุณาลองค้นหาด้วยคำอื่น` 
                        : "ยังไม่มีข้อมูลอาจารย์ในระบบ คลิกปุ่มด้านบนเพื่อเพิ่มอาจารย์คนแรก"}
                    </p>
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm("")}
                        className="mt-4 text-xs font-semibold text-crimson hover:underline"
                      >
                        ล้างคำค้นหา
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="p-4 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
        <span>
          แสดง {filteredInstructors.length} จากทั้งหมด {instructors.length} รายการ
        </span>
        <span className="hidden sm:inline">
          ระบบซิงค์ข้อมูลแบบ Real-time พร้อมการป้องกันการทับซ้อน
        </span>
      </div>

      {/* Instructor Modal for Add and Edit */}
      <InstructorModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={handleCloseModal}
        instructorToEdit={editingInstructor}
        allInstructors={instructors}
      />
    </div>
  );
};
