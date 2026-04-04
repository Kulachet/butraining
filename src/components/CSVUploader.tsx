import React, { useState } from "react";
import Papa from "papaparse";
import { collection, writeBatch, doc, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Upload, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

interface CSVInstructor {
  id: string;
  name: string;
  email: string;
  department: string;
}

export const CSVUploader: React.FC = () => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<{ total: number; success: number; failed: number } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setStats(null);
    }
  };

  const startUpload = () => {
    if (!selectedFile) return;

    setUploading(true);
    setProgress(0);

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
            // Check for exact match or if the header contains the keyword
            const isMatch = possibleKeys.some(pk => {
              const lowerKey = normalizedKey.toLowerCase();
              const lowerPk = pk.toLowerCase();
              return lowerKey === lowerPk || lowerKey.includes(lowerPk);
            });
            
            if (isMatch) {
              return row[key];
            }
          }
          return null;
        };

        const instructors: CSVInstructor[] = data.map((row, index) => {
          const id = getValue(row, ["รหัสอาจารย์", "id", "Instructor ID", "รหัส"]);
          const name = getValue(row, ["ชื่อ-นามสกุล", "name", "Name", "ชื่อ", "อาจารย์"]);
          const email = getValue(row, ["อีเมล", "email", "Email", "University Email"]);
          const department = getValue(row, ["หน่วยงาน", "department", "Department", "คณะ", "ภาควิชา"]);

          // Basic validation for each row
          if (!id || !email) {
            if (index === 0) console.log("Row 0 mapping failed:", { id, name, email, department, raw: row });
            return null;
          }

          return {
            id: id.toString().trim(),
            name: (name || "ไม่ระบุชื่อ").toString().trim(),
            email: email.toString().trim(),
            department: (department || "ไม่ระบุหน่วยงาน").toString().trim(),
          };
        }).filter((inst): inst is CSVInstructor => inst !== null && !!inst.id && !!inst.email);

        if (instructors.length === 0) {
          console.log("Debug - Headers detected:", Object.keys(data[0] || {}));
          console.log("Debug - First row data:", data[0]);
          toast.error("ไม่พบข้อมูลที่ถูกต้องในไฟล์ CSV กรุณาตรวจสอบว่ามีหัวตาราง: รหัสอาจารย์, ชื่อ-นามสกุล, อีเมล");
          setUploading(false);
          return;
        }

        const total = data.length;
        let success = 0;
        let failed = 0;

        const batchSize = 500;
        for (let i = 0; i < instructors.length; i += batchSize) {
          const batch = writeBatch(db);
          const chunk = instructors.slice(i, i + batchSize);
          
          chunk.forEach((inst) => {
            const docRef = doc(db, "instructors", inst.id);
            batch.set(docRef, {
              ...inst,
              updatedAt: new Date().toISOString(),
            }, { merge: true });
          });

          try {
            await batch.commit();
            success += chunk.length;
            setProgress(Math.round(((i + chunk.length) / instructors.length) * 100));
          } catch (error) {
            console.error("Batch commit failed:", error);
            failed += chunk.length;
          }
        }

        setStats({ total, success, failed });
        setUploading(false);
        setSelectedFile(null);
        toast.success(`นำเข้าข้อมูลสำเร็จ ${success} รายการ`);
      },
      error: (error) => {
        console.error("CSV parsing failed:", error);
        toast.error("ไม่สามารถอ่านไฟล์ CSV ได้");
        setUploading(false);
      }
    });
  };

  return (
    <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 bg-crimson/10 rounded-2xl flex items-center justify-center text-crimson">
          <Upload className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-[20px] lg:text-[24px] font-semibold text-[#333333] tracking-[0.02em] leading-[1.6]">นำเข้าฐานข้อมูลอาจารย์</h3>
          <p className="text-[14px] lg:text-[16px] text-[#4A4A4A] font-normal leading-[1.7]">อัปโหลดไฟล์ CSV (UTF-8) เพื่อซิงค์ข้อมูลอาจารย์</p>
        </div>
      </div>

      {!uploading && !stats && (
        <div className="space-y-4">
          <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-slate-200 rounded-3xl cursor-pointer hover:bg-slate-50 transition-colors group">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="w-10 h-10 text-slate-300 group-hover:text-crimson transition-colors mb-4" />
              {selectedFile ? (
                <div className="text-center">
                  <p className="mb-2 text-[14px] lg:text-[16px] text-crimson font-medium">
                    {selectedFile.name}
                  </p>
                  <p className="text-[12px] lg:text-[13px] text-slate-400 font-medium uppercase tracking-widest">คลิกเพื่อเปลี่ยนไฟล์</p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="mb-2 text-[14px] lg:text-[16px] text-[#4A4A4A] font-normal">
                    <span className="font-medium text-crimson">คลิกเพื่อเลือกไฟล์</span> หรือลากไฟล์มาวาง
                  </p>
                  <p className="text-[12px] lg:text-[13px] text-slate-400 font-medium uppercase tracking-widest">CSV (UTF-8) เท่านั้น</p>
                </div>
              )}
            </div>
            <input type="file" className="hidden" accept=".csv" onChange={handleFileSelect} />
          </label>

          {selectedFile && (
            <button
              onClick={startUpload}
              className="w-full bg-crimson hover:bg-crimson-dark text-white font-medium py-4 rounded-2xl shadow-lg shadow-crimson/10 transition-all flex items-center justify-center gap-2 text-[14px] lg:text-[16px] tracking-wide"
            >
              <Upload className="w-5 h-5" />
              เริ่มการอัปโหลด
            </button>
          )}
        </div>
      )}

      {uploading && (
        <div className="flex flex-col items-center justify-center h-48">
          <Loader2 className="w-10 h-10 text-crimson animate-spin mb-4" />
          <p className="text-sm font-medium text-slate-600 mb-2">กำลังนำเข้าข้อมูล... {progress}%</p>
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
            <h4 className="text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">ผลการนำเข้า</h4>
            <button 
              onClick={() => setStats(null)}
              className="text-[12px] lg:text-[13px] font-medium text-crimson hover:underline"
            >
              อัปโหลดใหม่
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-[#333333]">{stats.total}</p>
              <p className="text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">ทั้งหมด</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{stats.success}</p>
              <p className="text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">สำเร็จ</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
              <p className="text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest">ล้มเหลว</p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 pt-8 border-t border-slate-50">
        <h4 className="text-[12px] lg:text-[13px] font-medium text-slate-400 uppercase tracking-widest mb-4">รูปแบบไฟล์ที่กำหนด</h4>
        <div className="bg-slate-50 rounded-xl p-4 font-mono text-[12px] text-slate-500 overflow-x-auto">
          รหัสอาจารย์, ชื่อ-นามสกุล, อีเมล, หน่วยงาน<br />
          12345, อาจารย์ ทดสอบ, test@bu.ac.th, คณะเทคโนโลยีสารสนเทศ
        </div>
      </div>
    </div>
  );
};
