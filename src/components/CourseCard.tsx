import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Calendar, User, ArrowRight, Clock, Layers, Users, X, MapPin } from "lucide-react";
import { Course } from "../types";
import { cn, formatInstructorName, formatDateThai } from "../lib/utils";

interface Props {
  course: Course;
  onRegister: (courseId: string) => void;
  onCancel?: (courseId: string) => void;
  onEvaluate?: (courseId: string) => void;
  isLoading?: boolean;
  isRegistered?: boolean;
}

export const CourseCard: React.FC<Props> = ({ course, onRegister, onCancel, onEvaluate, isLoading, isRegistered }) => {
  const [showImageModal, setShowImageModal] = useState(false);

  const isCompleted = course.sessions?.every(session => {
    const sessionDate = new Date(session.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return sessionDate < today;
  }) || false;

  const sessionCount = course.sessions?.length || 0;
  
  const hasSessions = course.sessions && course.sessions.length > 0;
  const maxSeats = hasSessions 
    ? course.sessions!.reduce((sum, s) => sum + (s.maxSeats || 0), 0) 
    : (course.maxSeats || 0);
    
  const enrolledSeats = hasSessions 
    ? course.sessions!.reduce((sum, s) => sum + (s.enrolledSeats || 0), 0) 
    : (course.enrolledSeats || 0);
  
  const availableSeats = Math.max(0, maxSeats - enrolledSeats);
  const isFull = maxSeats > 0 && availableSeats === 0;

  const startTime = course.sessions?.[0]?.startTime || (course as any).startTime || "";
  const endTime = course.sessions?.[0]?.endTime || (course as any).endTime || "";
  const locationDetail = course.sessions?.[0]?.locationDetail || (course as any).locationDetail || "ไม่ระบุ";
  const timeString = startTime && endTime ? `${startTime} - ${endTime} น.` : startTime ? `${startTime} น.` : "";

  return (
    <>
      <motion.div
        whileHover={{ y: -5 }}
        className={cn(
          "bg-white rounded-3xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-xl transition-all group flex flex-col md:flex-row p-4 md:p-6 gap-6",
          isCompleted && "opacity-75 grayscale-[0.5]"
        )}
      >
        <div 
          className="w-full md:w-[260px] shrink-0 aspect-[3/4] relative overflow-hidden cursor-pointer bg-slate-50 rounded-2xl shadow-sm border border-slate-100"
          onClick={() => setShowImageModal(true)}
        >
          <img
            src={course.bannerImageBase64 || course.imageUrl || `https://picsum.photos/seed/${course.id}/600/800`}
            alt={course.title}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
          />
          <div className="absolute top-3 left-3 flex flex-col gap-2">
            {isCompleted ? (
              <span className="bg-slate-800 text-white text-[10px] font-medium uppercase tracking-widest px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5">
                <Clock className="w-3 h-3" strokeWidth={1.5} /> Completed
              </span>
            ) : isFull ? (
              <span className="bg-orange-500 text-white text-[10px] font-medium uppercase tracking-widest px-3 py-1.5 rounded-full shadow-lg">
                ที่นั่งเต็มแล้ว
              </span>
            ) : (
              <span className="bg-crimson text-white text-[10px] font-medium uppercase tracking-widest px-3 py-1.5 rounded-full shadow-lg">
                Open for Registration
              </span>
            )}
            {sessionCount > 1 && (
              <span className="bg-white/90 backdrop-blur-md text-slate-800 text-[10px] font-medium uppercase tracking-widest px-3 py-1.5 rounded-full shadow-sm flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-crimson" strokeWidth={1.5} /> {sessionCount} Sessions
              </span>
            )}
          </div>
        </div>
        
        <div className="flex flex-col flex-1 py-2">
          {course.category && <div className="text-[10px] font-medium text-crimson uppercase tracking-widest mb-2">{course.category}</div>}
          <h3 className="text-xl font-medium text-slate-800 mb-2 line-clamp-2 leading-tight tracking-wide">
            {course.title}
          </h3>
          
          <p className="text-sm font-light text-slate-500 mb-6 whitespace-pre-wrap leading-relaxed">
            {course.description || "ไม่มีรายละเอียดเพิ่มเติม"}
          </p>
          
          <div className="space-y-3 mb-6 flex-1">
            <div className="flex items-center gap-3 text-slate-500 text-sm">
              <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                <User className="w-4 h-4 text-crimson" strokeWidth={1.5} />
              </div>
              <span className="font-light tracking-wide">{formatInstructorName(course.instructorName)}</span>
            </div>
            <div className="flex flex-col gap-2 bg-crimson/5 p-3 rounded-xl">
              <div className="flex items-center gap-3 text-crimson text-sm">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm shrink-0">
                  <Calendar className="w-4 h-4 text-crimson" strokeWidth={1.5} />
                </div>
                <div className="flex flex-col">
                  <span className="font-medium tracking-wide">วันที่อบรม: {formatDateThai(course.date)}</span>
                  {timeString && <span className="text-xs font-medium opacity-80">เวลา: {timeString}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 text-crimson text-sm">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm shrink-0">
                  <MapPin className="w-4 h-4 text-crimson" strokeWidth={1.5} />
                </div>
                <span className="font-medium tracking-wide text-xs">ห้อง: {locationDetail}</span>
              </div>
            </div>
            {maxSeats > 0 && (
              <div className="flex items-center gap-3 text-slate-500 text-sm">
                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                  <Users className="w-4 h-4 text-crimson" strokeWidth={1.5} />
                </div>
                <span className="font-light tracking-wide">
                  ที่นั่งว่าง: <span className={cn("font-medium", availableSeats <= 5 ? "text-orange-500" : "text-green-600")}>{availableSeats}</span> / {maxSeats}
                </span>
              </div>
            )}
          </div>
          
          <div className="mt-auto flex justify-end">
            {(isCompleted && isRegistered) ? (
              <button
                onClick={() => onEvaluate?.(course.id)}
                className="w-full md:w-auto px-8 font-medium py-2.5 text-sm rounded-lg transition-all flex items-center justify-center gap-2 tracking-wide bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20"
              >
                ทำแบบประเมินผล
                <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </button>
            ) : (
              <button
                onClick={() => isRegistered ? onCancel?.(course.id) : onRegister(course.id)}
                disabled={isLoading || isCompleted || (!isRegistered && isFull)}
                className={cn(
                  "w-full md:w-auto px-8 font-medium py-2.5 text-sm rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 tracking-wide",
                  isCompleted 
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed" 
                    : isRegistered
                      ? "bg-white text-red-500 border border-red-200 hover:bg-red-50 shadow-sm"
                      : isFull
                        ? "bg-orange-100 text-orange-600 border border-orange-200 cursor-not-allowed"
                        : "bg-crimson hover:bg-crimson-dark text-white shadow-md shadow-crimson/10"
                )}
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    {isCompleted ? "ปิดรับสมัครแล้ว" : isRegistered ? "ยกเลิกการลงทะเบียน" : isFull ? "ที่นั่งเต็ม" : "ลงทะเบียนเข้าร่วม"}
                    {!isCompleted && !isRegistered && !isFull && <ArrowRight className="w-4 h-4" strokeWidth={1.5} />}
                    {isRegistered && !isCompleted && <X className="w-4 h-4" strokeWidth={1.5} />}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Image Modal */}
      <AnimatePresence>
        {showImageModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
            onClick={() => setShowImageModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative max-w-4xl max-h-[90vh] w-full flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowImageModal(false)}
                className="absolute -top-12 right-0 p-2 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              <img
                src={course.bannerImageBase64 || course.imageUrl || `https://picsum.photos/seed/${course.id}/600/800`}
                alt={course.title}
                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                referrerPolicy="no-referrer"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
