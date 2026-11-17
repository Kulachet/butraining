import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Navigate, useLocation } from "react-router-dom";
import { doc, getDoc, setDoc, collection, query, where, getDocs, limit } from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import { Course } from "../types";
import { resolveCourseLang } from "../contexts/LanguageContext";
import { DEFAULT_QUESTIONS_TH, getEvaluationQuestions, evaluationUi } from "../lib/evaluationI18n";
import { buildEvaluationDocId } from "../lib/evaluationId";
import { Loader2, ArrowLeft, Send, CheckCircle2, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { motion } from "motion/react";

type EvaluationOperation =
  | "LOAD_COURSE"
  | "LOAD_EVALUATION_SETTINGS"
  | "CHECK_EXISTING_EVALUATION"
  | "SUBMIT_EVALUATION"
  | "RECHECK_EXISTING_EVALUATION";

function logEvaluationDiagnostic(operation: EvaluationOperation, error: unknown): void {
  if (!import.meta.env.DEV) return;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code || "unknown")
      : "unknown";
  console.error("[EvaluatePage][DEV]", {
    operation,
    code,
    projectId: db.app.options.projectId || "unknown",
    authenticated: Boolean(auth.currentUser),
  });
}

export const EvaluatePage: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading, login } = useAuth();
  
  // Use URL query parameter as initial title if available
  const queryParams = new URLSearchParams(location.search);
  const titleFromUrl = queryParams.get("title");
  
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasEvaluated, setHasEvaluated] = useState(false);
  const [questions, setQuestions] = useState<string[]>(DEFAULT_QUESTIONS_TH);
  
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [suggestion, setSuggestion] = useState("");

  const evaluationLang = resolveCourseLang(course);
  const ui = evaluationUi[evaluationLang];
  const displayTitle = course?.title || titleFromUrl || ui.loading;

  const hasUserSubmittedEvaluation = useCallback(async (targetCourseId: string): Promise<boolean> => {
    const currentUser = auth.currentUser;
    if (!currentUser?.uid) {
      throw Object.assign(new Error("Firebase Auth user is not initialized."), { code: "auth/not-ready" });
    }
    const targetUid = currentUser.uid;
    // Queries by courseId + auth.currentUser.uid so both deterministic-ID and legacy random-ID submissions are detected.
    const existingEvalQ = query(
      collection(db, "evaluations"),
      where("courseId", "==", targetCourseId),
      where("userId", "==", targetUid),
      limit(1)
    );
    const evalSnap = await getDocs(existingEvalQ);
    return !evalSnap.empty;
  }, []);

  useEffect(() => {
    if (authLoading) return;

    const checkStatus = async () => {
      setLoading(true);
      setLoadError(null);
      let currentUi: (typeof evaluationUi)["th" | "en"] = evaluationUi.th;
      let currentOperation: EvaluationOperation = "LOAD_COURSE";
      try {
        if (!courseId) return;

        // Fetch course
        currentOperation = "LOAD_COURSE";
        const courseDoc = await getDoc(doc(db, "courses", courseId));
        if (courseDoc.exists()) {
          const loadedCourse = { id: courseDoc.id, ...courseDoc.data() } as Course;
          const resolvedLang = resolveCourseLang(loadedCourse);
          currentUi = evaluationUi[resolvedLang];
          setCourse(loadedCourse);
          currentOperation = "LOAD_EVALUATION_SETTINGS";
          const settingsDoc = await getDoc(doc(db, "settings", "evaluation"));
          setQuestions(getEvaluationQuestions(settingsDoc.exists() ? settingsDoc.data() : undefined, resolvedLang));
        } else {
          toast.error(currentUi.missingCourse);
          navigate("/");
          return;
        }

        if (!user || !auth.currentUser) return;

        // Check if already evaluated (supports both deterministic and historical random-ID docs)
        currentOperation = "CHECK_EXISTING_EVALUATION";
        if (await hasUserSubmittedEvaluation(courseId)) {
          setHasEvaluated(true);
        }
      } catch (error: any) {
        logEvaluationDiagnostic(currentOperation, error);
        const code = error?.code || "";
        const errorMsg =
          code === "permission-denied"
            ? currentUi.permissionDenied
            : code === "unavailable" || (typeof navigator !== "undefined" && !navigator.onLine)
            ? currentUi.networkError
            : currentUi.loadError;
        setLoadError(errorMsg);
        toast.error(errorMsg);
      } finally {
        setLoading(false);
      }
    };
    
    checkStatus();
  }, [courseId, user, authLoading, navigate, hasUserSubmittedEvaluation]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 text-crimson animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white max-w-md w-full rounded-3xl p-8 shadow-xl border border-slate-100 text-center"
        >
          <div className="w-20 h-20 bg-crimson/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-10 h-10 text-crimson" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">{ui.loginTitle}</h2>
          <p className="text-slate-500 mb-8 leading-relaxed">
            {ui.loginBody}
          </p>
          <button 
            onClick={login}
            className="w-full bg-crimson hover:bg-crimson-dark text-white font-bold py-4 rounded-xl shadow-lg shadow-crimson/20 transition-all flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
            {ui.loginButton}
          </button>
        </motion.div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white max-w-md w-full rounded-3xl p-8 shadow-xl border border-slate-100 text-center"
        >
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">{ui.errorTitle}</h2>
          <p className="text-slate-500 mb-8 leading-relaxed">{loadError}</p>
          <button 
            onClick={() => navigate("/")}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-3 rounded-xl transition-colors"
          >
            {ui.home}
          </button>
        </motion.div>
      </div>
    );
  }

  if (hasEvaluated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white max-w-md w-full rounded-3xl p-8 shadow-xl border border-slate-100 text-center"
        >
          <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">{ui.thanks}</h2>
          <p className="text-slate-500 mb-8 leading-relaxed">{ui.already}</p>
          <button 
            onClick={() => navigate("/")}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-3 rounded-xl transition-colors"
          >
            {ui.home}
          </button>
        </motion.div>
      </div>
    );
  }

  const handleRatingChange = (qIndex: number, value: number) => {
    setRatings(prev => ({ ...prev, [qIndex]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentUser = auth.currentUser;
    if (!user || !currentUser || !courseId || submitting || hasEvaluated) return;

    // Validate
    if (Object.keys(ratings).length < questions.length) {
      toast.error(ui.incomplete);
      return;
    }

    setSubmitting(true);
    let currentOperation: EvaluationOperation = "CHECK_EXISTING_EVALUATION";
    try {
      // Pre-check blocks new submissions if a legacy random-ID or concurrent evaluation already exists
      if (await hasUserSubmittedEvaluation(courseId)) {
        toast.error(ui.duplicateSubmission);
        setHasEvaluated(true);
        return;
      }

      currentOperation = "SUBMIT_EVALUATION";
      const activeUid = currentUser.uid;
      const deterministicId = buildEvaluationDocId(courseId, activeUid);
      // Atomic create-only write: if the deterministic document already exists, Firestore evaluates `allow update` and rejects participants.
      await setDoc(doc(db, "evaluations", deterministicId), {
        courseId,
        userId: activeUid,
        userEmail: currentUser.email ?? user.email,
        userName: currentUser.displayName || user.displayName || "Unknown",
        ratings,
        suggestion,
        createdAt: new Date().toISOString()
      });
      toast.success(ui.success);
      setHasEvaluated(true);
    } catch (error: any) {
      logEvaluationDiagnostic(currentOperation, error);
      // Safely recheck user's own submission status before classifying an ambiguous write failure as duplicate
      try {
        if (await hasUserSubmittedEvaluation(courseId)) {
          toast.error(ui.duplicateSubmission);
          setHasEvaluated(true);
          return;
        }
      } catch (recheckError) {
        logEvaluationDiagnostic("RECHECK_EXISTING_EVALUATION", recheckError);
      }

      const code = error?.code || "";
      const errorMsg =
        code === "permission-denied"
          ? ui.permissionDenied
          : code === "unavailable" || (typeof navigator !== "undefined" && !navigator.onLine)
          ? ui.networkError
          : ui.submitError;
      toast.error(errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 md:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <button 
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-slate-500 hover:text-crimson transition-colors font-medium text-sm w-fit"
        >
          <ArrowLeft className="w-4 h-4" /> {ui.back}
        </button>

        <div>
          <h1 className="text-3xl font-bold text-slate-800 mb-2">{ui.title}</h1>
          <p className="text-slate-500">{ui.course} <span className="font-semibold text-crimson">{displayTitle}</span></p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b border-slate-100 bg-slate-50/50 text-xs font-bold text-slate-500 uppercase tracking-widest text-center items-center">
              <div className="col-span-7 text-left pl-2">{ui.topic}</div>
              <div className="col-span-1">5<br/><span className="text-[10px] font-normal leading-tight text-slate-400">{ui.scale[0]}</span></div>
              <div className="col-span-1">4<br/><span className="text-[10px] font-normal leading-tight text-slate-400">{ui.scale[1]}</span></div>
              <div className="col-span-1">3<br/><span className="text-[10px] font-normal leading-tight text-slate-400">{ui.scale[2]}</span></div>
              <div className="col-span-1">2<br/><span className="text-[10px] font-normal leading-tight text-slate-400">{ui.scale[3]}</span></div>
              <div className="col-span-1">1<br/><span className="text-[10px] font-normal leading-tight text-slate-400">{ui.scale[4]}</span></div>
            </div>
            
            <div className="divide-y divide-slate-100">
              {questions.map((q, i) => (
                <div key={i} className="p-4 md:p-0 md:grid md:grid-cols-12 gap-4 items-center hover:bg-slate-50 transition-colors">
                  <div className="col-span-7 md:p-4 text-sm font-medium text-slate-700 leading-relaxed mb-4 md:mb-0">
                    <span className="text-crimson mr-2">{i + 1}.</span> {q}
                  </div>
                  
                  {/* Mobile labels, desktop uses grid headers */}
                  <div className="col-span-5 grid grid-cols-5 gap-1 md:gap-0 justify-items-center md:pb-0">
                    {[5, 4, 3, 2, 1].map((val) => (
                      <label key={val} className="flex flex-col items-center justify-center p-2 cursor-pointer group relative w-full h-full">
                        <div className="md:hidden text-[10px] text-slate-400 mb-1">{val}</div>
                        <div className={`relative flex items-center justify-center w-6 h-6 rounded-full border transition-all
                          ${ratings[i] === val ? "border-crimson text-crimson" : "border-slate-300 text-transparent group-hover:border-crimson/50"}
                        `}>
                          <input 
                            type="radio" 
                            name={`q${i}`} 
                            value={val} 
                            checked={ratings[i] === val}
                            onChange={() => handleRatingChange(i, val)}
                            className="absolute opacity-0 cursor-pointer pointer-events-none"
                            required
                          />
                          <div className={`w-3 h-3 rounded-full bg-crimson transition-transform duration-200 ${ratings[i] === val ? "scale-100" : "scale-0"}`} />
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200">
            <label className="block text-sm font-bold text-slate-700 mb-3">{questions.length + 1}. {ui.suggestion}</label>
            <textarea 
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              maxLength={5000}
              placeholder={ui.suggestionPlaceholder}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-normal text-slate-700 min-h-[120px] focus:ring-2 focus:ring-crimson/20 focus:border-crimson outline-none resize-y transition-all"
            />
          </div>

          <div className="flex justify-end">
            <button 
              type="submit" 
              disabled={submitting}
              className="bg-crimson hover:bg-crimson-dark text-white px-10 py-4 rounded-xl font-bold shadow-lg shadow-crimson/20 flex items-center justify-center gap-2 disabled:opacity-50 transition-all text-sm tracking-wide"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              {ui.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
