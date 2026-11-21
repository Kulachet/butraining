import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { Course, Instructor } from "../types";
import { useAuth } from "./AuthProvider";
import {
  buildCampaignRegistrationLink,
  CampaignLanguage,
  CampaignStatus,
  CsvParsePreviewResult,
  DEFAULT_PROMOTION_BATCH_SIZE,
  deriveInitialPosterFromCourse,
  dispatchPromotionBatch,
  fetchPromotionQuota,
  generateCampaignResultsCsv,
  getDefaultPromotionTemplate,
  isAuthorizedUniversityEmail,
  MAX_PROMOTION_BATCH_SIZE,
  normalizeEmailAddress,
  parseEmailAddressesText,
  parseRecipientsCsvContent,
  PosterConfig,
  processUploadedPosterFile,
  PromotionCampaignDoc,
  PromotionRecipientDoc,
  PromotionTemplateData,
  RawRecipientCandidate,
  RecipientDeliveryStatus,
  reconcileAndValidateRecipients,
  renderPromotionEmail,
  resolveInitialCampaignLanguage,
  sendPromotionTestEmail,
  validateExternalPosterUrl,
} from "../lib/promotionCampaign";
import {
  buildFirestoreCampaignRecord,
  createNewCampaignId,
  getPromotionCampaign,
  listCampaignRecipients,
  listSuppressionList,
  saveCampaignAndRecipients,
  resolveUnknownRecipientsDecision,
  updateCampaignRegistrationUrl,
} from "../lib/promotionCampaignService";
import { resolveInitialPublicAppUrl, validatePublicAppUrl } from "../lib/appUrl";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Download,
  Eye,
  FileSpreadsheet,
  Globe,
  Image as ImageIcon,
  Inbox,
  Link as LinkIcon,
  Loader2,
  Mail,
  Monitor,
  PauseCircle,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

export type PromotionModalInitialStep = 1 | 2 | 3 | 4 | 5 | 6;

interface PromotionCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCourse?: Course | null;
  existingCampaign?: PromotionCampaignDoc | null;
  initialStep?: PromotionModalInitialStep;
  onCampaignUpdated?: () => void;
}

const STEP_LABELS: Array<{ step: PromotionModalInitialStep; labelTh: string; labelEn: string }> = [
  { step: 1, labelTh: "เลือกหลักสูตร", labelEn: "Course" },
  { step: 2, labelTh: "เทมเพลต & โปสเตอร์", labelEn: "Template" },
  { step: 3, labelTh: "รายชื่อผู้รับ", labelEn: "Recipients" },
  { step: 4, labelTh: "พรีวิว & ทดสอบส่ง", labelEn: "Preview & Test" },
  { step: 5, labelTh: "ยืนยัน & ส่งอีเมล", labelEn: "Confirm & Send" },
  { step: 6, labelTh: "ผลลัพธ์การจัดส่ง", labelEn: "Results" },
];

export const PromotionCampaignModal: React.FC<PromotionCampaignModalProps> = ({
  isOpen,
  onClose,
  initialCourse = null,
  existingCampaign = null,
  initialStep,
  onCampaignUpdated,
}) => {
  const { user, isAdmin } = useAuth();

  // --- Core Navigation & Master Data ---
  const [step, setStep] = useState<PromotionModalInitialStep>(1);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loadingInstructors, setLoadingInstructors] = useState(false);
  const [suppressedEmails, setSuppressedEmails] = useState<Set<string>>(new Set());

  // --- Campaign Identity & Course ---
  const [campaignId, setCampaignId] = useState<string>("");
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [courseSearch, setCourseSearch] = useState("");
  const [baseAppUrl, setBaseAppUrl] = useState<string>(() => {
    const res = resolveInitialPublicAppUrl(typeof window !== "undefined" ? window.location.origin : "");
    return res.url || "https://butraining.netlify.app";
  });

  // --- Step 2: Language, Template & Poster ---
  const [campaignLanguage, setCampaignLanguage] = useState<CampaignLanguage>("th");
  const [template, setTemplate] = useState<PromotionTemplateData>(() =>
    getDefaultPromotionTemplate({ title: "" }, "th")
  );
  const [poster, setPoster] = useState<PosterConfig>({ mode: "none" });
  const [externalPosterInput, setExternalPosterInput] = useState("");
  const [posterWarning, setPosterWarning] = useState("");
  const [posterUploading, setPosterUploading] = useState(false);

  // --- Step 3: Recipients ---
  const [recipientSourceTab, setRecipientSourceTab] = useState<"paste" | "csv" | "instructor">("paste");
  const [rawCandidates, setRawCandidates] = useState<RawRecipientCandidate[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [csvPreview, setCsvPreview] = useState<CsvParsePreviewResult | null>(null);
  const [instructorSearch, setInstructorSearch] = useState("");
  const [instructorDeptFilter, setInstructorDeptFilter] = useState("ALL");
  const [selectedInstructorIds, setSelectedInstructorIds] = useState<Set<string>>(new Set());
  const [recipientInspectTab, setRecipientInspectTab] = useState<
    "eligible" | "duplicate" | "invalid" | "suppressed"
  >("eligible");
  const [eligibleSearch, setEligibleSearch] = useState("");

  // --- Step 4: Preview & Test ---
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [previewFormat, setPreviewFormat] = useState<"html" | "text">("html");
  const [previewGreetingMode, setPreviewGreetingMode] = useState<"personalized" | "neutral">("personalized");
  const [testEmail, setTestEmail] = useState("");
  const [testName, setTestName] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testResultMsg, setTestResultMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // --- Step 5 & 6: Quota, Confirmation, Dispatch & Results ---
  const [adminConfirmed, setAdminConfirmed] = useState(false);
  const [batchSize, setBatchSize] = useState<number>(DEFAULT_PROMOTION_BATCH_SIZE);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [remainingQuota, setRemainingQuota] = useState<number | null>(null);
  const [quotaError, setQuotaError] = useState("");
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchLog, setDispatchLog] = useState<string>("");
  const pauseRequestedRef = useRef(false);

  const [campaignDoc, setCampaignDoc] = useState<PromotionCampaignDoc | null>(null);
  const [campaignRecipients, setCampaignRecipients] = useState<PromotionRecipientDoc[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultsStatusFilter, setResultsStatusFilter] = useState<RecipientDeliveryStatus | "all">("all");
  const [resultsSearch, setResultsSearch] = useState("");

  // Unknown explicit Admin review state
  const [selectedUnknownIds, setSelectedUnknownIds] = useState<Set<string>>(new Set());
  const [unknownAdminNote, setUnknownAdminNote] = useState("");
  const [resolvingUnknown, setResolvingUnknown] = useState(false);

  const fileInputPosterRef = useRef<HTMLInputElement>(null);
  const fileInputCsvRef = useRef<HTMLInputElement>(null);

  const refreshQuota = useCallback(async () => {
    const curUser = auth.currentUser;
    if (!curUser) return;
    setQuotaLoading(true);
    setQuotaError("");
    try {
      const idToken = await curUser.getIdToken();
      const res = await fetchPromotionQuota(idToken);
      if (res.ok) {
        setRemainingQuota(res.remainingDailyQuota ?? null);
      } else {
        const tag = res.httpStatus ? `[HTTP ${res.httpStatus}${res.code ? ` · ${res.code}` : ""}] ` : res.code ? `[${res.code}] ` : "";
        setQuotaError(`${tag}${res.message || "ไม่สามารถตรวจสอบโควตา MailApp ได้"}`);
      }
    } catch (err: any) {
      setQuotaError(err?.message || "ไม่สามารถเชื่อมต่อบริการตรวจสอบโควตา");
    } finally {
      setQuotaLoading(false);
    }
  }, []);

  const loadCampaignResultsFromFirestore = useCallback(async (cid: string) => {
    if (!cid) return;
    setLoadingResults(true);
    try {
      const [cDoc, recs] = await Promise.all([
        getPromotionCampaign(cid),
        listCampaignRecipients(cid),
      ]);
      if (cDoc) setCampaignDoc(cDoc);
      setCampaignRecipients(recs);
    } catch (err) {
      console.error("Error loading campaign results:", err);
      toast.error("ไม่สามารถโหลดผลลัพธ์แคมเปญได้");
    } finally {
      setLoadingResults(false);
    }
  }, []);

  // Initialize modal state cleanly when opened
  useEffect(() => {
    if (!isOpen) return;
    pauseRequestedRef.current = false;
    setAdminConfirmed(false);
    setTestResultMsg(null);
    setDispatchLog("");
    setSelectedInstructorIds(new Set());
    setCsvPreview(null);
    setPasteText("");

    const defaultTestEmail = normalizeEmailAddress(user?.email);
    setTestEmail(isAuthorizedUniversityEmail(defaultTestEmail) ? defaultTestEmail : "");
    setTestName(user?.displayName || "");

    const resolvedUrl = resolveInitialPublicAppUrl(typeof window !== "undefined" ? window.location.origin : "");
    setBaseAppUrl(resolvedUrl.url || "https://butraining.netlify.app");

    // Load courses, instructors & suppression list
    setLoadingCourses(true);
    getDocs(query(collection(db, "courses"), orderBy("createdAt", "desc")))
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Course)
          .filter((c) => !c.archived);
        setCourses(list);

        if (existingCampaign) {
          const matched = list.find((c) => c.id === existingCampaign.courseId) || initialCourse || null;
          setSelectedCourse(matched);
        } else if (initialCourse) {
          setSelectedCourse(initialCourse);
        }
      })
      .catch((err) => console.error("Failed loading courses:", err))
      .finally(() => setLoadingCourses(false));

    setLoadingInstructors(true);
    getDocs(collection(db, "instructors"))
      .then((snap) => {
        setInstructors(snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as Instructor));
      })
      .catch((err) => console.error("Failed loading instructors:", err))
      .finally(() => setLoadingInstructors(false));

    listSuppressionList()
      .then((entries) => {
        setSuppressedEmails(new Set(entries.map((e) => normalizeEmailAddress(e.email)).filter(Boolean)));
      })
      .catch((err) => console.error("Failed loading suppressions:", err));

    if (existingCampaign) {
      setCampaignId(existingCampaign.id);
      setCampaignDoc(existingCampaign);
      setCampaignLanguage(existingCampaign.language);
      setTemplate(existingCampaign.template);
      setBatchSize(existingCampaign.batchSize || DEFAULT_PROMOTION_BATCH_SIZE);
      if (existingCampaign.posterMode === "course_url" || existingCampaign.posterMode === "custom_url") {
        setPoster({ mode: existingCampaign.posterMode, publicUrl: existingCampaign.posterUrl || "" });
        setExternalPosterInput(existingCampaign.posterUrl || "");
        setPosterWarning("");
      } else if (existingCampaign.posterMode === "inline_cid") {
        // Inline Base64 is intentionally NOT persisted in Firestore.
        // Re-derive from course if available, else warn Admin to re-attach if resuming sending.
        const derived = initialCourse ? deriveInitialPosterFromCourse(initialCourse) : { mode: "none" as const };
        setPoster(derived);
        setPosterWarning(
          derived.mode === "none"
            ? "แคมเปญนี้ใช้โปสเตอร์แบบแนบไฟล์ (Inline CID) หากต้องการส่งผู้รับที่ค้างอยู่ต่อ กรุณาอัปโหลดภาพโปสเตอร์ใหม่ในขั้นตอนที่ 2"
            : ""
        );
      } else {
        setPoster({ mode: "none" });
        setPosterWarning("");
      }
      setStep(initialStep || (existingCampaign.sentCount > 0 || existingCampaign.pendingCount > 0 ? 6 : 2));
      loadCampaignResultsFromFirestore(existingCampaign.id);
    } else if (initialCourse) {
      const cid = createNewCampaignId(initialCourse.id);
      const initLang = resolveInitialCampaignLanguage(initialCourse);
      const derivedPoster = deriveInitialPosterFromCourse(initialCourse);
      setCampaignId(cid);
      setCampaignDoc(null);
      setCampaignRecipients([]);
      setSelectedCourse(initialCourse);
      setCampaignLanguage(initLang);
      setTemplate(getDefaultPromotionTemplate(initialCourse, initLang));
      setPoster(derivedPoster);
      setExternalPosterInput(derivedPoster.publicUrl || "");
      setPosterWarning(derivedPoster.blockedReason || "");
      setRawCandidates([]);
      setStep(initialStep || 2);
    } else {
      setCampaignId(createNewCampaignId("new"));
      setCampaignDoc(null);
      setCampaignRecipients([]);
      setSelectedCourse(null);
      setCampaignLanguage("th");
      setTemplate(getDefaultPromotionTemplate({ title: "" }, "th"));
      setPoster({ mode: "none" });
      setExternalPosterInput("");
      setPosterWarning("");
      setRawCandidates([]);
      setStep(initialStep || 1);
    }
  }, [isOpen, initialCourse, existingCampaign, initialStep, user, loadCampaignResultsFromFirestore]);

  const handleSelectCourse = (course: Course) => {
    const newId = createNewCampaignId(course.id);
    const initLang = resolveInitialCampaignLanguage(course);
    const derivedPoster = deriveInitialPosterFromCourse(course);
    setCampaignId(newId);
    setSelectedCourse(course);
    setCampaignLanguage(initLang);
    setTemplate(getDefaultPromotionTemplate(course, initLang));
    setPoster(derivedPoster);
    setExternalPosterInput(derivedPoster.publicUrl || "");
    setPosterWarning(derivedPoster.blockedReason || "");
    setCampaignDoc(null);
    setCampaignRecipients([]);
    setStep(2);
  };

  const handleLanguageChange = (nextLang: CampaignLanguage) => {
    if (nextLang === campaignLanguage) return;
    setCampaignLanguage(nextLang);
    if (selectedCourse) {
      setTemplate(getDefaultPromotionTemplate(selectedCourse, nextLang));
    } else {
      setTemplate(getDefaultPromotionTemplate({ title: "" }, nextLang));
    }
  };

  const baseAppUrlValidation = useMemo(() => validatePublicAppUrl(baseAppUrl), [baseAppUrl]);

  const registrationUrl = useMemo(() => {
    if (!selectedCourse || !baseAppUrlValidation.valid) return "";
    try {
      return buildCampaignRegistrationLink(baseAppUrl, selectedCourse.id);
    } catch {
      return "";
    }
  }, [selectedCourse, baseAppUrl, baseAppUrlValidation.valid]);

  // Poster Actions
  const handlePosterFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setPosterUploading(true);
    setPosterWarning("");
    try {
      const processed = await processUploadedPosterFile(file);
      setPoster(processed);
      setExternalPosterInput("");
      toast.success(
        `เตรียมโปสเตอร์เรียบร้อย (${processed.width}x${processed.height}px, ${Math.round(
          (processed.byteSize || 0) / 1024
        )} KB)`
      );
    } catch (err: any) {
      toast.error(err?.message || "อัปโหลดโปสเตอร์ไม่สำเร็จ");
    } finally {
      setPosterUploading(false);
    }
  };

  const handleApplyExternalPosterUrl = () => {
    const check = validateExternalPosterUrl(externalPosterInput);
    if (!check.valid || !check.normalizedUrl) {
      setPosterWarning(check.reason || "URL รูปภาพไม่ถูกต้อง");
      toast.error(check.reason || "URL รูปภาพไม่ถูกต้อง");
      return;
    }
    setPosterWarning("");
    setPoster({ mode: "custom_url", publicUrl: check.normalizedUrl });
    toast.success("ตั้งค่าลิงก์โปสเตอร์ HTTPS แล้ว");
  };

  const handleReuseCoursePoster = () => {
    if (!selectedCourse) return;
    const derived = deriveInitialPosterFromCourse(selectedCourse);
    setPoster(derived);
    setExternalPosterInput(derived.publicUrl || "");
    setPosterWarning(derived.blockedReason || "");
    if (derived.mode === "none" && !derived.blockedReason) {
      toast("หลักสูตรนี้ยังไม่มีโปสเตอร์เดิม สามารถอัปโหลดภาพใหม่ได้", { icon: "ℹ️" });
    }
  };

  // Recipient Management & Validation
  const reconciliation = useMemo(() => {
    return reconcileAndValidateRecipients({
      campaignId: campaignId || "draft",
      candidates: rawCandidates,
      suppressedEmails,
      requireBuDomain: true,
    });
  }, [campaignId, rawCandidates, suppressedEmails]);

  const handleAddPastedEmails = () => {
    const parsed = parseEmailAddressesText(pasteText);
    if (parsed.length === 0) {
      toast.error("ไม่พบอีเมลในข้อความที่วาง");
      return;
    }
    setRawCandidates((prev) => [...prev, ...parsed]);
    setPasteText("");
    toast.success(`เพิ่มรายการจากข้อความแล้ว ${parsed.length} รายการ (ตรวจสอบความซ้ำซ้อนและโดเมนแล้ว)`);
  };

  const handleCsvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const text = await file.text();
      const preview = parseRecipientsCsvContent(text);
      setCsvPreview(preview);
      if (preview.rows.length === 0) {
        toast.error("ไม่พบแถวข้อมูลในไฟล์ CSV");
      } else {
        toast.success(`อ่านตัวอย่างไฟล์ CSV สำเร็จ (${preview.rows.length} แถว) กรุณาตรวจสอบก่อนยืนยันนำเข้า`);
      }
    } catch {
      toast.error("ไม่สามารถอ่านไฟล์ CSV ได้");
    }
  };

  const handleConfirmCsvImport = () => {
    if (!csvPreview || csvPreview.rows.length === 0) return;
    const items: RawRecipientCandidate[] = csvPreview.rows.map((r) => ({
      email: r.email,
      name: r.name,
      department: r.department,
      source: "csv",
    }));
    setRawCandidates((prev) => [...prev, ...items]);
    setCsvPreview(null);
    toast.success(`นำเข้าผู้รับจาก CSV จำนวน ${items.length} แถวแล้ว`);
  };

  const instructorDepartments = useMemo(() => {
    return Array.from(new Set(instructors.map((i) => i.department).filter(Boolean))).sort();
  }, [instructors]);

  const filteredInstructors = useMemo(() => {
    const q = instructorSearch.trim().toLowerCase();
    return instructors.filter((inst) => {
      if (instructorDeptFilter !== "ALL" && inst.department !== instructorDeptFilter) return false;
      if (!q) return true;
      return (
        (inst.name || "").toLowerCase().includes(q) ||
        (inst.englishFullName || "").toLowerCase().includes(q) ||
        (inst.email || "").toLowerCase().includes(q) ||
        (inst.id || "").toLowerCase().includes(q)
      );
    });
  }, [instructors, instructorSearch, instructorDeptFilter]);

  const handleAddSelectedInstructors = () => {
    if (selectedInstructorIds.size === 0) {
      toast.error("กรุณาเลือกอาจารย์ที่ต้องการเพิ่มอย่างน้อย 1 ท่าน");
      return;
    }
    const chosen = instructors.filter((i) => selectedInstructorIds.has(i.id || i.email));
    const items: RawRecipientCandidate[] = chosen.map((inst) => ({
      email: inst.email,
      name:
        campaignLanguage === "en" && inst.englishFullName
          ? inst.englishFullName
          : inst.name,
      department: inst.department,
      source: "instructor",
    }));
    setRawCandidates((prev) => [...prev, ...items]);
    setSelectedInstructorIds(new Set());
    toast.success(`เพิ่มอาจารย์ที่เลือกจำนวน ${items.length} ท่านแล้ว`);
  };

  const handleRemoveEligibleRecipient = (emailToRemove: string) => {
    const norm = normalizeEmailAddress(emailToRemove);
    setRawCandidates((prev) => prev.filter((c) => normalizeEmailAddress(c.email) !== norm));
  };

  // Preview Email (Step 4)
  const sampleRecipientName = useMemo(() => {
    if (previewGreetingMode === "neutral") return "";
    const withName = reconciliation.eligible.find((r) => r.name.trim().length > 0);
    if (withName) return withName.name;
    return testName.trim() || "";
  }, [previewGreetingMode, reconciliation.eligible, testName]);

  const previewPosterSrc = useMemo(() => {
    if (poster.mode === "inline_cid" && poster.inlineBase64 && poster.inlineMimeType) {
      return `data:${poster.inlineMimeType};base64,${poster.inlineBase64}`;
    }
    if ((poster.mode === "course_url" || poster.mode === "custom_url") && poster.publicUrl) {
      return poster.publicUrl;
    }
    return undefined;
  }, [poster]);

  const renderedPreview = useMemo(() => {
    if (!selectedCourse) return null;
    const safeUrl = registrationUrl || "https://butraining.netlify.app/";
    return renderPromotionEmail({
      course: selectedCourse,
      template,
      registrationUrl: safeUrl,
      recipientName: sampleRecipientName,
      posterSrc: previewPosterSrc,
      isTest: false,
    });
  }, [selectedCourse, template, registrationUrl, sampleRecipientName, previewPosterSrc]);

  const handleSendTest = async () => {
    if (!selectedCourse) return;
    if (!registrationUrl) {
      toast.error("Published Registration URL ยังไม่ถูกต้อง");
      return;
    }
    const norm = normalizeEmailAddress(testEmail);
    if (!isAuthorizedUniversityEmail(norm)) {
      toast.error("อีเมลทดสอบต้องใช้นามสกุล @bu.ac.th เท่านั้น");
      return;
    }

    const curUser = auth.currentUser;
    if (!curUser) {
      toast.error("กรุณาเข้าสู่ระบบผู้ดูแลระบบใหม่อีกครั้ง");
      return;
    }

    setSendingTest(true);
    setTestResultMsg(null);
    try {
      const idToken = await curUser.getIdToken();
      const res = await sendPromotionTestEmail({
        idToken,
        courseId: selectedCourse.id,
        campaignId,
        testEmail: norm,
        testName,
        language: campaignLanguage,
        registrationUrl,
        template,
        poster,
      });
      const errTag =
        !res.ok && (res.httpStatus || res.code)
          ? `[${res.httpStatus ? `HTTP ${res.httpStatus}` : ""}${res.httpStatus && res.code ? " · " : ""}${res.code || ""}] `
          : "";
      const displayMsg = `${errTag}${res.message}`;
      setTestResultMsg({ ok: res.ok, text: displayMsg });
      if (typeof res.remainingDailyQuota === "number") {
        setRemainingQuota(res.remainingDailyQuota);
      }
      if (res.ok) toast.success(displayMsg);
      else toast.error(displayMsg);
    } catch (err: any) {
      const msg = err?.message || "ส่งอีเมลทดสอบไม่สำเร็จ";
      setTestResultMsg({ ok: false, text: msg });
      toast.error(msg);
    } finally {
      setSendingTest(false);
    }
  };

  // Save draft / ready & Dispatch batches (Step 5)
  const ensureCampaignPersisted = async (): Promise<PromotionCampaignDoc> => {
    if (!selectedCourse) throw new Error("ยังไม่ได้เลือกหลักสูตร");
    if (!registrationUrl) throw new Error("Published Registration URL ไม่ถูกต้อง");
    if (!user) throw new Error("ไม่พบเซสชันผู้ดูแลระบบ");

    const isExistingResumable = Boolean(campaignDoc && campaignRecipients.length > 0);
    if (isExistingResumable && rawCandidates.length === 0) {
      if (campaignDoc && campaignDoc.registrationUrl !== registrationUrl) {
        const syncedUrl = await updateCampaignRegistrationUrl(campaignDoc.id, registrationUrl);
        const updatedDoc = { ...campaignDoc, registrationUrl: syncedUrl };
        setCampaignDoc(updatedDoc);
        return updatedDoc;
      }
      return campaignDoc!;
    }

    setIsSavingCampaign(true);
    try {
      const docRecord = buildFirestoreCampaignRecord({
        campaignId,
        courseId: selectedCourse.id,
        courseTitle: selectedCourse.title,
        language: campaignLanguage,
        template,
        registrationUrl,
        poster,
        recipientsCount: reconciliation.eligible.length,
        suppressedCount: reconciliation.stats.suppressedCount,
        batchSize,
        adminUid: user.uid,
        adminEmail: user.email || "",
        existingCreatedAt: campaignDoc?.createdAt,
      });

      await saveCampaignAndRecipients({
        campaign: docRecord,
        recipients: reconciliation.eligible,
      });

      setCampaignDoc(docRecord);
      await loadCampaignResultsFromFirestore(docRecord.id);
      onCampaignUpdated?.();
      return docRecord;
    } finally {
      setIsSavingCampaign(false);
    }
  };

  const handleSaveDraftOnly = async () => {
    try {
      await ensureCampaignPersisted();
      toast.success("บันทึกข้อมูลแคมเปญลงฐานข้อมูลแล้ว (ยังไม่ได้ส่งอีเมล)");
    } catch (err: any) {
      toast.error(err?.message || "บันทึกแคมเปญไม่สำเร็จ");
    }
  };

  const handleStartConfirmedDispatch = async () => {
    if (!adminConfirmed) {
      toast.error("กรุณาติ๊กยืนยันความถูกต้องโดยผู้ดูแลระบบก่อนเริ่มส่งอีเมล");
      return;
    }
    const curUser = auth.currentUser;
    if (!curUser) {
      toast.error("กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
      return;
    }

    pauseRequestedRef.current = false;
    setIsDispatching(true);
    setDispatchLog("กำลังบันทึกแคมเปญและตรวจสอบรายชื่อผู้รับใน Firestore...");

    try {
      const persisted = await ensureCampaignPersisted();
      let pendingLeft = persisted.pendingCount;
      let batchCounter = 0;

      while (pendingLeft > 0 && !pauseRequestedRef.current) {
        batchCounter++;
        setDispatchLog(`กำลังส่งชุดที่ ${batchCounter} (คงเหลือรอส่ง ${pendingLeft} รายการ)...`);
        const idToken = await curUser.getIdToken();
        const res = await dispatchPromotionBatch({
          idToken,
          campaignId: persisted.id,
          batchSize,
          poster,
        });

        if (typeof res.remainingDailyQuota === "number") {
          setRemainingQuota(res.remainingDailyQuota);
        }

        await loadCampaignResultsFromFirestore(persisted.id);
        onCampaignUpdated?.();

        if (!res.ok) {
          const statusTag =
            res.httpStatus || res.code
              ? `[${res.httpStatus ? `HTTP ${res.httpStatus}` : ""}${res.httpStatus && res.code ? " · " : ""}${res.code || ""}] `
              : "";
          const formattedError = res.outcomeAmbiguous
            ? `${statusTag}สถานะไม่แน่ชัด (Unknown): ${res.message} — โปรดตรวจสอบสถานะผู้รับในหน้าผลลัพธ์ (Step 6) ก่อนกดส่งซ้ำ`
            : `${statusTag}${res.message}`;
          setDispatchLog(`หยุดการส่ง: ${formattedError}`);
          toast.error(formattedError, { duration: 7000 });
          break;
        }

        pendingLeft = res.remainingPending ?? 0;

        if (res.quotaExhausted) {
          setDispatchLog(res.message);
          toast(res.message, { icon: "⚠️", duration: 7000 });
          break;
        }

        if ((res.processedCount ?? 0) === 0 && pendingLeft === 0) {
          break;
        }

        // Small courtesy pause between batches to respect Apps Script & Firestore pacing
        if (pendingLeft > 0 && !pauseRequestedRef.current) {
          await new Promise((r) => setTimeout(r, 700));
        }
      }

      if (pauseRequestedRef.current) {
        setDispatchLog("ผู้ดูแลระบบหยุดการส่งชั่วคราว — รายการที่เหลือยังอยู่ในสถานะ Pending สามารถกลับมาส่งต่อได้");
        toast("หยุดการส่งชั่วคราวแล้ว รายชื่อที่เหลือยังคงอยู่", { icon: "⏸️" });
      } else if (pendingLeft === 0) {
        setDispatchLog("ประมวลผลรายชื่อผู้รับทั้งหมดเสร็จสิ้น");
        toast.success("ประมวลผลแคมเปญเสร็จสิ้น กรุณาตรวจสอบผลลัพธ์");
        setStep(6);
      }
    } catch (err: any) {
      console.error("Dispatch error:", err);
      toast.error(err?.message || "เกิดข้อผิดพลาดระหว่างการจัดส่ง");
      setDispatchLog(err?.message || "เกิดข้อผิดพลาดระหว่างการจัดส่ง");
    } finally {
      setIsDispatching(false);
    }
  };

  // Step 6: Unknown review & CSV export
  const unknownRecipients = useMemo(
    () => campaignRecipients.filter((r) => r.status === "unknown" || r.status === "processing"),
    [campaignRecipients]
  );

  const filteredResultsRecipients = useMemo(() => {
    const q = resultsSearch.trim().toLowerCase();
    return campaignRecipients.filter((r) => {
      if (resultsStatusFilter !== "all" && r.status !== resultsStatusFilter) return false;
      if (!q) return true;
      return (
        r.email.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q)
      );
    });
  }, [campaignRecipients, resultsStatusFilter, resultsSearch]);

  const handleResolveUnknown = async (targetStatus: "pending" | "skipped" | "sent") => {
    const ids: string[] = Array.from(selectedUnknownIds as Set<string>);
    if (ids.length === 0) {
      toast.error("กรุณาเลือกรายการ Unknown ที่ต้องการดำเนินการ");
      return;
    }
    if (!unknownAdminNote.trim()) {
      toast.error("กรุณาระบุหมายเหตุการตรวจสอบของผู้ดูแลระบบก่อนบันทึก");
      return;
    }
    setResolvingUnknown(true);
    try {
      await resolveUnknownRecipientsDecision({
        campaignId,
        recipientIds: ids,
        targetStatus,
        adminNote: `[Admin Review] ${unknownAdminNote.trim()}`,
      });
      setSelectedUnknownIds(new Set());
      setUnknownAdminNote("");
      await loadCampaignResultsFromFirestore(campaignId);
      onCampaignUpdated?.();
      toast.success("บันทึกผลการตรวจสอบรายการ Unknown เรียบร้อยแล้ว");
    } catch (err: any) {
      toast.error(err?.message || "ไม่สามารถบันทึกการตรวจสอบได้");
    } finally {
      setResolvingUnknown(false);
    }
  };

  const handleExportResultsCsv = () => {
    if (!campaignDoc) return;
    const { csvContent, filename } = generateCampaignResultsCsv(campaignDoc, campaignRecipients);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("ดาวน์โหลดรายงานผลการจัดส่ง CSV แล้ว");
  };

  if (!isOpen || !isAdmin) return null;

  const isPosterMissingWarning = poster.mode === "none";
  const hasEligibleOrSavedRecipients =
    reconciliation.eligible.length > 0 || campaignRecipients.length > 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white w-full max-w-6xl rounded-2xl border border-slate-200 shadow-2xl flex flex-col max-h-[94vh] overflow-hidden">
        {/* Top Modal Header */}
        <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#8b0000] text-white flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 truncate">
                ระบบส่งอีเมลประชาสัมพันธ์หลักสูตร (Course Promotion Campaign)
              </h2>
              <p className="text-xs text-slate-500 truncate">
                {selectedCourse
                  ? `${selectedCourse.title} · Campaign ID: ${campaignId}`
                  : "เลือกหลักสูตรเพื่อสร้างหรือจัดการแคมเปญประชาสัมพันธ์"}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isDispatching}
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40"
            title="ปิดหน้าต่าง"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Stepper Bar */}
        <nav className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2 overflow-x-auto shrink-0">
          {STEP_LABELS.map((item) => {
            const isActive = step === item.step;
            const isCompleted = step > item.step;
            const canClick =
              !isDispatching &&
              (item.step === 1 ||
                Boolean(selectedCourse) &&
                  (item.step !== 6 || Boolean(campaignDoc)));
            return (
              <button
                key={item.step}
                type="button"
                disabled={!canClick}
                onClick={() => canClick && setStep(item.step)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-[#8b0000] text-white"
                    : isCompleted
                    ? "bg-white text-slate-800 border border-slate-300 hover:bg-slate-100"
                    : "text-slate-500 hover:bg-white/60 disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums ${
                    isActive
                      ? "bg-white text-[#8b0000]"
                      : isCompleted
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {isCompleted ? <Check className="w-3 h-3" /> : item.step}
                </span>
                <span>{item.labelTh}</span>
              </button>
            );
          })}
        </nav>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* STEP 1: SELECT COURSE */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">ขั้นตอนที่ 1: เลือกหลักสูตรที่ต้องการประชาสัมพันธ์</h3>
                  <p className="text-sm text-slate-500">
                    เลือกจากหลักสูตรที่บันทึกไว้ในระบบ ลิงก์ลงทะเบียนจะเชื่อมไปยังหน้าลงทะเบียนจริงอัตโนมัติ
                  </p>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={courseSearch}
                    onChange={(e) => setCourseSearch(e.target.value)}
                    placeholder="ค้นหาชื่อหลักสูตร / วิทยากร..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30 focus:border-[#8b0000]"
                  />
                </div>
              </div>

              {loadingCourses ? (
                <div className="py-16 flex flex-col items-center gap-3 text-slate-500">
                  <Loader2 className="w-8 h-8 animate-spin text-[#8b0000]" />
                  <span className="text-sm">กำลังโหลดรายการหลักสูตร...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {courses
                    .filter((c) => {
                      const q = courseSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        (c.title || "").toLowerCase().includes(q) ||
                        (c.instructorName || "").toLowerCase().includes(q)
                      );
                    })
                    .map((c) => {
                      const langCode = resolveInitialCampaignLanguage(c);
                      const isSel = selectedCourse?.id === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectCourse(c)}
                          className={`text-left p-4 rounded-xl border transition-all flex items-start gap-4 ${
                            isSel
                              ? "border-[#8b0000] bg-red-50/40 ring-2 ring-[#8b0000]/20"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60"
                          }`}
                        >
                          <div className="w-16 h-16 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                            {c.bannerImageBase64 || c.imageUrl ? (
                              <img
                                src={c.bannerImageBase64 || c.imageUrl}
                                alt={c.title}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <ImageIcon className="w-6 h-6 text-slate-300" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 uppercase">
                                {langCode === "en" ? "EN" : "TH"}
                              </span>
                              <span
                                className={`text-[11px] font-semibold ${
                                  c.isVisible === false ? "text-amber-600" : "text-emerald-700"
                                }`}
                              >
                                {c.isVisible === false ? "Hidden" : "Public"}
                              </span>
                            </div>
                            <div className="font-bold text-slate-900 text-sm line-clamp-2">{c.title}</div>
                            <div className="text-xs text-slate-500 mt-1 truncate">
                              {c.date} · {c.instructorName || "LDO"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: BILINGUAL TEMPLATE & POSTER */}
          {step === 2 && selectedCourse && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left: Bilingual Copy */}
              <div className="lg:col-span-7 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      ขั้นตอนที่ 2: กำหนดเทมเพลตอีเมลและโปสเตอร์
                    </h3>
                    <p className="text-xs text-slate-500">
                      แก้ไขข้อความเฉพาะแคมเปญนี้ได้โดยไม่กระทบข้อมูลหลักสูตรต้นฉบับ
                    </p>
                  </div>
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => handleLanguageChange("th")}
                      className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${
                        campaignLanguage === "th"
                          ? "bg-[#8b0000] text-white"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      ภาษาไทย (TH)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLanguageChange("en")}
                      className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${
                        campaignLanguage === "en"
                          ? "bg-[#8b0000] text-white"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      English (EN)
                    </button>
                  </div>
                </div>

                {/* Published Registration Link Box */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-[#8b0000]" />
                      Published Public Portal Base URL (ใช้สร้างลิงก์ปุ่มลงทะเบียน)
                    </label>
                    {baseAppUrlValidation.valid ? (
                      <span className="text-[11px] font-semibold text-emerald-700">Valid HTTPS URL</span>
                    ) : (
                      <span className="text-[11px] font-semibold text-red-600">Invalid URL</span>
                    )}
                  </div>
                  <input
                    type="url"
                    value={baseAppUrl}
                    onChange={(e) => setBaseAppUrl(e.target.value)}
                    placeholder="https://butraining.netlify.app"
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                  />
                  {registrationUrl ? (
                    <div className="text-[11px] text-slate-600 break-all">
                      ลิงก์ปลายทางปุ่ม CTA: <span className="font-mono text-[#8b0000]">{registrationUrl}</span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-red-600">{baseAppUrlValidation.reason}</div>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">หัวข้ออีเมล (Subject)</label>
                    <input
                      type="text"
                      value={template.subject}
                      onChange={(e) => setTemplate({ ...template, subject: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">คำขึ้นต้น (Greeting Prefix)</label>
                      <input
                        type="text"
                        value={template.greetingPrefix}
                        onChange={(e) => setTemplate({ ...template, greetingPrefix: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        คำแทนผู้รับกรณีไม่มีชื่อ (Fallback Name)
                      </label>
                      <input
                        type="text"
                        value={template.neutralGreetingName}
                        onChange={(e) => setTemplate({ ...template, neutralGreetingName: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">หัวเรื่องแบนเนอร์ (Header Headline)</label>
                    <input
                      type="text"
                      value={template.headline}
                      onChange={(e) => setTemplate({ ...template, headline: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">ข้อความเชิญชวน (Invitation Message)</label>
                    <textarea
                      rows={3}
                      value={template.invitationMessage}
                      onChange={(e) => setTemplate({ ...template, invitationMessage: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={template.includeDescription}
                        onChange={(e) => setTemplate({ ...template, includeDescription: e.target.checked })}
                        className="rounded border-slate-300 text-[#8b0000] focus:ring-[#8b0000]"
                      />
                      แสดงรายละเอียดหลักสูตรในอีเมล
                    </label>
                    {template.includeDescription && (
                      <textarea
                        rows={3}
                        value={template.customDescription ?? selectedCourse.description ?? ""}
                        onChange={(e) => setTemplate({ ...template, customDescription: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">ข้อความปุ่มลงทะเบียน (CTA Label)</label>
                      <input
                        type="text"
                        value={template.ctaLabel}
                        onChange={(e) => setTemplate({ ...template, ctaLabel: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">ลายเซ็นผู้ส่ง (Signature)</label>
                      <input
                        type="text"
                        value={template.signatureTitle}
                        onChange={(e) => setTemplate({ ...template, signatureTitle: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Course Promotional Poster */}
              <div className="lg:col-span-5 space-y-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-[#8b0000]" />
                      โปสเตอร์ประชาสัมพันธ์หลักสูตร
                    </h4>
                    <button
                      type="button"
                      onClick={handleReuseCoursePoster}
                      className="text-xs font-semibold text-[#8b0000] hover:underline"
                    >
                      ใช้ภาพเดิมของหลักสูตร
                    </button>
                  </div>

                  {isPosterMissingWarning && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block">ยังไม่มีภาพโปสเตอร์ในอีเมลนี้</span>
                        <span>
                          สามารถส่งได้โดยไม่มีรูปภาพ หรืออัปโหลดโปสเตอร์ใหม่ด้านล่าง (ระบบจะแนบแบบ Inline CID เพื่อลดขนาด HTML)
                        </span>
                      </div>
                    </div>
                  )}

                  {posterWarning && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{posterWarning}</span>
                    </div>
                  )}

                  {/* Poster Preview Frame */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden min-h-[180px] flex items-center justify-center p-2">
                    {previewPosterSrc ? (
                      <img
                        src={previewPosterSrc}
                        alt={selectedCourse.title}
                        className="max-h-64 w-auto rounded-lg object-contain"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="text-center py-8 text-slate-400">
                        <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-xs">ยังไม่มีรูปโปสเตอร์</p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputPosterRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={handlePosterFileChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={posterUploading}
                      onClick={() => fileInputPosterRef.current?.click()}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#8b0000] hover:bg-[#6e0000] text-white text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {posterUploading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      อัปโหลดโปสเตอร์ (PNG/JPG/WebP)
                    </button>
                    {poster.mode !== "none" && (
                      <button
                        type="button"
                        onClick={() => {
                          setPoster({ mode: "none" });
                          setExternalPosterInput("");
                        }}
                        className="px-3 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-xs font-semibold"
                      >
                        นำภาพออก
                      </button>
                    )}
                  </div>

                  {poster.mode === "inline_cid" && (
                    <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      โหมดส่งภาพ: <span className="font-bold">Inline CID Attachment (`cid:coursePoster`)</span> ·{" "}
                      {poster.width ? `${poster.width}x${poster.height}px · ` : ""}
                      {poster.byteSize ? `${Math.round(poster.byteSize / 1024)} KB` : ""}
                    </div>
                  )}

                  {/* Optional Public HTTPS URL Input */}
                  <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <LinkIcon className="w-3.5 h-3.5" />
                      หรือระบุ Public HTTPS Image URL (ไม่อนุญาตลิงก์ Google Drive ส่วนตัว)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={externalPosterInput}
                        onChange={(e) => setExternalPosterInput(e.target.value)}
                        placeholder="https://example.com/poster.jpg"
                        className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                      />
                      <button
                        type="button"
                        onClick={handleApplyExternalPosterUrl}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700"
                      >
                        ใช้ URL นี้
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: BULK RECIPIENT SELECTION & VALIDATION */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  ขั้นตอนที่ 3: เลือกและตรวจสอบรายชื่อผู้รับอีเมล (@bu.ac.th)
                </h3>
                <p className="text-xs text-slate-500">
                  รองรับการวางอีเมลจำนวนมาก นำเข้าจากไฟล์ CSV (UTF-8 / BOM) หรือเลือกจากรายชื่ออาจารย์ — ระบบจะไม่เลือกรายชื่อให้อัตโนมัติ
                </p>
              </div>

              {/* 3 Source Selector Tabs */}
              <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                <div className="flex border-b border-slate-200 bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setRecipientSourceTab("paste")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                      recipientSourceTab === "paste"
                        ? "border-[#8b0000] text-[#8b0000] bg-white"
                        : "border-transparent text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <ClipboardPaste className="w-4 h-4" />
                    วางรายชื่ออีเมล (Paste 1,000+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecipientSourceTab("csv")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                      recipientSourceTab === "csv"
                        ? "border-[#8b0000] text-[#8b0000] bg-white"
                        : "border-transparent text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    นำเข้าไฟล์ CSV (UTF-8 / BOM)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecipientSourceTab("instructor")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                      recipientSourceTab === "instructor"
                        ? "border-[#8b0000] text-[#8b0000] bg-white"
                        : "border-transparent text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    เลือกจากข้อมูลอาจารย์ ({instructors.length})
                  </button>
                </div>

                <div className="p-4">
                  {/* Source 1: Bulk Paste */}
                  {recipientSourceTab === "paste" && (
                    <div className="space-y-3">
                      <textarea
                        rows={5}
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        placeholder={
                          "วางรายชื่ออีเมลคั่นด้วย Enter, คอมมา (,), เซมิโคลอน (;) หรือช่องว่าง เช่น\nsomchai.k@bu.ac.th\nDr. Somying S. <somying.s@bu.ac.th>, teacher@bu.ac.th"
                        }
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleAddPastedEmails}
                          className="px-4 py-2 rounded-lg bg-[#8b0000] hover:bg-[#6e0000] text-white text-xs font-bold transition-colors"
                        >
                          เพิ่มรายชื่อจากข้อความ
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Source 2: CSV Upload + Preview Before Import */}
                  {recipientSourceTab === "csv" && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-slate-600">
                          รองรับไฟล์ CSV (UTF-8 และ UTF-8 BOM) หัวตารางเช่น <span className="font-mono">email, name, department</span> หรือ{" "}
                          <span className="font-mono">อีเมล, ชื่อ-นามสกุล, หน่วยงาน</span>
                        </p>
                        <input
                          ref={fileInputCsvRef}
                          type="file"
                          accept=".csv,text/csv"
                          onChange={handleCsvFileUpload}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputCsvRef.current?.click()}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
                        >
                          <Upload className="w-4 h-4 text-[#8b0000]" />
                          เลือกไฟล์ CSV เพื่อดูตัวอย่าง
                        </button>
                      </div>

                      {csvPreview && (
                        <div className="border border-slate-200 rounded-lg bg-slate-50 p-3 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-slate-700">
                              พบข้อมูล <span className="font-bold tabular-nums">{csvPreview.totalRawRows}</span> แถว ·
                              คอลัมน์อีเมล:{" "}
                              <span className="font-mono font-bold">
                                {csvPreview.detectedColumns.emailColumn || "ไม่พบ"}
                              </span>
                              {csvPreview.detectedColumns.nameColumn && (
                                <>
                                  {" · "}ชื่อ: <span className="font-mono">{csvPreview.detectedColumns.nameColumn}</span>
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setCsvPreview(null)}
                                className="px-3 py-1 rounded border border-slate-300 bg-white text-xs text-slate-600"
                              >
                                ยกเลิก
                              </button>
                              <button
                                type="button"
                                disabled={!csvPreview.detectedColumns.emailColumn || csvPreview.rows.length === 0}
                                onClick={handleConfirmCsvImport}
                                className="px-3 py-1 rounded bg-[#8b0000] text-white text-xs font-bold disabled:opacity-40"
                              >
                                ยืนยันนำเข้า {csvPreview.rows.length} แถว
                              </button>
                            </div>
                          </div>

                          {csvPreview.warnings.length > 0 && (
                            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                              {csvPreview.warnings.join(" | ")}
                            </div>
                          )}

                          <div className="max-h-48 overflow-y-auto bg-white border border-slate-200 rounded">
                            <table className="w-full text-xs">
                              <thead className="bg-slate-100 text-slate-600 sticky top-0">
                                <tr>
                                  <th className="text-left px-3 py-1.5">#</th>
                                  <th className="text-left px-3 py-1.5">Email</th>
                                  <th className="text-left px-3 py-1.5">ชื่อ</th>
                                  <th className="text-left px-3 py-1.5">คณะ/หน่วยงาน</th>
                                  <th className="text-left px-3 py-1.5">โดเมน</th>
                                </tr>
                              </thead>
                              <tbody>
                                {csvPreview.rows.slice(0, 50).map((row) => (
                                  <tr key={row.rowIndex} className="border-t border-slate-100">
                                    <td className="px-3 py-1.5 text-slate-400 tabular-nums">{row.rowIndex}</td>
                                    <td className="px-3 py-1.5 font-mono text-slate-800">{row.email}</td>
                                    <td className="px-3 py-1.5 text-slate-700">{row.name || "-"}</td>
                                    <td className="px-3 py-1.5 text-slate-500">{row.department || "-"}</td>
                                    <td className="px-3 py-1.5">
                                      {row.isValidDomain ? (
                                        <span className="text-emerald-700 font-semibold">@bu.ac.th</span>
                                      ) : (
                                        <span className="text-red-600 font-semibold">ไม่ผ่านโดเมน</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Source 3: Instructor Directory Search & Explicit Multi-Select */}
                  {recipientSourceTab === "instructor" && (
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={instructorSearch}
                            onChange={(e) => setInstructorSearch(e.target.value)}
                            placeholder="ค้นหาชื่ออาจารย์ / รหัส / อีเมล..."
                            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                          />
                        </div>
                        <select
                          value={instructorDeptFilter}
                          onChange={(e) => setInstructorDeptFilter(e.target.value)}
                          className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="ALL">ทุกคณะ / หน่วยงาน ({instructors.length})</option>
                          {instructorDepartments.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const next = new Set(selectedInstructorIds);
                              filteredInstructors.forEach((i) => next.add(i.id || i.email));
                              setSelectedInstructorIds(next);
                            }}
                            className="px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50 font-semibold text-slate-700"
                          >
                            เลือกที่กรองอยู่ ({filteredInstructors.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedInstructorIds(new Set())}
                            className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-500"
                          >
                            ล้างที่เลือก
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={selectedInstructorIds.size === 0}
                          onClick={handleAddSelectedInstructors}
                          className="px-3.5 py-1.5 rounded-lg bg-[#8b0000] hover:bg-[#6e0000] text-white font-bold disabled:opacity-40"
                        >
                          เพิ่มอาจารย์ที่เลือก ({selectedInstructorIds.size})
                        </button>
                      </div>

                      <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                        {loadingInstructors ? (
                          <div className="p-6 text-center text-xs text-slate-400">กำลังโหลดข้อมูลอาจารย์...</div>
                        ) : filteredInstructors.length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-400">ไม่พบข้อมูลอาจารย์ตามคำค้น</div>
                        ) : (
                          filteredInstructors.slice(0, 200).map((inst) => {
                            const key = inst.id || inst.email;
                            const checked = selectedInstructorIds.has(key);
                            return (
                              <label
                                key={key}
                                className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = new Set(selectedInstructorIds);
                                    if (checked) next.delete(key);
                                    else next.add(key);
                                    setSelectedInstructorIds(next);
                                  }}
                                  className="rounded border-slate-300 text-[#8b0000]"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="font-semibold text-slate-800 truncate">
                                    {inst.name}{" "}
                                    {inst.englishFullName && (
                                      <span className="text-slate-400 font-normal">({inst.englishFullName})</span>
                                    )}
                                  </div>
                                  <div className="text-slate-500 truncate">
                                    <span className="font-mono">{inst.email}</span> · {inst.department}
                                  </div>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Validation Summary Strip (Zero-pill crisp tabular layout) */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <div className="text-[11px] font-semibold text-slate-500">นำเข้าทั้งหมด</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
                    {reconciliation.stats.totalImported}
                  </div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <div className="text-[11px] font-semibold text-slate-500">ไม่ซ้ำที่ถูกต้อง</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
                    {reconciliation.stats.uniqueValid}
                  </div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <div className="text-[11px] font-semibold text-slate-500">ตัดรายการซ้ำ</div>
                  <div className="text-xl font-bold text-amber-700 tabular-nums mt-0.5">
                    {reconciliation.stats.duplicateCount}
                  </div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <div className="text-[11px] font-semibold text-slate-500">ไม่ถูกต้อง / นอก BU</div>
                  <div className="text-xl font-bold text-red-600 tabular-nums mt-0.5">
                    {reconciliation.stats.invalidCount}
                  </div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <div className="text-[11px] font-semibold text-slate-500">งดรับข่าวสาร</div>
                  <div className="text-xl font-bold text-slate-600 tabular-nums mt-0.5">
                    {reconciliation.stats.suppressedCount}
                  </div>
                </div>
                <div className="p-3 rounded-xl border border-[#8b0000]/30 bg-red-50/40">
                  <div className="text-[11px] font-bold text-[#8b0000]">พร้อมจัดส่งจริง</div>
                  <div className="text-xl font-bold text-[#8b0000] tabular-nums mt-0.5">
                    {reconciliation.stats.eligibleCount}
                  </div>
                </div>
              </div>

              {/* Reconciled Recipients Table */}
              <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        { id: "eligible", label: `พร้อมส่ง (${reconciliation.eligible.length})` },
                        { id: "duplicate", label: `ซ้ำ (${reconciliation.duplicates.length})` },
                        { id: "invalid", label: `ไม่ถูกต้อง (${reconciliation.invalid.length})` },
                        { id: "suppressed", label: `Suppression (${reconciliation.suppressed.length})` },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setRecipientInspectTab(tab.id)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                          recipientInspectTab === tab.id
                            ? "bg-slate-900 text-white"
                            : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    {recipientInspectTab === "eligible" && (
                      <input
                        type="text"
                        value={eligibleSearch}
                        onChange={(e) => setEligibleSearch(e.target.value)}
                        placeholder="กรองรายชื่อ..."
                        className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                      />
                    )}
                    {rawCandidates.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setRawCandidates([])}
                        className="text-xs font-semibold text-red-600 hover:underline px-2"
                      >
                        ล้างรายชื่อทั้งหมด
                      </button>
                    )}
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto">
                  {recipientInspectTab === "eligible" ? (
                    reconciliation.eligible.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400">
                        ยังไม่มีรายชื่อผู้รับที่พร้อมจัดส่ง กรุณาวางอีเมล นำเข้า CSV หรือเลือกอาจารย์ด้านบน
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-slate-500 sticky top-0 border-b border-slate-200">
                          <tr>
                            <th className="text-left px-3 py-2">#</th>
                            <th className="text-left px-3 py-2">Email</th>
                            <th className="text-left px-3 py-2">ชื่อผู้รับ</th>
                            <th className="text-left px-3 py-2">หน่วยงาน</th>
                            <th className="text-left px-3 py-2">ที่มา</th>
                            <th className="text-right px-3 py-2">ลบ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {reconciliation.eligible
                            .filter((r) => {
                              const q = eligibleSearch.trim().toLowerCase();
                              if (!q) return true;
                              return (
                                r.email.includes(q) ||
                                r.name.toLowerCase().includes(q) ||
                                r.department.toLowerCase().includes(q)
                              );
                            })
                            .slice(0, 250)
                            .map((r, idx) => (
                              <tr key={r.id}>
                                <td className="px-3 py-1.5 text-slate-400 tabular-nums">{idx + 1}</td>
                                <td className="px-3 py-1.5 font-mono text-slate-800">{r.email}</td>
                                <td className="px-3 py-1.5 text-slate-700">{r.name || "-"}</td>
                                <td className="px-3 py-1.5 text-slate-500">{r.department || "-"}</td>
                                <td className="px-3 py-1.5 text-slate-400 uppercase">{r.source}</td>
                                <td className="px-3 py-1.5 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveEligibleRecipient(r.email)}
                                    className="text-slate-400 hover:text-red-600 p-1"
                                    title="นำออกจากแคมเปญ"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500 sticky top-0 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-3 py-2">ข้อมูลต้นทาง</th>
                          <th className="text-left px-3 py-2">ที่มา</th>
                          <th className="text-left px-3 py-2">เหตุผล</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(recipientInspectTab === "duplicate"
                          ? reconciliation.duplicates
                          : recipientInspectTab === "invalid"
                          ? reconciliation.invalid
                          : reconciliation.suppressed
                        )
                          .slice(0, 200)
                          .map((item, i) => (
                            <tr key={`${item.rawInput}_${i}`}>
                              <td className="px-3 py-1.5 font-mono text-slate-800">{item.rawInput || item.email}</td>
                              <td className="px-3 py-1.5 text-slate-400 uppercase">{item.source}</td>
                              <td className="px-3 py-1.5 text-slate-600">{item.detail}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: PREVIEW (DESKTOP/MOBILE) & TEST SEND */}
          {step === 4 && selectedCourse && renderedPreview && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left: Live Sandboxed Preview */}
              <div className="lg:col-span-8 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">ขั้นตอนที่ 4: พรีวิวอีเมลและทดสอบส่ง [TEST]</h3>
                    <p className="text-xs text-slate-500">หัวข้อ: {renderedPreview.subject}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                      <button
                        type="button"
                        onClick={() => setPreviewGreetingMode("personalized")}
                        className={`px-2.5 py-1 rounded text-xs font-semibold ${
                          previewGreetingMode === "personalized" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500"
                        }`}
                      >
                        ทักทายรายบุคคล
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewGreetingMode("neutral")}
                        className={`px-2.5 py-1 rounded text-xs font-semibold ${
                          previewGreetingMode === "neutral" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500"
                        }`}
                      >
                        คำกลาง (Fallback)
                      </button>
                    </div>
                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                      <button
                        type="button"
                        onClick={() => setPreviewMode("desktop")}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold ${
                          previewMode === "desktop" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500"
                        }`}
                      >
                        <Monitor className="w-3.5 h-3.5" /> Desktop
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode("mobile")}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold ${
                          previewMode === "mobile" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500"
                        }`}
                      >
                        <Smartphone className="w-3.5 h-3.5" /> Mobile
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewFormat(previewFormat === "html" ? "text" : "html")}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {previewFormat === "html" ? "ดู Plain-Text" : "ดู HTML"}
                    </button>
                  </div>
                </div>

                <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 flex justify-center overflow-x-auto">
                  {previewFormat === "html" ? (
                    <iframe
                      title="Course Promotion Email Preview"
                      srcDoc={renderedPreview.htmlBody}
                      sandbox=""
                      className={`bg-white rounded-lg border border-slate-200 shadow-sm transition-all ${
                        previewMode === "mobile" ? "w-[375px]" : "w-full max-w-[660px]"
                      } h-[560px]`}
                    />
                  ) : (
                    <pre className="w-full max-w-[660px] h-[560px] overflow-y-auto bg-white p-5 rounded-lg border border-slate-200 text-xs font-mono text-slate-800 whitespace-pre-wrap">
                      {renderedPreview.textBody}
                    </pre>
                  )}
                </div>
              </div>

              {/* Right: Test Send Card */}
              <div className="lg:col-span-4 space-y-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-4">
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                    <Send className="w-4 h-4 text-[#8b0000]" />
                    ส่งอีเมลทดสอบเฉพาะผู้ดูแลระบบ
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    ระบบจะเติมคำนำหน้า <span className="font-mono font-bold">[TEST]</span> และแบนเนอร์ทดสอบให้อัตโนมัติ
                    และ<strong>ไม่มีผล</strong>ต่อจำนวนหรือสถานะผู้รับจริงของแคมเปญ
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        อีเมลผู้รับทดสอบ (@bu.ac.th)
                      </label>
                      <input
                        type="email"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                        placeholder="admin@bu.ac.th"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        ชื่อผู้รับสำหรับทดสอบ (ถ้ามี)
                      </label>
                      <input
                        type="text"
                        value={testName}
                        onChange={(e) => setTestName(e.target.value)}
                        placeholder="เว้นว่างเพื่อทดสอบคำทักทายกลาง"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={sendingTest || !registrationUrl}
                      onClick={handleSendTest}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors disabled:opacity-50"
                    >
                      {sendingTest ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      ส่งอีเมลทดสอบ [TEST]
                    </button>

                    {testResultMsg && (
                      <div
                        className={`p-3 rounded-lg text-xs border ${
                          testResultMsg.ok
                            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                            : "bg-red-50 border-red-200 text-red-700"
                        }`}
                      >
                        {testResultMsg.text}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: EXPLICIT ADMIN CONFIRMATION & BATCH DISPATCH */}
          {step === 5 && selectedCourse && (
            <div className="space-y-5 max-w-4xl mx-auto">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  ขั้นตอนที่ 5: ตรวจสอบสรุป ยืนยัน และส่งอีเมลแบบแบ่งชุด (Batch Dispatch)
                </h3>
                <p className="text-xs text-slate-500">
                  ระบบบันทึกผู้รับทุกท่านลงฐานข้อมูลก่อนส่ง และส่งแบบ 1 ต่อ 1 ทีละชุดเพื่อความปลอดภัยและความถูกต้องของโควตา
                </p>
              </div>

              {/* Campaign Preflight Summary */}
              <div className="p-5 rounded-xl border border-slate-200 bg-white grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-2">
                  <div>
                    <span className="text-slate-500 block">หลักสูตรเป้าหมาย</span>
                    <span className="font-bold text-slate-900 text-sm">{selectedCourse.title}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">ภาษา & หัวข้ออีเมล</span>
                    <span className="font-semibold text-slate-800">
                      [{campaignLanguage.toUpperCase()}] {template.subject}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">ลิงก์ปุ่มลงทะเบียนที่ใช้งานจริง</span>
                    <span className="font-mono text-[#8b0000] break-all">{registrationUrl || "ไม่ถูกต้อง"}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                    <span className="text-slate-500">ผู้รับที่พร้อมจัดส่ง</span>
                    <span className="text-base font-bold text-[#8b0000] tabular-nums">
                      {campaignDoc && campaignRecipients.length > 0 && rawCandidates.length === 0
                        ? campaignDoc.pendingCount
                        : reconciliation.stats.eligibleCount}{" "}
                      รายชื่อ
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                    <span className="text-slate-500">โหมดโปสเตอร์</span>
                    <span className="font-semibold text-slate-800">
                      {poster.mode === "inline_cid"
                        ? "แนบไฟล์ Inline CID"
                        : poster.mode === "none"
                        ? "ไม่มีรูปโปสเตอร์"
                        : "Public HTTPS URL"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">ขนาดต่อรอบการส่ง (Batch Size)</span>
                    <select
                      value={batchSize}
                      disabled={isDispatching}
                      onChange={(e) => setBatchSize(Math.min(MAX_PROMOTION_BATCH_SIZE, Number(e.target.value)))}
                      className="px-2.5 py-1 border border-slate-300 rounded bg-white font-semibold tabular-nums"
                    >
                      <option value={10}>10 ฉบับ / รอบ</option>
                      <option value={20}>20 ฉบับ / รอบ (แนะนำ)</option>
                      <option value={25}>25 ฉบับ / รอบ (สูงสุด)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* MailApp Daily Quota Banner */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs">
                  <div className="font-bold text-slate-800">โควตาการส่งอีเมลรายวัน Google Apps Script (MailApp)</div>
                  <div className="text-slate-600 mt-0.5">
                    {remainingQuota !== null ? (
                      <>
                        คงเหลือวันนี้:{" "}
                        <span className="font-bold text-slate-900 tabular-nums">{remainingQuota}</span> ฉบับ
                      </>
                    ) : quotaError ? (
                      <span className="text-amber-700">{quotaError}</span>
                    ) : (
                      "กดปุ่มด้านขวาเพื่อตรวจสอบโควตาล่าสุดจาก Google Apps Script"
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={quotaLoading || isDispatching}
                  onClick={refreshQuota}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${quotaLoading ? "animate-spin" : ""}`} />
                  เช็คโควตา MailApp
                </button>
              </div>

              {remainingQuota !== null &&
                remainingQuota <
                  (campaignDoc && campaignRecipients.length > 0 && rawCandidates.length === 0
                    ? campaignDoc.pendingCount
                    : reconciliation.stats.eligibleCount) && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block">โควตารายวันคงเหลือน้อยกว่าจำนวนผู้รับทั้งหมด</span>
                      ระบบจะส่งเท่าที่โควตาวันนี้รองรับ และคงรายชื่อที่เหลือไว้ในสถานะ <span className="font-mono font-bold">pending</span> เพื่อส่งต่อได้ในวันถัดไปโดยไม่ส่งซ้ำ
                    </div>
                  </div>
                )}

              {posterWarning && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{posterWarning}</span>
                </div>
              )}

              {/* Explicit Admin Confirmation */}
              <label className="flex items-start gap-3 p-4 rounded-xl border border-slate-300 bg-white cursor-pointer hover:bg-slate-50/50">
                <input
                  type="checkbox"
                  checked={adminConfirmed}
                  disabled={isDispatching}
                  onChange={(e) => setAdminConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-400 text-[#8b0000] focus:ring-[#8b0000]"
                />
                <div className="text-xs text-slate-700 leading-relaxed">
                  <span className="font-bold text-slate-900 block">
                    ข้าพเจ้าในฐานะผู้ดูแลระบบยืนยันการส่งอีเมลประชาสัมพันธ์แคมเปญนี้
                  </span>
                  ตรวจสอบหัวข้อ เนื้อหา ลิงก์ลงทะเบียน และรายชื่อผู้รับ @bu.ac.th ครบถ้วนแล้ว (หากปิดแท็บเบราว์เซอร์ระหว่างส่ง รายชื่อที่เหลือจะถูกคงไว้ในฐานข้อมูลเพื่อส่งต่อภายหลังได้)
                </div>
              </label>

              {/* Progress / Dispatch Status */}
              {dispatchLog && (
                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                    <span className="flex items-center gap-2">
                      {isDispatching && <Loader2 className="w-4 h-4 animate-spin text-[#8b0000]" />}
                      {dispatchLog}
                    </span>
                    {campaignDoc && (
                      <span className="tabular-nums text-slate-600">
                        ส่งแล้ว {campaignDoc.sentCount}/{campaignDoc.totalRecipients}
                      </span>
                    )}
                  </div>
                  {campaignDoc && campaignDoc.totalRecipients > 0 && (
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#8b0000] transition-all"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(((campaignDoc.sentCount + campaignDoc.failedCount + campaignDoc.skippedCount) / campaignDoc.totalRecipients) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={isDispatching || isSavingCampaign || !registrationUrl}
                  onClick={handleSaveDraftOnly}
                  className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 disabled:opacity-40"
                >
                  {isSavingCampaign ? "กำลังบันทึก..." : "บันทึกฉบับร่างไว้ก่อน"}
                </button>

                {isDispatching ? (
                  <button
                    type="button"
                    onClick={() => {
                      pauseRequestedRef.current = true;
                    }}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
                  >
                    <PauseCircle className="w-4 h-4" />
                    หยุดส่งชั่วคราวหลังจบรอบนี้
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={
                      !adminConfirmed ||
                      !registrationUrl ||
                      !hasEligibleOrSavedRecipients
                    }
                    onClick={handleStartConfirmedDispatch}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#8b0000] hover:bg-[#6e0000] text-white text-xs font-bold shadow-sm transition-colors disabled:opacity-40"
                  >
                    <Play className="w-4 h-4" />
                    {campaignDoc && campaignDoc.pendingCount > 0 && campaignDoc.sentCount > 0
                      ? "ส่งผู้รับที่ค้างอยู่ต่อ (Resume Confirmed Batch)"
                      : "ยืนยันและเริ่มส่งอีเมลแคมเปญ"}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP 6: DELIVERY RESULTS REVIEW & UNKNOWN MANAGEMENT */}
          {step === 6 && campaignDoc && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">ขั้นตอนที่ 6: รายงานผลลัพธ์การจัดส่งและติดตามสถานะ</h3>
                  <p className="text-xs text-slate-500">
                    อัปเดตล่าสุด:{" "}
                    {campaignDoc.lastProcessedAt
                      ? new Date(campaignDoc.lastProcessedAt).toLocaleString("th-TH")
                      : "ยังไม่เริ่มประมวลผล"}{" "}
                    {typeof campaignDoc.remainingQuota === "number" && (
                      <>· โควตา MailApp คงเหลือ: <span className="font-bold tabular-nums">{campaignDoc.remainingQuota}</span></>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={loadingResults}
                    onClick={() => loadCampaignResultsFromFirestore(campaignDoc.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingResults ? "animate-spin" : ""}`} />
                    รีเฟรช
                  </button>
                  <button
                    type="button"
                    onClick={handleExportResultsCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
                  >
                    <Download className="w-3.5 h-3.5" />
                    ส่งออกผลลัพธ์ CSV
                  </button>
                  {campaignDoc.pendingCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setStep(5)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#8b0000] hover:bg-[#6e0000] text-white text-xs font-bold"
                    >
                      <Play className="w-3.5 h-3.5" />
                      ส่งที่เหลือต่อ ({campaignDoc.pendingCount})
                    </button>
                  )}
                </div>
              </div>

              {/* Authoritative Metric Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <div className="text-[11px] text-slate-500 font-semibold">ผู้รับทั้งหมด</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">{campaignDoc.totalRecipients}</div>
                </div>
                <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40">
                  <div className="text-[11px] text-emerald-800 font-semibold">ส่งเข้า MailApp แล้ว</div>
                  <div className="text-xl font-bold text-emerald-700 tabular-nums mt-0.5">{campaignDoc.sentCount}</div>
                  <div className="text-[10px] text-emerald-700/80">Accepted by mail service</div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <div className="text-[11px] text-slate-500 font-semibold">รอจัดส่ง (Pending)</div>
                  <div className="text-xl font-bold text-slate-800 tabular-nums mt-0.5">{campaignDoc.pendingCount}</div>
                </div>
                <div className="p-3 rounded-xl border border-red-200 bg-red-50/40">
                  <div className="text-[11px] text-red-700 font-semibold">ส่งไม่สำเร็จ (Failed)</div>
                  <div className="text-xl font-bold text-red-600 tabular-nums mt-0.5">{campaignDoc.failedCount}</div>
                </div>
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/40">
                  <div className="text-[11px] text-amber-800 font-semibold">รอตรวจสอบ (Unknown)</div>
                  <div className="text-xl font-bold text-amber-700 tabular-nums mt-0.5">{campaignDoc.unknownCount}</div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                  <div className="text-[11px] text-slate-500 font-semibold">ถูกข้าม / งดรับ</div>
                  <div className="text-xl font-bold text-slate-600 tabular-nums mt-0.5">
                    {campaignDoc.skippedCount + campaignDoc.suppressedCount}
                  </div>
                </div>
              </div>

              {/* Explicit Unknown Review Panel */}
              {unknownRecipients.length > 0 && (
                <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 space-y-3">
                  <div className="flex items-start gap-2.5 text-amber-900">
                    <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-xs leading-relaxed">
                      <span className="font-bold text-sm block">
                        พบรายชื่อสถานะ Unknown จำนวน {unknownRecipients.length} รายการ (ต้องให้ Admin ตรวจสอบก่อนส่งซ้ำ)
                      </span>
                      รายการเหล่านี้เกิดจากการเชื่อมต่อขัดข้อง/Timeout หลังคำขอส่งถูกส่งออกไปแล้ว ระบบจึง<strong>ไม่ส่งซ้ำอัตโนมัติ</strong>เพื่อป้องกันการส่งอีเมลซ้ำซ้อน
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedUnknownIds(new Set(unknownRecipients.map((u) => u.id)))}
                      className="px-2.5 py-1 rounded border border-amber-400 bg-white text-xs font-semibold text-amber-900"
                    >
                      เลือก Unknown ทั้งหมด ({unknownRecipients.length})
                    </button>
                    <input
                      type="text"
                      value={unknownAdminNote}
                      onChange={(e) => setUnknownAdminNote(e.target.value)}
                      placeholder="ระบุผลการตรวจสอบของ Admin (เช่น ตรวจสอบใน Sent Mail แล้วไม่พบ)..."
                      className="flex-1 min-w-[220px] px-3 py-1.5 text-xs border border-amber-300 rounded-lg bg-white"
                    />
                    <button
                      type="button"
                      disabled={resolvingUnknown || selectedUnknownIds.size === 0}
                      onClick={() => handleResolveUnknown("pending")}
                      className="px-3 py-1.5 rounded-lg bg-[#8b0000] text-white text-xs font-bold disabled:opacity-40"
                    >
                      คืนสถานะ Pending เพื่อส่งใหม่
                    </button>
                    <button
                      type="button"
                      disabled={resolvingUnknown || selectedUnknownIds.size === 0}
                      onClick={() => handleResolveUnknown("sent")}
                      className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold disabled:opacity-40"
                    >
                      ยืนยันว่าส่งแล้ว
                    </button>
                    <button
                      type="button"
                      disabled={resolvingUnknown || selectedUnknownIds.size === 0}
                      onClick={() => handleResolveUnknown("skipped")}
                      className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-xs font-bold disabled:opacity-40"
                    >
                      ข้ามรายการนี้
                    </button>
                  </div>
                </div>
              )}

              {/* Delivery Table Filters */}
              <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(["all", "sent", "pending", "failed", "unknown", "skipped"] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setResultsStatusFilter(st)}
                        className={`px-2.5 py-1 rounded text-xs font-semibold uppercase ${
                          resultsStatusFilter === st
                            ? "bg-slate-900 text-white"
                            : "bg-white border border-slate-200 text-slate-600"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={resultsSearch}
                    onChange={(e) => setResultsSearch(e.target.value)}
                    placeholder="ค้นหาอีเมลหรือชื่อผู้รับ..."
                    className="px-3 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>

                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-3 py-2">Email</th>
                        <th className="text-left px-3 py-2">ชื่อ</th>
                        <th className="text-left px-3 py-2">สถานะ</th>
                        <th className="text-left px-3 py-2">เวลาที่ระบบรับส่ง</th>
                        <th className="text-left px-3 py-2">รายละเอียด / หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredResultsRecipients.map((r) => {
                        const isUnknownRow = r.status === "unknown" || r.status === "processing";
                        const isChecked = selectedUnknownIds.has(r.id);
                        return (
                        <tr key={r.id}>
                          <td className="px-3 py-2 font-mono text-slate-800">
                            <div className="flex items-center gap-2">
                              {isUnknownRow && (
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    const next = new Set<string>(selectedUnknownIds);
                                    if (isChecked) next.delete(r.id);
                                    else next.add(r.id);
                                    setSelectedUnknownIds(next);
                                  }}
                                  className="rounded border-amber-400 text-[#8b0000]"
                                />
                              )}
                              <span>{r.email}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-700">{r.name || "-"}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`font-bold uppercase ${
                                r.status === "sent"
                                  ? "text-emerald-700"
                                  : r.status === "failed"
                                  ? "text-red-600"
                                  : r.status === "unknown" || r.status === "processing"
                                  ? "text-amber-700"
                                  : "text-slate-600"
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-500 tabular-nums">
                            {r.sentAt ? new Date(r.sentAt).toLocaleString("th-TH") : "-"}
                          </td>
                          <td className="px-3 py-2 text-slate-500 max-w-xs truncate" title={r.error || ""}>
                            {r.error || "-"}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Footer Step Navigation */}
        <footer className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <button
            type="button"
            disabled={step === 1 || isDispatching}
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as PromotionModalInitialStep) : s))}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 disabled:opacity-40"
          >
            <ArrowLeft className="w-4 h-4" />
            ย้อนกลับ
          </button>

          <div className="flex items-center gap-2">
            {step < 5 && (
              <button
                type="button"
                disabled={
                  isDispatching ||
                  (step === 1 && !selectedCourse) ||
                  (step === 2 && !registrationUrl) ||
                  (step === 3 && !hasEligibleOrSavedRecipients)
                }
                onClick={() => setStep((s) => (s < 6 ? ((s + 1) as PromotionModalInitialStep) : s))}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#8b0000] hover:bg-[#6e0000] text-white text-xs font-bold transition-colors disabled:opacity-40"
              >
                ขั้นตอนถัดไป
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};
