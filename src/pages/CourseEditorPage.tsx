import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  ArrowLeft, 
  Save, 
  X, 
  Upload, 
  Calendar, 
  Clock, 
  Users, 
  MapPin, 
  Globe, 
  Trash2, 
  ChevronDown,
  Info,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Image as ImageIcon,
  Check
} from "lucide-react";
import { useForm, Controller, useFieldArray, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Course, Instructor, Session } from "../types";
import { db, auth } from "../lib/firebase";
import { 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  setDoc, 
  addDoc, 
  deleteDoc,
  serverTimestamp,
  writeBatch
} from "firebase/firestore";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { cn } from "../lib/utils";

// Custom Checkbox Component
const Checkbox = ({ checked, onChange, label }: { checked: boolean; onChange: (val: boolean) => void; label: string }) => (
  <label className="flex items-center gap-3 cursor-pointer group">
    <div 
      onClick={() => onChange(!checked)}
      className={cn(
        "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
        checked ? "bg-crimson border-crimson shadow-lg shadow-crimson/20" : "bg-white border-slate-200 group-hover:border-slate-300"
      )}
    >
      {checked && <Check className="w-4 h-4 text-white" />}
    </div>
    <span className="text-sm font-bold text-slate-700">{label}</span>
  </label>
);

const schema = z.object({
  title: z.string().min(5, "ชื่อหลักสูตรต้องมีอย่างน้อย 5 ตัวอักษร"),
  academicYear: z.string().min(1, "กรุณาระบุปีการศึกษา"),
  instructorName: z.string().min(1, "กรุณาระบุชื่อวิทยากร"),
  description: z.string().min(10, "กรุณากรอกรายละเอียดหลักสูตร"),
  date: z.string().min(1, "กรุณาระบุวันที่"),
  startTime: z.string().min(1, "กรุณาระบุเวลาเริ่ม"),
  endTime: z.string().min(1, "กรุณาระบุเวลาสิ้นสุด"),
  locationDetail: z.string().min(1, "กรุณาระบุสถานที่"),
  maxSeats: z.number().min(1, "จำนวนที่รับต้องมากกว่า 0"),
  status: z.enum(["Active", "Inactive"]),
  isVisible: z.boolean(),
  imageUrl: z.string().optional(),
  bannerImageBase64: z.string().optional(),
  driveFolderId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export const CourseEditorPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;
  
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const fetchInstructors = async () => {
      try {
        const snap = await getDocs(collection(db, "instructors"));
        const instList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Instructor));
        setInstructors(instList);
      } catch (error) {
        console.error("Error fetching instructors:", error);
      }
    };
    fetchInstructors();
  }, []);

  const { register, handleSubmit, control, watch, setValue, formState: { errors, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      status: "Active",
      isVisible: true,
      academicYear: "2568",
      date: new Date().toISOString().split('T')[0],
      startTime: "09:00",
      endTime: "12:00",
      maxSeats: 40,
      locationDetail: "",
    }
  });

  const watchImageUrl = watch("imageUrl");
  const watchBannerImageBase64 = watch("bannerImageBase64");
  const watchIsVisible = watch("isVisible");

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (isEdit) {
          const courseSnap = await getDoc(doc(db, "courses", id));
          if (courseSnap.exists()) {
            const data = courseSnap.data();
            // Map legacy sessions to flat fields if necessary
            if (data.sessions && data.sessions.length > 0) {
              const firstSession = data.sessions[0];
              setValue("date", firstSession.date);
              setValue("startTime", firstSession.startTime);
              setValue("endTime", firstSession.endTime);
              setValue("locationDetail", firstSession.locationDetail);
              setValue("maxSeats", firstSession.maxSeats);
            }
            Object.keys(data).forEach((key) => {
              if (key !== "sessions") {
                setValue(key as any, data[key]);
              }
            });
          } else {
            toast.error("ไม่พบข้อมูลหลักสูตร");
            navigate("/admin");
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, isEdit, setValue, navigate]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check authentication
    if (!auth.currentUser) {
      toast.error("กรุณาเข้าสู่ระบบก่อนอัปโหลดรูปภาพ");
      return;
    }

    setUploadProgress(10);
    toast.loading("กำลังประมวลผลรูปภาพ...", { id: "upload-toast" });

    try {
      // 1. Compress Image using Canvas
      const compressImage = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX_WIDTH = 1024;
              const MAX_HEIGHT = 1024;
              let width = img.width;
              let height = img.height;

              if (width > height) {
                if (width > MAX_WIDTH) {
                  height *= MAX_WIDTH / width;
                  width = MAX_WIDTH;
                }
              } else {
                if (height > MAX_HEIGHT) {
                  width *= MAX_HEIGHT / height;
                  height = MAX_HEIGHT;
                }
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx?.drawImage(img, 0, 0, width, height);
              
              // Convert to Base64 with 0.7 quality to keep it small
              const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
              resolve(dataUrl);
            };
            img.onerror = reject;
          };
          reader.onerror = reject;
        });
      };

      setUploadProgress(40);
      const base64Image = await compressImage(file);
      
      setUploadProgress(80);
      // Directly set the base64 string to the form
      setValue("bannerImageBase64", base64Image, { shouldDirty: true });
      
      toast.success("ประมวลผลรูปภาพสำเร็จ", { id: "upload-toast" });
      setUploadProgress(100);
      
      setTimeout(() => setUploadProgress(null), 1000);
    } catch (error: any) {
      console.error("Image processing error:", error);
      toast.error("เกิดข้อผิดพลาดในการประมวลผลรูปภาพ", { id: "upload-toast" });
      setUploadProgress(null);
    }
  };

  const onSubmit = async (data: FormData) => {
    setSaving(true);
    try {
      let existingEnrolledSeats = 0;
      let existingSessionId = crypto.randomUUID();
      
      if (isEdit) {
        const courseSnap = await getDoc(doc(db, "courses", id));
        if (courseSnap.exists()) {
          const existingData = courseSnap.data();
          if (existingData.sessions && existingData.sessions.length > 0) {
            existingEnrolledSeats = existingData.sessions[0].enrolledSeats || 0;
            existingSessionId = existingData.sessions[0].sessionId || existingSessionId;
          } else {
            existingEnrolledSeats = existingData.enrolledSeats || 0;
          }
          
          // Fallback to totalRegistrations if it's greater
          if (existingData.totalRegistrations && existingData.totalRegistrations > existingEnrolledSeats) {
            existingEnrolledSeats = existingData.totalRegistrations;
          }
        }
      }

      // Construct legacy session object for compatibility
      const session: Session = {
        sessionId: existingSessionId,
        sessionName: "Main Session",
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        locationType: "On-site",
        locationDetail: data.locationDetail,
        maxSeats: data.maxSeats,
        enrolledSeats: existingEnrolledSeats,
      };

      const courseData: any = {
        ...data,
        sessions: [session],
        updatedAt: serverTimestamp(),
      };

      // Remove undefined values to prevent Firestore errors
      Object.keys(courseData).forEach(key => {
        if (courseData[key] === undefined) {
          delete courseData[key];
        }
      });

      if (isEdit) {
        await setDoc(doc(db, "courses", id), courseData, { merge: true });
        toast.success("บันทึกการแก้ไขเรียบร้อย");
      } else {
        const newCourseRef = doc(collection(db, "courses"));
        await setDoc(newCourseRef, {
          ...courseData,
          id: newCourseRef.id,
          createdAt: serverTimestamp(),
        });
        toast.success("สร้างหลักสูตรใหม่เรียบร้อย");
      }
      navigate("/admin");
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error(`บันทึกไม่สำเร็จ: ${error.message || "กรุณาลองใหม่อีกครั้ง"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteDoc(doc(db, "courses", id));
      toast.success("ลบหลักสูตรเรียบร้อยแล้ว");
      navigate("/admin");
    } catch (error) {
      toast.error("ลบไม่สำเร็จ");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-12 h-12 text-crimson animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Sticky Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => navigate("/admin")}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                <ArrowLeft className="w-6 h-6 text-slate-400" />
              </button>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight font-sans">
                {isEdit ? "แก้ไขหลักสูตร" : "สร้างหลักสูตรใหม่"}
              </h1>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={() => navigate("/admin")}
                className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSubmit(onSubmit)}
                disabled={saving || !isDirty}
                className="bg-crimson hover:bg-crimson-dark text-white text-sm font-bold px-8 py-2.5 rounded-xl shadow-lg shadow-crimson/20 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[3rem] shadow-2xl border border-slate-200 overflow-hidden"
        >
          <div className="p-12">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
              {/* Left Column: Form Fields */}
              <div className="lg:col-span-2 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  {/* Row 1 */}
                  <div className="md:col-span-3 space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">ชื่อหลักสูตร</label>
                    <input 
                      {...register("title")}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                      placeholder="เช่น การใช้งาน AI เพื่อการสอน"
                    />
                    {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">ปีการศึกษา</label>
                    <input 
                      {...register("academicYear")}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                      placeholder="2567"
                    />
                  </div>

                  {/* Row 2 */}
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">วิทยากร</label>
                    <input 
                      {...register("instructorName")}
                      list="instructors-list"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                      placeholder="ชื่อ-นามสกุล วิทยากร"
                    />
                    <datalist id="instructors-list">
                      {instructors.map(inst => (
                        <option key={inst.id} value={inst.name} />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">ห้อง / สถานที่</label>
                    <input 
                      {...register("locationDetail")}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                      placeholder="เช่น C6-505"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">จำนวนที่รับ (ท่าน)</label>
                    <input 
                      type="number"
                      {...register("maxSeats", { valueAsNumber: true })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                      placeholder="40"
                    />
                  </div>

                  {/* Row 3 */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">วันที่จัดอบรม</label>
                    <input 
                      type="date"
                      {...register("date")}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">เวลาเริ่ม</label>
                    <input 
                      type="time"
                      {...register("startTime")}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">เวลาสิ้นสุด</label>
                    <input 
                      type="time"
                      {...register("endTime")}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">สถานะ</label>
                    <select 
                      {...register("status")}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium appearance-none"
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">รายละเอียดหลักสูตร</label>
                  <textarea 
                    {...register("description")}
                    rows={6}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-crimson outline-none transition-all font-medium resize-none"
                    placeholder="อธิบายรายละเอียดหลักสูตร วัตถุประสงค์ และสิ่งที่จะได้รับ..."
                  />
                </div>

                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox"
                      id="isVisible"
                      {...register("isVisible")}
                      className="w-5 h-5 rounded border-slate-300 text-crimson focus:ring-crimson"
                    />
                    <label htmlFor="isVisible" className="text-sm font-bold text-slate-700">แสดงผลบนหน้าหลัก (Public)</label>
                  </div>
                  <div className="ml-auto flex items-center gap-2 text-slate-400">
                    <Info className="w-4 h-4" />
                    <span className="text-[10px] uppercase tracking-widest font-bold">Visibility Toggle</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Cover Upload */}
              <div className="lg:col-span-1 space-y-4">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Course Cover (3:4)</label>
                <div className="aspect-[3/4] bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200 overflow-hidden relative group transition-all hover:border-crimson/30">
                  {(watchBannerImageBase64 || watchImageUrl) ? (
                    <>
                      <img src={watchBannerImageBase64 || watchImageUrl} alt="Cover Preview" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <label className="cursor-pointer p-3 bg-white text-crimson rounded-xl hover:scale-110 transition-transform">
                          <Upload className="w-5 h-5" />
                          <input type="file" className="hidden" onChange={handleImageUpload} accept="image/*" />
                        </label>
                        <button 
                          type="button"
                          onClick={() => {
                            setValue("imageUrl", "");
                            setValue("bannerImageBase64", "");
                          }}
                          className="p-3 bg-white text-red-500 rounded-xl hover:scale-110 transition-transform"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <label className="w-full h-full flex flex-col items-center justify-center gap-4 text-slate-400 hover:text-crimson transition-colors cursor-pointer">
                      <div className="w-16 h-16 rounded-2xl bg-white shadow-sm flex items-center justify-center">
                        {uploadProgress !== null ? (
                          <Loader2 className="w-8 h-8 text-crimson animate-spin" />
                        ) : (
                          <ImageIcon className="w-8 h-8" />
                        )}
                      </div>
                      <div className="text-center w-full px-8">
                        <p className="font-bold text-sm uppercase tracking-widest mb-2">
                          {uploadProgress !== null ? "Processing..." : "Upload Cover"}
                        </p>
                        {uploadProgress !== null && (
                          <div className="w-full space-y-2">
                            <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                              <div 
                                className="bg-crimson h-full transition-all duration-300" 
                                style={{ width: `${uploadProgress}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-bold text-crimson">{Math.round(uploadProgress)}%</p>
                          </div>
                        )}
                        <p className="text-[10px] mt-1">Portrait Ratio 3:4</p>
                      </div>
                      <input type="file" className="hidden" onChange={handleImageUpload} accept="image/*" />
                    </label>
                  )}
                  {uploadProgress !== null && (
                    <div className="absolute bottom-0 left-0 w-full h-1 bg-slate-100">
                      <div 
                        className="h-full bg-crimson transition-all duration-300" 
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  )}
                </div>
                
                <div className="p-6 bg-crimson/5 rounded-3xl border border-crimson/10 space-y-3">
                  <div className="flex items-center gap-2 text-crimson">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Tips</span>
                  </div>
                  <p className="text-xs text-slate-600 font-light leading-relaxed">
                    แนะนำให้ใช้รูปภาพแนวตั้งขนาด 1200 x 1600 พิกเซล เพื่อความคมชัดสูงสุดบนหน้าหลัก
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4 pt-12 border-t border-slate-100 mt-12">
              <button 
                type="button"
                onClick={() => navigate("/admin")}
                className="flex-1 px-8 py-4 bg-white border border-slate-200 text-slate-600 font-bold rounded-2xl hover:bg-slate-50 transition-all"
              >
                ยกเลิก
              </button>
              <button 
                onClick={handleSubmit(onSubmit)}
                disabled={saving}
                className="flex-1 px-8 py-4 bg-crimson hover:bg-crimson-dark text-white font-bold rounded-2xl shadow-xl shadow-crimson/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                {isEdit ? "อัปเดตหลักสูตร" : "สร้างหลักสูตร"}
              </button>
            </div>
          </div>
        </motion.div>

        {isEdit && (
          <div className="mt-12 text-center">
            <button 
              onClick={() => setShowDeleteConfirm(true)}
              className="text-red-400 hover:text-red-600 font-bold text-sm transition-colors flex items-center gap-2 mx-auto"
            >
              <Trash2 className="w-4 h-4" />
              ลบหลักสูตรนี้อย่างถาวร
            </button>
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDeleteConfirm(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-[2rem] shadow-2xl p-10 max-w-md w-full text-center"
            >
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertCircle className="w-10 h-10 text-red-500" />
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-2">Are you absolutely sure?</h3>
              <p className="text-slate-500 font-medium mb-8">
                การลบหลักสูตรนี้จะทำให้ข้อมูลการลงทะเบียนทั้งหมดหายไป และไม่สามารถกู้คืนได้
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleDelete}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-4 rounded-2xl transition-all"
                >
                  Yes, Delete Permanently
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-4 rounded-2xl transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
