import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Calendar, User, ArrowRight, Clock, Layers, Users, X } from "lucide-react";
import { Course } from "../types";
import { cn, formatInstructorName, formatDateThai } from "../lib/utils";

interface Props {
  course: Course;
  onRegister: (courseId: string) => void;
  onCancel?: (courseId: string) => void;
  isLoading?: boolean;
  isRegistered?: boolean;
}

export const CourseCard: React.FC<Props> = ({ course, onRegister, onCancel, isLoading, isRegistered }) => {
  const [showImageModal, setShowImageModal] = useState(false);

  const isCompleted = course.sessions?.every(session => {
    const sessionDate = new Date(session.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return sessionDate < today;
  }) || false;

  const sessionCount = course.sessions?.length || 0;
  
  // Calculate total seats and enrolled seats across all sessions (or use legacy fields)
  const maxSeats = course.sessions?.reduce((sum, s) => sum + (s.maxSeats || 0), 0) || course.maxSeats || 0;
  let enrolledSeats = course.sessions?.reduce((sum, s) => sum + (s.enrolledSeats || 0), 0) || course.enrolledSeats || 0;
  
  // Fallback to totalRegistrations if it's greater (handles cases where enrolledSeats was reset by a bug)
  if (course.totalRegistrations && course.totalRegistrations > enrolledSeats) {
    enrolledSeats = course.totalRegistrations;
  }
  
  const availableSeats = Math.max(0, maxSeats - enrolledSeats);
  const isFull = maxSeats > 0 && availableSeats === 0;

  return (
    <>
      <motion.div
        whileHover={{ y: -5 }}
        className={cn(
          "bg-white rounded-3xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-xl transition-all group flex flex-col",
          isCompleted && "opacity-75 grayscale-[0.5]"
        )}
      >
        <div 
          className="aspect-[3/4] bg-slate-100 relative overflow-hidden cursor-pointer"
          onClick={() => setShowImageModal(true)}
        >
          <img
            src={course.bannerImageBase64 || course.imageUrl || `https://picsum.photos/seed/${course.id}/600/800`}
            alt={course.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
          />
          <div className="absolute top-4 left-4 flex flex-col gap-2">
            {isCompleted ? (
              <span className="bg-slate-800 text-white text-[10px] font-medium uppercase tracking-widest px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Completed
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
                <Layers className="w-3 h-3 text-crimson" /> {sessionCount} Sessions
              </span>
            )}
          </div>
        </div>
        
        <div className="p-8 flex flex-col flex-1">
          {course.category && <div className="text-[10px] font-medium text-crimson uppercase tracking-widest mb-2">{course.category}</div>}
          <h3 className="text-xl font-medium text-slate-800 mb-4 line-clamp-2 min-h-[3.5rem] leading-tight tracking-wide">
            {course.title}
          </h3>
          
          <div className="space-y-3 mb-8 flex-1">
            <div className="flex items-center gap-3 text-slate-500 text-sm">
              <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                <User className="w-4 h-4 text-crimson" />
              </div>
              <span className="font-light tracking-wide">{formatInstructorName(course.instructorName)}</span>
            </div>
            <div className="flex items-center gap-3 text-crimson text-sm bg-crimson/5 p-2 rounded-xl">
              <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                <Calendar className="w-4 h-4 text-crimson" />
              </div>
              <span className="font-medium tracking-wide">วันที่อบรม: {formatDateThai(course.date)}</span>
            </div>
            {maxSeats > 0 && (
              <div className="flex items-center gap-3 text-slate-500 text-sm">
                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                  <Users className="w-4 h-4 text-crimson" />
                </div>
                <span className="font-light tracking-wide">
                  ที่นั่งว่าง: <span className={cn("font-medium", availableSeats <= 5 ? "text-orange-500" : "text-green-600")}>{availableSeats}</span> / {maxSeats}
                </span>
              </div>
            )}
          </div>
          
          <button
            onClick={() => isRegistered ? onCancel?.(course.id) : onRegister(course.id)}
            disabled={isLoading || isCompleted || (!isRegistered && isFull)}
            className={cn(
              "w-full font-medium py-4 rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 tracking-wide mt-auto",
              isCompleted 
                ? "bg-slate-100 text-slate-400 cursor-not-allowed" 
                : isRegistered
                  ? "bg-white text-red-500 border-2 border-red-100 hover:bg-red-50 hover:border-red-200 shadow-sm"
                  : isFull
                    ? "bg-orange-100 text-orange-600 border border-orange-200 cursor-not-allowed"
                    : "bg-crimson hover:bg-crimson-dark text-white shadow-lg shadow-crimson/10"
            )}
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                {isCompleted ? "ปิดรับสมัครแล้ว" : isRegistered ? "ยกเลิกการลงทะเบียน" : isFull ? "ที่นั่งเต็ม" : "ลงทะเบียนเข้าร่วม"}
                {!isCompleted && !isRegistered && !isFull && <ArrowRight className="w-4 h-4" />}
                {isRegistered && <X className="w-4 h-4" />}
              </>
            )}
          </button>
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
