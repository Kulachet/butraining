import React, { useState } from "react";
import Papa from "papaparse";
import { collection, writeBatch, doc, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ShieldAlert, 
  ShieldCheck, 
  AlertTriangle,
  Info
} from "lucide-react";
import toast from "react-hot-toast";

interface CSVInstructor {
  id: string;
  name: string;
  email: string;
  department: string;
}

interface ExistingInstructorDoc {
  id: string;
  name?: string;
  email?: string;
  department?: string;
  isManual?: boolean;
  uid?: string;
}

export const CSVUploader: React.FC = () => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<{ 
    total: number; 
    success: number; 
    skippedManual: number; 
    failed: number;
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Overwrite Protection Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [parsedInstructors, setParsedInstructors] = useState<CSVInstructor[]>([]);
  const [manualConflictInstructors, setManualConflictInstructors] = useState<ExistingInstructorDoc[]>([]);
  const [existingInstructorsMap, setExistingInstructorsMap] = useState<Map<string, ExistingInstructorDoc>>(new Map());

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setStats(null);
      setShowConfirmModal(false);
      setParsedInstructors([]);
      setManualConflictInstructors([]);
    }
  };

  const handleStartReview = () => {
    if (!selectedFile) return;

    setUploading(true);
    setProgress(10);

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      complete: async (results) => {
        const data = results.data as any[];
        if (data.length === 0) {
          toast.error("ไฟล์ CSV ไม่มีข้อมูล");
          setUploading(false);
          return;
        }

        // Helper to find value by multiple possible keys (case-insensitive, trimmed)
        const getValue = (row: any, possibleKeys: string[]) => {
          const rowKeys = Object.keys(row);
          for (const key of rowKeys) {
            const normalizedKey = key.trim().replace(/^\uFEFF/, ""); // Remove BOM
            const isMatch = possibleKeys.some((pk) => {
              const lowerKey = normalizedKey.toLowerCase();
              const lowerPk = pk.toLowerCase();
              return lowerKey === lowerPk || lowerKey.includes(lowerPk);
            });
            if (isMatch) return row[key];
          }
          return null;
        };

        const instructors: CSVInstructor[] = data
          .map((row, index) => {
            const id = getValue(row, ["รหัสอาจารย์", "id", "Instructor ID", "รหัส"]);
            const name = getValue(row, ["ชื่อ-นามสกุล", "name", "Name", "ชื่อ", "อาจารย์"]);
            const email = getValue(row, ["อีเมล", "email", "Email", "University Email"]);
            const department = getValue(row, ["หน่วยงาน", "department", "Department", "คณะ", "ภาควิชา"]);

            if (!id || !email) {
              if (index === 0) console.log("Row 0 mapping failed:", { id, name, email, department, raw: row });
              return null;
            }

            return {
              id: id.toString().trim(),
              name: (name || "ไม่ระบุชื่อ").toString().trim(),
              email: email.toString().toLowerCase().trim(),
              department: (department || "ไม่ระบุหน่วยงาน").toString().trim(),
            };
          })
          .filter((inst): inst is CSVInstructor => inst !== null && !!inst.id && !!inst.email);

        if (instructors.length === 0) {
          toast.error("ไม่พบข้อมูลที่ถูกต้องในไฟล์ CSV กรุณาตรวจสอบว่ามีหัวตาราง: รหัสอาจารย์, ชื่อ-นามสกุล, อีเมล");
          setUploading(false);
          return;
        }

        setProgress(30);

        // Fetch existing instructors to detect manually edited data
        try {
          const snap = await getDocs(collection(db, "instructors"));
          const existingMap = new Map<string, ExistingInstructorDoc>();
          
          snap.docs.forEach((d) => {
            const dData = d.data();
            const instId = (dData.id || d.id).toString().trim();
            existingMap.set(instId.toLowerCase(), {
              id: instId,
              name: dData.name,
              email: dData.email,
              department: dData.department,
              isManual: dData.isManual === true,
              uid: dData.uid,
            });
          });

          setExistingInstructorsMap(existingMap);

          // Find conflicts with manually edited records
          const manualConflicts: ExistingInstructorDoc[] = [];
          instructors.forEach((csvInst) => {
            const existing = existingMap.get(csvInst.id.toLowerCase());
            if (existing && existing.isManual) {
              manualConflicts.push(existing);
            }
          });

          setParsedInstructors(instructors);
          setManualConflictInstructors(manualConflicts);
          setUploading(false);

          if (manualConflicts.length > 0) {
            // Require explicit decision before overwriting
            setShowConfirmModal(true);
          } else {
            // No conflicts: proceed directly
            executeImport(instructors, existingMap, false);
          }
        } catch (fetchError) {
          console.error("Error reading existing instructors:", fetchError);
          // If fetching existing fails, proceed with standard merge
          setUploading(false);
          executeImport(instructors, new Map(), true);
        }
      },
      error: (error) => {
        console.error("CSV parsing failed:", error);
        toast.error("ไม่สามารถอ่านไฟล์ CSV ได้");
        setUploading(false);
      },
    });
  };

  const executeImport = async (
    instructorsToImport: CSVInstructor[],
    existingMap: Map<string, ExistingInstructorDoc>,
    overwriteManual: boolean
  ) => {
    setShowConfirmModal(false);
    setUploading(true);
    setProgress(40);

    const total = instructorsToImport.length;
    let success = 0;
    let skippedManual = 0;
    let failed = 0;

    // Filter list according to manual protection
    const queue: CSVInstructor[] = [];
    instructorsToImport.forEach((inst) => {
      const existing = existingMap.get(inst.id.toLowerCase());
      if (existing && existing.isManual && !overwriteManual) {
        skippedManual += 1;
      } else {
        queue.push(inst);
      }
    });

    const batchSize = 400; // Safe chunk size
    const totalBatches = Math.ceil(queue.length / batchSize) || 1;

    for (let i = 0; i < queue.length; i += batchSize) {
      const batch = writeBatch(db);
      const chunk = queue.slice(i, i + batchSize);

      chunk.forEach((inst) => {
        const docRef = doc(db, "instructors", inst.id);
        const existing = existingMap.get(inst.id.toLowerCase());

        const payload: any = {
          ...inst,
          updatedAt: new Date().toISOString(),
        };

        // Always preserve Google UID linkage if previously connected
        if (existing?.uid) {
          payload.uid = existing.uid;
        }

        // If manually overwritten with user consent, reset isManual or keep depending on choice
        if (overwriteManual) {
          payload.isManual = false;
        }

        batch.set(docRef, payload, { merge: true });
      });

      try {
        await batch.commit();
        success += chunk.length;
        const currentBatch = Math.floor(i / batchSize) + 1;
        setProgress(40 + Math.round((currentBatch / totalBatches) * 55));
      } catch (error) {
        console.error("Batch commit failed:", error);
        failed += chunk.length;
      }
    }

    setProgress(100);
    setStats({ total, success, skippedManual, failed });
    setUploading(false);
    setSelectedFile(null);

    if (skippedManual > 0) {
      toast.success(`นำเข้าสำเร็จ ${success} รายการ (ปกป้องข้อมูลที่แก้ไขด้วยตนเอง ${skippedManual} รายการ)`);
    } else {
      toast.success(`นำเข้าข้อมูลอาจารย์สำเร็จ ${success} รายการ`);
    }
  };

  return (
    <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm relative">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 bg-crimson/10 rounded-2xl flex items-center justify-center text-crimson">
          <Upload className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-[20px] lg:text-[24px] font-semibold text-[#333333] tracking-[0.02em] leading-[1.6]">
            นำเข้าฐานข้อมูลอาจารย์
          </h3>
          <p className="text-[14px] lg:text-[16px] text-[#4A4A4A] font-normal leading-[1.7]">
            อัปโหลดไฟล์ CSV (UTF-8) เพื่อซิงค์ข้อมูลอาจารย์
          </p>
        </div>
      </div>

      {!uploading && !stats && (
        <div className="space-y-4">
          <label className="flex flex-col items-center justify-center w-full h-44 border-2 border-dashed border-slate-200 rounded-3xl cursor-pointer hover:bg-slate-50 transition-colors group">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="w-10 h-10 text-slate-300 group-hover:text-crimson transition-colors mb-3" />
              {selectedFile ? (
                <div className="text-center px-4">
                  <p className="mb-1 text-[14px] lg:text-[15px] text-crimson font-semibold truncate max-w-xs">
                    {selectedFile.name}
                  </p>
                  <p className="text-[12px] text-slate-400 font-medium tracking-wide">
                    คลิกเพื่อเปลี่ยนไฟล์
                  </p>
                </div>
              ) : (
                <div className="text-center px-4">
                  <p className="mb-1 text-[14px] lg:text-[15px] text-[#4A4A4A] font-normal">
                    <span className="font-semibold text-crimson">คลิกเพื่อเลือกไฟล์</span> หรือลากไฟล์มาวาง
                  </p>
                  <p className="text-[12px] text-slate-400 font-medium tracking-wide">
                    CSV (UTF-8) เท่านั้น
                  </p>
                </div>
              )}
            </div>
            <input type="file" className="hidden" accept=".csv" onChange={handleFileSelect} />
          </label>

          {selectedFile && (
            <button
              onClick={handleStartReview}
              className="w-full bg-crimson hover:bg-crimson-dark text-white font-semibold py-3.5 rounded-2xl shadow-lg shadow-crimson/15 transition-all flex items-center justify-center gap-2 text-[14px] lg:text-[15px] tracking-wide"
            >
              <Upload className="w-4 h-4" />
              ตรวจสอบและเริ่มนำเข้า
            </button>
          )}
        </div>
      )}

      {uploading && (
        <div className="flex flex-col items-center justify-center h-44">
          <Loader2 className="w-10 h-10 text-crimson animate-spin mb-3" />
          <p className="text-sm font-semibold text-slate-700 mb-2">
            กำลังนำเข้าข้อมูล... {progress}%
          </p>
          <div className="w-full max-w-xs h-2 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-crimson transition-all duration-300" 
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {stats && (
        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-[12px] font-semibold text-slate-400 uppercase tracking-widest">
              ผลการนำเข้า
            </h4>
            <button 
              onClick={() => setStats(null)}
              className="text-[12px] font-semibold text-crimson hover:underline"
            >
              อัปโหลดใหม่
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center bg-white p-3 rounded-xl border border-slate-100">
              <p className="text-2xl font-bold text-[#333333]">{stats.total}</p>
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mt-1">
                ทั้งหมด
              </p>
            </div>
            <div className="text-center bg-white p-3 rounded-xl border border-slate-100">
              <p className="text-2xl font-bold text-green-600">{stats.success}</p>
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mt-1">
                สำเร็จ
              </p>
            </div>
            <div className="text-center bg-white p-3 rounded-xl border border-slate-100">
              <p className="text-2xl font-bold text-amber-600">{stats.skippedManual}</p>
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mt-1">
                ปกป้องข้อมูล
              </p>
            </div>
            <div className="text-center bg-white p-3 rounded-xl border border-slate-100">
              <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mt-1">
                ล้มเหลว
              </p>
            </div>
          </div>
          {stats.skippedManual > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200/60 mt-4 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 text-amber-600" />
              <span>
                ข้ามการเขียนทับอาจารย์ที่ปรับปรุงด้วยตนเอง {stats.skippedManual} ท่าน ข้อมูลยังคงปลอดภัย
              </span>
            </p>
          )}
        </div>
      )}

      {/* CSV Template Reference */}
      <div className="mt-6 pt-6 border-t border-slate-100">
        <h4 className="text-[12px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
          รูปแบบไฟล์ที่กำหนด
        </h4>
        <div className="bg-slate-50 rounded-xl p-3 font-mono text-[11px] text-slate-600 overflow-x-auto leading-relaxed border border-slate-100">
          รหัสอาจารย์, ชื่อ-นามสกุล, อีเมล, หน่วยงาน<br />
          12345, อาจารย์ ทดสอบ, test@bu.ac.th, คณะเทคโนโลยีสารสนเทศ
        </div>
      </div>

      {/* Prevent Silent Overwrite Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-200">
            <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mb-5">
              <ShieldAlert className="w-8 h-8" />
            </div>

            <h3 className="text-xl font-bold text-[#333333] mb-2">
              ตรวจพบข้อมูลที่ได้รับการแก้ไขด้วยตนเอง
            </h3>

            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
              ในไฟล์ CSV ที่เลือก พบอาจารย์จำนวน{" "}
              <span className="font-bold text-amber-600">
                {manualConflictInstructors.length} ท่าน
              </span>{" "}
              ที่มีการสร้างหรือแก้ไขข้อมูลด้วยตนเองผ่าน Admin Portal ระบบป้องกันการเขียนทับอัตโนมัติ
            </p>

            {/* List preview of manual records */}
            <div className="max-h-36 overflow-y-auto bg-slate-50 rounded-xl p-3 border border-slate-200/70 mb-5 text-xs text-slate-600 space-y-1.5">
              {manualConflictInstructors.slice(0, 5).map((inst) => (
                <div key={inst.id} className="flex items-center justify-between font-mono">
                  <span>{inst.id}: {inst.name}</span>
                  <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-sans">
                    แก้ไขเอง
                  </span>
                </div>
              ))}
              {manualConflictInstructors.length > 5 && (
                <p className="text-[11px] text-slate-400 text-center pt-1">
                  และอีก {manualConflictInstructors.length - 5} รายการ...
                </p>
              )}
            </div>

            <p className="text-xs font-semibold text-slate-700 mb-4">
              กรุณาเลือกรูปแบบการนำเข้าที่ต้องการ:
            </p>

            <div className="space-y-3">
              {/* Option A: Skip manual (Recommended) */}
              <button
                type="button"
                onClick={() => executeImport(parsedInstructors, existingInstructorsMap, false)}
                className="w-full p-4 rounded-2xl border-2 border-crimson/20 bg-crimson/5 hover:bg-crimson/10 text-left transition-all flex items-center justify-between group"
              >
                <div>
                  <div className="font-bold text-crimson text-sm flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-crimson" />
                    ข้ามรายการที่แก้ไขด้วยตนเอง (แนะนำ)
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    เก็บรักษาข้อมูลที่แอดมินแก้ไขไว้ และนำเข้าเฉพาะอาจารย์ใหม่หรือข้อมูลเดิมจาก CSV
                  </div>
                </div>
              </button>

              {/* Option B: Overwrite all */}
              <button
                type="button"
                onClick={() => executeImport(parsedInstructors, existingInstructorsMap, true)}
                className="w-full p-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-left transition-all"
              >
                <div className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  เขียนทับทั้งหมด (รวมรายการที่แก้ไขด้วยตนเอง)
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  ใช้ข้อมูลจากไฟล์ CSV แทนที่ข้อมูลทั้งหมดในระบบ
                </div>
              </button>
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowConfirmModal(false);
                  setSelectedFile(null);
                }}
                className="text-xs text-slate-400 hover:text-slate-600 font-medium px-4 py-2"
              >
                ยกเลิกการนำเข้า
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
