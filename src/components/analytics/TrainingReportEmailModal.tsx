import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth } from "../../lib/firebase";
import { useAuth } from "../AuthProvider";
import { Course, Instructor, Registration } from "../../types";
import {
  analyzeEvaluations,
  calculateCourseOperationalStats,
  CourseOperationalStats,
  DEFAULT_QUESTIONS,
  EvaluationAnalysisResult,
} from "../../lib/evaluationAnalytics";
import { generateEvaluationPdfBlob } from "../../lib/pdfExport";
import { OverviewPdfReport } from "./OverviewPdfReport";
import {
  blobToBase64,
  buildOverviewPdfFilename,
  buildTrainingReportEmailContent,
  createTrainingReportRequestId,
  DEFAULT_REPORT_RECIPIENT_EMAIL,
  DEFAULT_REPORT_RECIPIENT_NAME,
  dispatchTrainingReportEmail,
  formatBytesCompact,
  formatCourseTrainingDateDisplay,
  generateActualAttendanceCsv,
  isValidBuRecipientEmail,
  TrainingReportDeliveryState,
  validateTrainingReportAttachments,
} from "../../lib/trainingReport";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

const MODAL_PDF_CONTAINER_ID = "training-report-overview-pdf";

interface TrainingReportEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  course: Course | null;
  registrations: Registration[];
  evaluations: any[];
  instructors: Instructor[];
  questions?: string[];
  precomputedAnalysis?: EvaluationAnalysisResult;
  precomputedOperationalStats?: CourseOperationalStats;
}

export const TrainingReportEmailModal: React.FC<TrainingReportEmailModalProps> = ({
  isOpen,
  onClose,
  course,
  registrations,
  evaluations,
  instructors,
  questions = DEFAULT_QUESTIONS,
  precomputedAnalysis,
  precomputedOperationalStats,
}) => {
  const { isAdmin } = useAuth();

  const [recipientName, setRecipientName] = useState(DEFAULT_REPORT_RECIPIENT_NAME);
  const [recipientEmail, setRecipientEmail] = useState(DEFAULT_REPORT_RECIPIENT_EMAIL);

  const [deliveryState, setDeliveryState] = useState<TrainingReportDeliveryState>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [prepProgress, setPrepProgress] = useState("");
  const [prepError, setPrepError] = useState("");
  const [gatewayUnavailable, setGatewayUnavailable] = useState(false);
  const [unknownRetryAcknowledged, setUnknownRetryAcknowledged] = useState(false);

  const [csvBlob, setCsvBlob] = useState<Blob | null>(null);
  const [csvFilename, setCsvFilename] = useState("");
  const [csvRowCount, setCsvRowCount] = useState(0);
  const [csvPreviewUrl, setCsvPreviewUrl] = useState<string | null>(null);

  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfFilename, setPdfFilename] = useState("");
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  const [requestId, setRequestId] = useState("");
  const [confirmedSentInfo, setConfirmedSentInfo] = useState<{
    recipient: string;
    sentAt?: string;
    attachmentsCount?: number;
  } | null>(null);

  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const previewUrlsRef = useRef<{ csv: string | null; pdf: string | null }>({
    csv: null,
    pdf: null,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (previewUrlsRef.current.csv) URL.revokeObjectURL(previewUrlsRef.current.csv);
      if (previewUrlsRef.current.pdf) URL.revokeObjectURL(previewUrlsRef.current.pdf);
    };
  }, []);

  const revokePreviewUrls = useCallback(() => {
    if (previewUrlsRef.current.csv) {
      URL.revokeObjectURL(previewUrlsRef.current.csv);
      previewUrlsRef.current.csv = null;
    }
    if (previewUrlsRef.current.pdf) {
      URL.revokeObjectURL(previewUrlsRef.current.pdf);
      previewUrlsRef.current.pdf = null;
    }
    setCsvPreviewUrl(null);
    setPdfPreviewUrl(null);
  }, []);

  const courseRegistrations = useMemo(() => {
    if (!course) return [];
    return registrations.filter((r) => r.courseId === course.id);
  }, [registrations, course]);

  const courseEvaluations = useMemo(() => {
    if (!course) return [];
    return evaluations.filter((e) => e.courseId === course.id);
  }, [evaluations, course]);

  const analysis = useMemo<EvaluationAnalysisResult>(() => {
    if (precomputedAnalysis) return precomputedAnalysis;
    return analyzeEvaluations(
      courseEvaluations,
      questions.length > 0 ? questions : DEFAULT_QUESTIONS,
      course?.title || "หลักสูตร"
    );
  }, [precomputedAnalysis, courseEvaluations, questions, course]);

  const operationalStats = useMemo<CourseOperationalStats>(() => {
    if (precomputedOperationalStats) return precomputedOperationalStats;
    if (!course) {
      return {
        totalRegistrations: 0,
        totalAttendees: 0,
        attendanceRate: 0,
        totalEvals: 0,
        uniqueEvaluatorsCount: 0,
        responseRate: 0,
        totalCerts: 0,
        certRate: 0,
      };
    }
    return calculateCourseOperationalStats(course.id, registrations, evaluations);
  }, [precomputedOperationalStats, course, registrations, evaluations]);

  const trainingDateDisplay = useMemo(
    () => formatCourseTrainingDateDisplay(course),
    [course]
  );

  // Authoritative actual attendance count (strictly r.attended === true)
  const actualAttendedCount = useMemo(
    () => courseRegistrations.filter((r) => Boolean(r.attended)).length,
    [courseRegistrations]
  );

  const emailContent = useMemo(
    () =>
      buildTrainingReportEmailContent({
        courseTitle: course?.title || "หลักสูตร",
        trainingDate: trainingDateDisplay,
        recipientName: recipientName.trim() || DEFAULT_REPORT_RECIPIENT_NAME,
        registeredCount: operationalStats.totalRegistrations,
        attendedCount: actualAttendedCount,
        evaluationCount: analysis.totalResponses,
        averageScore: analysis.overallAverage,
      }),
    [
      course?.title,
      trainingDateDisplay,
      recipientName,
      operationalStats.totalRegistrations,
      actualAttendedCount,
      analysis.totalResponses,
      analysis.overallAverage,
    ]
  );

  const prepareAttachments = useCallback(async () => {
    if (!course || !isAdmin) return;

    revokePreviewUrls();
    setDeliveryState("preparing");
    setPrepError("");
    setStatusMessage("กำลังสร้างไฟล์รายชื่อผู้เข้าอบรมจริง (CSV) และรายงานสรุปผลการประเมิน (PDF)...");
    setPrepProgress("กำลังจัดเตรียมข้อมูลผู้เข้าอบรม...");
    setGatewayUnavailable(false);
    setUnknownRetryAcknowledged(false);
    setConfirmedSentInfo(null);
    setCsvBlob(null);
    setPdfBlob(null);

    try {
      // 1. Build Actual Training Attendance CSV strictly from attended participants
      const csvResult = generateActualAttendanceCsv(
        courseRegistrations,
        instructors,
        course.title,
        course.id
      );

      // 2. Allow React offscreen OverviewPdfReport container to paint before rasterizing
      setPrepProgress("กำลังสร้างรายงาน Executive Evaluation Overview PDF...");
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      const generatedPdfBlob = await generateEvaluationPdfBlob(
        MODAL_PDF_CONTAINER_ID,
        (msg) => {
          if (mountedRef.current) setPrepProgress(msg);
        }
      );

      if (!mountedRef.current) return;

      const generatedPdfFilename = buildOverviewPdfFilename(course.title);
      const nextCsvUrl = URL.createObjectURL(csvResult.blob);
      const nextPdfUrl = URL.createObjectURL(generatedPdfBlob);
      previewUrlsRef.current = { csv: nextCsvUrl, pdf: nextPdfUrl };

      setCsvBlob(csvResult.blob);
      setCsvFilename(csvResult.filename);
      setCsvRowCount(csvResult.rowCount);
      setCsvPreviewUrl(nextCsvUrl);

      setPdfBlob(generatedPdfBlob);
      setPdfFilename(generatedPdfFilename);
      setPdfPreviewUrl(nextPdfUrl);

      const validation = await validateTrainingReportAttachments(
        csvResult.blob,
        generatedPdfBlob
      );

      if (!mountedRef.current) return;

      if (!validation.valid) {
        setPrepError(validation.error || "ไฟล์แนบไม่ผ่านการตรวจสอบ");
        setDeliveryState("failed");
        setStatusMessage(validation.error || "ไฟล์แนบไม่พร้อมใช้งาน");
      } else {
        setDeliveryState("ready");
        setStatusMessage("ไฟล์แนบทั้ง 2 รายการพร้อมตรวจสอบก่อนส่งอีเมลแล้ว");
      }
      setPrepProgress("");
    } catch (err: any) {
      if (!mountedRef.current) return;
      const errMsg = err?.message || "ไม่สามารถสร้างไฟล์แนบสำหรับรายงานการอบรมได้";
      setPrepError(errMsg);
      setPrepProgress("");
      setDeliveryState("failed");
      setStatusMessage(errMsg);
    }
  }, [course, isAdmin, courseRegistrations, instructors, revokePreviewUrls]);

  // Reset and prepare files whenever modal opens or course changes
  useEffect(() => {
    if (!isOpen || !course) {
      revokePreviewUrls();
      setDeliveryState("idle");
      setPrepError("");
      setStatusMessage("");
      setPrepProgress("");
      setConfirmedSentInfo(null);
      setUnknownRetryAcknowledged(false);
      sendingRef.current = false;
      return;
    }

    setRecipientName(DEFAULT_REPORT_RECIPIENT_NAME);
    setRecipientEmail(DEFAULT_REPORT_RECIPIENT_EMAIL);
    setRequestId(createTrainingReportRequestId(course.id));
    prepareAttachments();
  }, [isOpen, course?.id]);

  if (!isOpen || !course) return null;

  const isRecipientValid = isValidBuRecipientEmail(recipientEmail);
  const hasActualAttendees = actualAttendedCount > 0 && csvRowCount > 0;
  const hasEvaluations = analysis.totalResponses > 0;

  const canSendEmail =
    isAdmin &&
    isRecipientValid &&
    hasActualAttendees &&
    hasEvaluations &&
    Boolean(csvBlob) &&
    Boolean(pdfBlob) &&
    !prepError &&
    !sendingRef.current &&
    (deliveryState === "ready" ||
      deliveryState === "failed" ||
      (deliveryState === "unknown" && unknownRetryAcknowledged));

  const handleDownloadLocal = (url: string | null, filename: string) => {
    if (!url || !filename) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyEmailText = async () => {
    const fullText = `ถึง: ${recipientName} <${recipientEmail}>\nหัวเรื่อง: ${emailContent.subject}\n\n${emailContent.body}`;
    try {
      await navigator.clipboard.writeText(fullText);
      toast.success("คัดลอกหัวข้อและเนื้อหาอีเมลแล้ว");
    } catch {
      toast.error("ไม่สามารถคัดลอกข้อความอัตโนมัติได้");
    }
  };

  const handleSendReport = async () => {
    if (sendingRef.current || !canSendEmail || !csvBlob || !pdfBlob) return;

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setDeliveryState("failed");
      setStatusMessage("กรุณาเข้าสู่ระบบผู้ดูแลระบบใหม่อีกครั้งก่อนส่งอีเมล");
      return;
    }

    sendingRef.current = true;
    setDeliveryState("sending");
    setStatusMessage("กำลังส่งอีเมลพร้อมเอกสารแนบทั้ง 2 รายการและรอการยืนยันจากเซิร์ฟเวอร์...");

    const activeRequestId = requestId || createTrainingReportRequestId(course.id);
    if (!requestId) setRequestId(activeRequestId);

    try {
      const [idToken, csvBase64, pdfBase64] = await Promise.all([
        currentUser.getIdToken(true),
        blobToBase64(csvBlob),
        blobToBase64(pdfBlob),
      ]);

      const result = await dispatchTrainingReportEmail({
        idToken,
        requestId: activeRequestId,
        courseId: course.id,
        courseTitle: course.title,
        trainingDate: trainingDateDisplay,
        recipientName: recipientName.trim() || DEFAULT_REPORT_RECIPIENT_NAME,
        recipientEmail: recipientEmail.trim().toLowerCase(),
        registeredCount: operationalStats.totalRegistrations,
        attendedCount: actualAttendedCount,
        evaluationCount: analysis.totalResponses,
        averageScore: analysis.overallAverage.toFixed(2),
        subject: emailContent.subject,
        body: emailContent.body,
        htmlBody: emailContent.htmlBody,
        csvFilename,
        csvBase64,
        pdfFilename,
        pdfBase64,
      });

      if (!mountedRef.current) return;

      setDeliveryState(result.deliveryState);
      setStatusMessage(result.message);
      setGatewayUnavailable(Boolean(result.gatewayUnavailable));

      if (result.deliveryState === "confirmed_sent") {
        setConfirmedSentInfo({
          recipient: result.recipient || recipientEmail.trim().toLowerCase(),
          sentAt: result.sentAt,
          attachmentsCount: result.attachmentsCount ?? 2,
        });
        toast.success("ส่งรายงานการอบรมทางอีเมลเรียบร้อยแล้ว");
      } else if (result.deliveryState === "unknown") {
        setUnknownRetryAcknowledged(false);
        toast.error("ไม่สามารถยืนยันสถานะการส่งได้ กรุณาตรวจสอบอีเมลก่อนลองส่งซ้ำ");
      } else {
        toast.error(result.message || "ส่งรายงานไม่สำเร็จ");
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setDeliveryState("failed");
      setStatusMessage(err?.message || "เกิดข้อผิดพลาดในการเตรียมส่งอีเมล");
      toast.error("เกิดข้อผิดพลาดในการส่งรายงาน");
    } finally {
      sendingRef.current = false;
    }
  };

  const renderStatusBanner = () => {
    if (deliveryState === "preparing") {
      return (
        <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 flex items-start gap-3">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-blue-900">
              สถานะ: กำลังเตรียมไฟล์เอกสาร (Preparing files)
            </p>
            <p className="text-xs text-blue-700 mt-0.5">{prepProgress || statusMessage}</p>
          </div>
        </div>
      );
    }

    if (deliveryState === "ready") {
      return (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-emerald-900">
              สถานะ: พร้อมตรวจสอบก่อนส่ง (Ready for review)
            </p>
            <p className="text-xs text-emerald-700 mt-0.5">{statusMessage}</p>
          </div>
        </div>
      );
    }

    if (deliveryState === "sending") {
      return (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <Loader2 className="w-5 h-5 text-amber-600 animate-spin shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-900">
              สถานะ: กำลังส่งอีเมลและเอกสารแนบ (Sending)
            </p>
            <p className="text-xs text-amber-700 mt-0.5">{statusMessage}</p>
          </div>
        </div>
      );
    }

    if (deliveryState === "confirmed_sent") {
      return (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-emerald-900">
              สถานะ: ส่งอีเมลสำเร็จและได้รับการยืนยันจากเซิร์ฟเวอร์ (Confirmed sent)
            </p>
            <p className="text-xs text-emerald-800">{statusMessage}</p>
            {confirmedSentInfo && (
              <p className="text-[11px] text-emerald-700">
                ผู้รับ: <strong>{confirmedSentInfo.recipient}</strong> • เอกสารแนบ{" "}
                {confirmedSentInfo.attachmentsCount || 2} ไฟล์
                {confirmedSentInfo.sentAt
                  ? ` • เวลา ${new Date(confirmedSentInfo.sentAt).toLocaleString("th-TH")}`
                  : ""}
              </p>
            )}
          </div>
        </div>
      );
    }

    if (deliveryState === "unknown") {
      return (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-xs font-bold text-amber-900">
              สถานะ: ไม่สามารถยืนยันสถานะการส่งได้ (Delivery status unknown)
            </p>
            <p className="text-xs text-amber-800">{statusMessage}</p>
            <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={unknownRetryAcknowledged}
                onChange={(e) => setUnknownRetryAcknowledged(e.target.checked)}
                className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-[11px] font-semibold text-amber-900">
                ยืนยันว่าได้ตรวจสอบกล่องจดหมายแล้วและต้องการลองส่งซ้ำ (ใช้ Request ID เดิมเพื่อป้องกันส่งซ้ำ)
              </span>
            </label>
          </div>
        </div>
      );
    }

    if (deliveryState === "failed") {
      return (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-red-900">
              สถานะ: การส่งล้มเหลว (Failed)
            </p>
            <p className="text-xs text-red-700">{statusMessage}</p>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      {/* Offscreen authoritative Executive Evaluation Overview PDF container */}
      <div
        style={{
          position: "fixed",
          left: "-9999px",
          top: 0,
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        <OverviewPdfReport
          course={course}
          analysis={analysis}
          operationalStats={operationalStats}
          containerId={MODAL_PDF_CONTAINER_ID}
        />
      </div>

      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-crimson/10 text-crimson flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                ส่งรายงานการอบรมทางอีเมล
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                ส่งรายชื่อผู้เข้าอบรมจริง (CSV) และรายงานสรุปผลการประเมิน (Executive Overview PDF)
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={deliveryState === "sending"}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-40 cursor-pointer"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {!isAdmin && (
            <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
              สิทธิ์จำกัดเฉพาะผู้ดูแลระบบเท่านั้น ไม่สามารถใช้งานฟังก์ชันส่งรายงานการอบรมได้
            </div>
          )}

          {renderStatusBanner()}

          {/* Data completeness warnings */}
          {(!hasActualAttendees || !hasEvaluations) && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 space-y-1">
                <p className="font-bold">ข้อมูลยังไม่ครบถ้วนสำหรับการส่งรายงานอัตโนมัติ:</p>
                {!hasActualAttendees && (
                  <p>
                    • ยังไม่มีผู้เข้าร่วมอบรมที่เช็คอินจริง (ระบบจะส่งเฉพาะรายชื่อผู้เข้าอบรมจริงเท่านั้น ไม่ส่งรายชื่อผู้ลงทะเบียนแทน)
                  </p>
                )}
                {!hasEvaluations && (
                  <p>• ยังไม่มีผลตอบแบบประเมินความพึงพอใจสำหรับหลักสูตรนี้</p>
                )}
              </div>
            </div>
          )}

          {/* Course & Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                ข้อมูลหลักสูตรที่เลือก
              </p>
              <p className="text-sm font-extrabold text-slate-900">{course.title}</p>
              <p className="text-xs text-slate-600">
                วันที่จัดอบรม: <span className="font-semibold text-slate-800">{trainingDateDisplay}</span>
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-xl bg-white border border-slate-100">
                <span className="text-[10px] text-slate-400 block">ผู้ลงทะเบียน</span>
                <span className="text-lg font-extrabold text-slate-800 tabular-nums">
                  {operationalStats.totalRegistrations}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-white border border-slate-100">
                <span className="text-[10px] text-slate-400 block">เข้าอบรมจริง</span>
                <span
                  className={`text-lg font-extrabold tabular-nums ${
                    actualAttendedCount > 0 ? "text-emerald-700" : "text-red-600"
                  }`}
                >
                  {actualAttendedCount}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-white border border-slate-100">
                <span className="text-[10px] text-slate-400 block">ผลประเมิน</span>
                <span
                  className={`text-lg font-extrabold tabular-nums ${
                    analysis.totalResponses > 0 ? "text-crimson" : "text-red-600"
                  }`}
                >
                  {analysis.totalResponses}
                </span>
              </div>
            </div>
          </div>

          {/* Recipient Inputs */}
          <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <UserCheck className="w-4 h-4 text-crimson" />
              <span>ข้อมูลผู้รับรายงานสำหรับบันทึกผลการอบรม</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  ชื่อผู้รับอีเมล
                </label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  disabled={deliveryState === "sending" || deliveryState === "confirmed_sent"}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-crimson/20 disabled:bg-slate-50"
                  placeholder={DEFAULT_REPORT_RECIPIENT_NAME}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  อีเมลผู้รับ (@bu.ac.th เท่านั้น)
                </label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  disabled={deliveryState === "sending" || deliveryState === "confirmed_sent"}
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-2 disabled:bg-slate-50 ${
                    isRecipientValid
                      ? "border-slate-200 text-slate-800 focus:ring-crimson/20"
                      : "border-red-300 text-red-700 focus:ring-red-200"
                  }`}
                  placeholder={DEFAULT_REPORT_RECIPIENT_EMAIL}
                />
                {!isRecipientValid && (
                  <p className="text-[11px] text-red-600 mt-1">
                    กรุณาระบุอีเมลโดเมน @bu.ac.th ที่ถูกต้อง
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Attachments Review & Local Download */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800">
                เอกสารแนบที่จะส่งไปกับอีเมล (2 ไฟล์)
              </h4>
              <button
                type="button"
                onClick={prepareAttachments}
                disabled={deliveryState === "preparing" || deliveryState === "sending" || deliveryState === "confirmed_sent"}
                className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 hover:text-crimson disabled:opacity-40 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                สร้างไฟล์ใหม่
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* CSV Attachment Card */}
              <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">
                      {csvFilename || "รายชื่อผู้มาอบรมจริง.csv"}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      ผู้เข้าอบรมจริง {csvRowCount} คน •{" "}
                      {csvBlob ? formatBytesCompact(csvBlob.size) : "กำลังเตรียม..."}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownloadLocal(csvPreviewUrl, csvFilename)}
                  disabled={!csvPreviewUrl}
                  className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shrink-0 disabled:opacity-40 cursor-pointer"
                  title="ดาวน์โหลดไฟล์ CSV เพื่อตรวจทาน"
                >
                  <Download className="w-3.5 h-3.5" />
                  ดาวน์โหลด
                </button>
              </div>

              {/* PDF Attachment Card */}
              <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-red-100 text-crimson flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">
                      {pdfFilename || "Executive_Evaluation_Overview.pdf"}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Executive Overview PDF •{" "}
                      {pdfBlob ? formatBytesCompact(pdfBlob.size) : "กำลังเตรียม..."}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownloadLocal(pdfPreviewUrl, pdfFilename)}
                  disabled={!pdfPreviewUrl}
                  className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shrink-0 disabled:opacity-40 cursor-pointer"
                  title="ดาวน์โหลดไฟล์ PDF เพื่อตรวจทาน"
                >
                  <Download className="w-3.5 h-3.5" />
                  ดาวน์โหลด
                </button>
              </div>
            </div>
          </div>

          {/* Email Subject & Body Preview */}
          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">
                ตัวอย่างหัวข้อและเนื้อหาอีเมล
              </span>
              <button
                type="button"
                onClick={handleCopyEmailText}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                คัดลอกข้อความ
              </button>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs">
              <span className="text-slate-400 font-semibold mr-2">Subject:</span>
              <span className="font-bold text-slate-900">{emailContent.subject}</span>
            </div>

            <pre className="bg-white rounded-xl border border-slate-200 p-4 text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed max-h-60 overflow-y-auto">
              {emailContent.body}
            </pre>
          </div>

          {/* Safe Manual Email Fallback when gateway is missing or failed */}
          {(deliveryState === "failed" || gatewayUnavailable) && csvPreviewUrl && pdfPreviewUrl && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
              <p className="text-xs font-bold text-slate-800">
                ทางเลือกสำรองสำหรับส่งอีเมลด้วยตนเอง (Manual Fallback)
              </p>
              <p className="text-[11px] text-slate-600">
                หากระบบส่งอัตโนมัติบนเซิร์ฟเวอร์ยังไม่พร้อมใช้งาน ท่านสามารถดาวน์โหลดทั้ง 2 ไฟล์และคัดลอกข้อความด้านบนเพื่อส่งผ่านอีเมลมหาวิทยาลัยได้ทันที
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadLocal(csvPreviewUrl, csvFilename)}
                  className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600" />
                  ดาวน์โหลด CSV
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadLocal(pdfPreviewUrl, pdfFilename)}
                  className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-crimson" />
                  ดาวน์โหลด PDF
                </button>
                <button
                  type="button"
                  onClick={handleCopyEmailText}
                  className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  คัดลอกหัวข้อ + เนื้อหา
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-slate-400">
            Request ID: <span className="font-mono">{requestId}</span>
          </p>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={deliveryState === "sending"}
              className="px-5 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
            >
              {deliveryState === "confirmed_sent" ? "ปิดหน้าต่าง" : "ยกเลิก"}
            </button>

            <button
              type="button"
              onClick={handleSendReport}
              disabled={!canSendEmail}
              className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md ${
                canSendEmail
                  ? "bg-crimson hover:bg-crimson-dark text-white shadow-crimson/20 cursor-pointer"
                  : "bg-slate-200 text-slate-400 shadow-none cursor-not-allowed"
              }`}
            >
              {deliveryState === "sending" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>กำลังส่งอีเมล...</span>
                </>
              ) : deliveryState === "confirmed_sent" ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>ส่งเรียบร้อยแล้ว</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>ยืนยันส่งรายงานทางอีเมล</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
