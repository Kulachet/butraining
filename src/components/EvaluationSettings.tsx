import React, { useState, useEffect } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Loader2, Plus, Trash2, Save, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { motion, Reorder } from "motion/react";

const DEFAULT_QUESTIONS = [
  "หัวข้อการอบรมมีความน่าสนใจและทันสมัย",
  "การอบรมครอบคลุมเนื้อหาได้ครบถ้วน",
  "เนื้อหาสาระ และกิจกรรมของการอบรม เหมาะสม",
  "สามารถนำความรู้ที่ได้ ไปประยุกต์ใช้ได้จริง",
  "วิทยากรมีความรู้ ประสบการณ์ และเชี่ยวชาญในหัวข้อที่อบรม",
  "วิทยากรถ่ายทอดความรู้ได้ดี และมีกิจกรรมที่เหมาะสมกับหัวข้ออบรม",
  "วิทยากรเปิดโอกาสให้มีส่วนร่วมและแสดงความคิดเห็นอย่างเพียงพอ",
  "วิทยากรสามารถตอบคำถามได้อย่างเข้าใจและตรงประเด็น",
  "ระยะเวลาในการอบรม เหมาะสมและสามารถครอบคลุมกิจกรรมต่างๆ",
  "ความรู้สึกพึงพอใจโดยรวมต่อการอบรมครั้งนี้"
];

export const EvaluationSettings: React.FC = () => {
  const [questions, setQuestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, "settings", "evaluation"));
        if (settingsDoc.exists() && settingsDoc.data().questions) {
          setQuestions(settingsDoc.data().questions);
        } else {
          setQuestions(DEFAULT_QUESTIONS);
        }
      } catch (error) {
        console.error("Error fetching settings:", error);
        toast.error("ไม่สามารถโหลดข้อมูลตั้งค่าได้");
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleAddQuestion = () => {
    setQuestions([...questions, ""]);
    setHasChanges(true);
  };

  const handleRemoveQuestion = (index: number) => {
    const newQuestions = questions.filter((_, i) => i !== index);
    setQuestions(newQuestions);
    setHasChanges(true);
  };

  const handleQuestionChange = (index: number, value: string) => {
    const newQuestions = [...questions];
    newQuestions[index] = value;
    setQuestions(newQuestions);
    setHasChanges(true);
  };

  const handleSave = async () => {
    // Filter out empty questions
    const validQuestions = questions.filter(q => q.trim().length > 0);
    if (validQuestions.length === 0) {
      toast.error("กรุณาเพิ่มอย่างน้อย 1 คำถาม");
      return;
    }

    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "evaluation"), {
        questions: validQuestions,
        updatedAt: new Date().toISOString()
      });
      setQuestions(validQuestions);
      setHasChanges(false);
      toast.success("บันทึกการตั้งค่าเรียบร้อยแล้ว");
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error("ไม่สามารถบันทึกข้อมูลได้");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-crimson animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-800">จัดการข้อคำถามการประเมิน</h3>
          <p className="text-sm text-slate-500">กำหนดรายการคำถามที่จะปรากฏในหน้าประเมินผลความพึงพอใจ</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleAddQuestion}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold transition-all"
          >
            <Plus className="w-4 h-4" /> เพิ่มคำถาม
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="flex items-center gap-2 px-6 py-2 bg-crimson hover:bg-crimson-dark text-white rounded-xl text-sm font-bold shadow-lg shadow-crimson/20 transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            บันทึกการเปลี่ยนแปลง
          </button>
        </div>
      </div>

      {hasChanges && (
        <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex items-center gap-3 text-amber-800 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>คุณมีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก กรุณากดปุ่มบันทึกเพื่อนำไปใช้งานจริง</span>
        </div>
      )}

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-2">
          <Reorder.Group axis="y" values={questions} onReorder={setQuestions} className="space-y-2">
            {questions.map((q, index) => (
              <Reorder.Item
                key={index}
                value={q}
                className="flex items-center gap-4 p-4 bg-white hover:bg-slate-50 rounded-2xl border border-transparent hover:border-slate-100 transition-all group"
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-[10px] font-bold text-slate-500">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => handleQuestionChange(index, e.target.value)}
                    placeholder="พิมพ์ข้อคำถามที่นี่..."
                    className="w-full bg-transparent border-none focus:ring-0 text-sm font-medium text-slate-700 placeholder:text-slate-300"
                  />
                </div>
                <button
                  onClick={() => handleRemoveQuestion(index)}
                  className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all md:opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <div className="cursor-grab active:cursor-grabbing p-1 text-slate-300">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="9" x2="16" y2="9"></line>
                    <line x1="8" y1="15" x2="16" y2="15"></line>
                    <line x1="12" y1="5" x2="12" y2="19" strokeOpacity="0"></line>
                  </svg>
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </div>
      </div>
    </div>
  );
};
