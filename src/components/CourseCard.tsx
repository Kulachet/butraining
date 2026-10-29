import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Calendar, User, ArrowRight, Clock, Layers, Users, X, MapPin } from "lucide-react";
import { Course } from "../types";
import { cn, formatInstructorName, formatDateThai, formatDateLocalized, formatSessionTime, getCourseSessions, parseDateParts } from "../lib/utils";
import { useLanguage } from "../contexts/LanguageContext";

interface Props {
  course: Course;
  onRegister: (courseId: string) => void;
  onCancel?: (courseId: string) => void;
  onEvaluate?: (courseId: string) => void;
  isLoading?: boolean;
  isRegistered?: boolean;
}

export const CourseCard: React.FC<Props> = ({ course, onRegister, onCancel, onEvaluate, isLoading, isRegistered }) => {
  const { lang, t } = useLanguage();
  const [showImageModal, setShowImageModal] = useState(false);

  const sessions = getCourseSessions(course);
  const isMulti = sessions.length > 1;
  const sessionCount = sessions.length;

  const isCompleted = sessions.every(session => {
    if (!session.date) return false;
    const parts = parseDateParts(session.date);
    if (!parts) return false;
    const sessionDate = new Date(parts.year, parts.month - 1, parts.day, 23, 59, 59);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return sessionDate < today;
  }) || false;
  
  const maxSeats = course.maxSeats || (sessions.length > 0 ? (sessions[0].maxSeats || 40) : 40);
  const enrolledSeats = course.enrolledSeats || course.totalRegistrations || 0;
  
  const availableSeats = Math.max(0, maxSeats - enrolledSeats);
  const isFull = maxSeats > 0 && availableSeats === 0;

  const startTime = sessions[0]?.startTime || course.startTime || "";
  const endTime = sessions[0]?.endTime || course.endTime || "";
  const locationDetail = sessions[0]?.locationDetail || course.locationDetail || "ไม่ระบุ";
  const timeString = formatSessionTime(startTime, endTime, lang);

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
            ) : isMulti ? (
              <span className="bg-amber-600 text-white text-[10px] font-medium uppercase tracking-widest px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5">
                <Calendar className="w-3 h-3" /> {lang === 'en' ? `${sessionCount} Days` : `อบรม ${sessionCount} วัน`}
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
              <span className="font-light tracking-wide">{formatInstructorName(course.instructorName, course.instructorId)}</span>
            </div>

            {/* Schedule Display: Single-Day vs Multi-Day */}
            {!isMulti ? (
              <div className="flex flex-col gap-2 bg-crimson/5 p-3 rounded-xl">
                <div className="flex items-center gap-3 text-crimson text-sm">
                  <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm shrink-0">
                    <Calendar className="w-4 h-4 text-crimson" strokeWidth={1.5} />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium tracking-wide">
                      {t("trainingDate")} {formatDateLocalized(sessions[0]?.date || course.date, lang)}
                    </span>
                    {timeString && <span className="text-xs font-medium opacity-80">{t("trainingTime")} {timeString}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-crimson text-sm">
                  <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm shrink-0">
                    <MapPin className="w-4 h-4 text-crimson" strokeWidth={1.5} />
                  </div>
                  <span className="font-medium tracking-wide text-xs">{t("room")} {locationDetail}</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 bg-crimson/5 p-4 rounded-2xl border border-crimson/10">
                <div className="flex items-center justify-between text-crimson text-xs font-bold border-b border-crimson/10 pb-2">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-crimson" />
                    {t("scheduleTitle")} ({sessionCount} {lang === 'en' ? "Days" : "วัน"})
                  </span>
                  <span className="text-[10px] font-normal text-slate-500">
                    {lang === 'en' ? "Specific Dates" : "กำหนดการแต่ละวัน"}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {sessions.map((session, idx) => (
                    <div 
                      key={session.id} 
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-slate-700 bg-white/90 px-3 py-2 rounded-xl border border-slate-100 shadow-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-crimson text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <span className="font-medium text-slate-800">
                          {lang === 'en' ? `Day ${idx + 1}:` : `วันที่ ${idx + 1}:`} {formatDateLocalized(session.date, lang)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-500 font-light text-[11px] pl-7 sm:pl-0">
                        <Clock className="w-3 h-3 text-crimson" />
                        <span>{formatSessionTime(session.startTime, session.endTime, lang)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 text-crimson text-xs pt-1.5 border-t border-crimson/10">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium text-xs">{t("room")} {locationDetail}</span>
                </div>
              </div>
            )}

            {maxSeats > 0 && (
              <div className="flex items-center gap-3 text-slate-500 text-sm">
                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                  <Users className="w-4 h-4 text-crimson" strokeWidth={1.5} />
                </div>
                <span className="font-light tracking-wide">
                  {lang === 'en' ? "Available Seats:" : "ที่นั่งว่าง:"} <span className={cn("font-medium", availableSeats <= 5 ? "text-orange-500" : "text-green-600")}>{availableSeats}</span> / {maxSeats}
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
                {lang === 'en' ? "Take Evaluation" : "ทำแบบประเมินผล"}
                <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </button>
            ) : isRegistered ? (
              <button
                onClick={() => onCancel?.(course.id)}
                disabled={isLoading || isCompleted}
                className="w-full md:w-auto px-8 font-medium py-2.5 text-sm rounded-lg transition-all flex items-center justify-center gap-2 bg-white text-red-500 border border-red-200 hover:bg-red-50 shadow-sm"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>{lang === 'en' ? "Cancel Registration" : (t("cancelRegistration") || "ยกเลิกการลงทะเบียน")}</span>
                    <X className="w-4 h-4" strokeWidth={1.5} />
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() => {
                  isRegistered ? onCancel?.(course.id) : onRegister(course.id);
                }}
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
                    {isCompleted 
                      ? (lang === 'en' ? "Registration Closed" : "ปิดรับสมัครแล้ว")
                      : isRegistered 
                        ? (lang === 'en' ? "Cancel Registration" : "ยกเลิกการลงทะเบียน") 
                        : isFull 
                          ? (lang === 'en' ? "Full" : "ที่นั่งเต็ม") 
                          : (lang === 'en' ? "Register" : "ลงทะเบียนเข้าร่วม")
                    }
                    {!isCompleted && !isRegistered && !isFull && <ArrowRight className="w-4 h-4" strokeWidth={1.5} />}
                    {isRegistered && !isCompleted && (
                      <X className="w-4 h-4" strokeWidth={1.5} />
                    )}
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
