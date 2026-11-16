import React, { useState, useEffect } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Loader2, Save, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { DEFAULT_QUESTIONS_TH, DEFAULT_QUESTIONS_EN, EVALUATION_COUNT, getEvaluationQuestions, validQuestions } from "../lib/evaluationI18n";

export const EvaluationSettings: React.FC = () => {
  const [questionsTh, setQuestionsTh] = useState<string[]>(DEFAULT_QUESTIONS_TH);
  const [questionsEn, setQuestionsEn] = useState<string[]>(DEFAULT_QUESTIONS_EN);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snapshot = await getDoc(doc(db, "settings", "evaluation"));
        const data = snapshot.exists() ? snapshot.data() : undefined;
        if (data?.questions && !validQuestions(data.questions)) {
          toast.error("พบชุดคำถามเดิมที่มีจำนวนไม่เท่ากับ 10 ข้อ กรุณาตรวจสอบก่อนแก้ไข");
        }
        setQuestionsTh(getEvaluationQuestions(data, "th"));
        setQuestionsEn(getEvaluationQuestions(data, "en"));
      } catch (error) {
        console.error("Error fetching evaluation settings:", error);
        toast.error("ไม่สามารถโหลดข้อมูลตั้งค่าได้");
      } finally { setLoading(false); }
    };
    fetchSettings();
  }, []);
  const edit = (index: number, value: string, lang: "th" | "en") => {
    const setter = lang === "th" ? setQuestionsTh : setQuestionsEn;
    setter(prev => prev.map((v, i) => i === index ? value : v));
    setHasChanges(true);
  };
  const save = async () => {
    if (!validQuestions(questionsTh) || !validQuestions(questionsEn)) {
      toast.error("กรุณากรอกคำถามทั้ง 10 ข้อให้ครบทั้งสองภาษา"); return;
    }
    setSaving(true);
    try {
      // Merge preserves other settings fields, while keeping legacy `questions` for existing dashboards.
      await setDoc(doc(db, "settings", "evaluation"), {
        questions: questionsTh.map(q => q.trim()),
        questionsEn: questionsEn.map(q => q.trim()),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setHasChanges(false);
      toast.success("บันทึกคำถามทั้งสองภาษาเรียบร้อยแล้ว");
    } catch (error) {
      console.error("Error saving evaluation settings:", error);
      toast.error("ไม่สามารถบันทึกข้อมูลได้");
    } finally { setSaving(false); }
  };
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 text-crimson animate-spin" /></div>;
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-3 items-center justify-between">
      <div>
        <h3 className="text-lg font-bold text-slate-800">จัดการคำถามประเมิน (ไทย / English)</h3>
        <p className="text-sm text-slate-500">คำถาม 10 ข้อจับคู่ตามลำดับเดียวกัน เพื่อรักษาความถูกต้องของรายงานคะแนนเดิม</p>
      </div>
      <button type="button" onClick={save} disabled={saving || !hasChanges}
        className="flex gap-2 items-center px-5 py-2 rounded-xl bg-crimson text-white font-bold disabled:opacity-50">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} บันทึกทั้งสองภาษา
      </button>
    </div>
    <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 text-amber-900 text-sm">
      <AlertCircle className="w-5 h-5 shrink-0" /> ห้ามเพิ่ม ลบ หรือสลับลำดับคำถาม เนื่องจากรายงานเดิมใช้ตำแหน่งคะแนน 0–9
    </div>
    {hasChanges && <div className="text-amber-800 text-sm">มีการแก้ไขที่ยังไม่ได้บันทึก</div>}
    <div className="space-y-3">
      {Array.from({ length: EVALUATION_COUNT }, (_, i) => <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="font-bold text-slate-600 text-sm">ข้อ {i+1} / Question {i+1}</div>
        <label className="block text-sm text-slate-700">ภาษาไทย
          <input aria-label={`คำถามภาษาไทยข้อ ${i+1}`} className="block w-full border border-slate-200 rounded-lg p-3 mt-1" value={questionsTh[i]} onChange={e => edit(i,e.target.value,"th")} />
        </label>
        <label className="block text-sm text-slate-700">English
          <input aria-label={`English question ${i+1}`} className="block w-full border border-slate-200 rounded-lg p-3 mt-1" value={questionsEn[i]} onChange={e => edit(i,e.target.value,"en")} />
        </label>
      </div>)}
    </div>
  </div>;
};
