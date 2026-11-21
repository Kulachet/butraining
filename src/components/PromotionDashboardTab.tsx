import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { Course } from "../types";
import { useAuth } from "./AuthProvider";
import {
  deletePromotionCampaign,
  evaluateCampaignDeletionEligibility,
  fetchPromotionQuota,
  generateCampaignResultsCsv,
  isAuthorizedUniversityEmail,
  normalizeEmailAddress,
  PromotionCampaignDoc,
  SuppressionEntry,
} from "../lib/promotionCampaign";
import {
  addSuppressionEntry,
  getPromotionCampaign,
  listCampaignRecipients,
  listPromotionCampaigns,
  listSuppressionList,
  removeSuppressionEntry,
} from "../lib/promotionCampaignService";
import { PromotionModalInitialStep } from "./PromotionCampaignModal";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Download,
  Loader2,
  Mail,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

interface PromotionDashboardTabProps {
  onOpenCampaignModal: (params: {
    course?: Course | null;
    campaign?: PromotionCampaignDoc | null;
    step?: PromotionModalInitialStep;
  }) => void;
  refreshTrigger?: number;
}

export const PromotionDashboardTab: React.FC<PromotionDashboardTabProps> = ({
  onOpenCampaignModal,
  refreshTrigger = 0,
}) => {
  const { user, isAdmin } = useAuth();
  const [campaigns, setCampaigns] = useState<PromotionCampaignDoc[]>([]);
  const [coursesMap, setCoursesMap] = useState<Map<string, Course>>(new Map());
  const [suppressions, setSuppressions] = useState<SuppressionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [exportingId, setExportingId] = useState<string | null>(null);

  const [quotaLoading, setQuotaLoading] = useState(false);
  const [remainingQuota, setRemainingQuota] = useState<number | null>(null);
  const [quotaNote, setQuotaNote] = useState("");

  // Suppression form state
  const [newSuppressEmail, setNewSuppressEmail] = useState("");
  const [newSuppressReason, setNewSuppressReason] = useState("");
  const [savingSuppression, setSavingSuppression] = useState(false);
  const [showSuppressionPanel, setShowSuppressionPanel] = useState(false);

  // Safe Delete Campaign modal state
  const [checkingDeleteId, setCheckingDeleteId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromotionCampaignDoc | null>(null);
  const [deleteAdminConfirmed, setDeleteAdminConfirmed] = useState(false);
  const [isDeletingCampaign, setIsDeletingCampaign] = useState(false);
  const [deleteError, setDeleteError] = useState<{
    message: string;
    partialRetryable: boolean;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cList, supList, courseSnap] = await Promise.all([
        listPromotionCampaigns(),
        listSuppressionList(),
        getDocs(collection(db, "courses")),
      ]);
      setCampaigns(cList);
      setSuppressions(supList);
      const map = new Map<string, Course>();
      courseSnap.docs.forEach((d) => {
        map.set(d.id, { id: d.id, ...d.data() } as Course);
      });
      setCoursesMap(map);
    } catch (err) {
      console.error("Failed loading promotion campaigns:", err);
      toast.error("ไม่สามารถโหลดข้อมูลแคมเปญประชาสัมพันธ์ได้");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadData();
    }
  }, [isAdmin, loadData, refreshTrigger]);

  const handleCheckQuota = async () => {
    const curUser = auth.currentUser;
    if (!curUser) return;
    setQuotaLoading(true);
    setQuotaNote("");
    try {
      const idToken = await curUser.getIdToken();
      const res = await fetchPromotionQuota(idToken);
      if (res.ok) {
        setRemainingQuota(res.remainingDailyQuota ?? null);
      } else {
        setQuotaNote(res.message || "ไม่สามารถตรวจสอบโควตา MailApp ได้");
      }
    } catch (err: any) {
      setQuotaNote(err?.message || "ไม่สามารถติดต่อบริการตรวจสอบโควตา");
    } finally {
      setQuotaLoading(false);
    }
  };

  const handleExportCampaignCsv = async (campaign: PromotionCampaignDoc) => {
    setExportingId(campaign.id);
    try {
      const recipients = await listCampaignRecipients(campaign.id);
      const { csvContent, filename } = generateCampaignResultsCsv(campaign, recipients);
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("ส่งออกรายงาน CSV แล้ว");
    } catch {
      toast.error("ไม่สามารถส่งออก CSV ได้");
    } finally {
      setExportingId(null);
    }
  };

  const handleAddSuppression = async (e: React.FormEvent) => {
    e.preventDefault();
    const norm = normalizeEmailAddress(newSuppressEmail);
    if (!isAuthorizedUniversityEmail(norm)) {
      toast.error("กรุณากรอกอีเมล @bu.ac.th ที่ถูกต้อง");
      return;
    }
    if (!user) return;
    setSavingSuppression(true);
    try {
      await addSuppressionEntry({
        email: norm,
        reason: newSuppressReason || "Opted out via Admin",
        adminUid: user.uid,
        adminEmail: user.email || "",
      });
      setNewSuppressEmail("");
      setNewSuppressReason("");
      await loadData();
      toast.success(`เพิ่ม ${norm} เข้าสู่รายการงดรับข่าวสารแล้ว`);
    } catch (err: any) {
      toast.error(err?.message || "ไม่สามารถเพิ่มรายชื่อได้");
    } finally {
      setSavingSuppression(false);
    }
  };

  const handleRemoveSuppression = async (entry: SuppressionEntry) => {
    try {
      await removeSuppressionEntry(entry.id);
      setSuppressions((prev) => prev.filter((s) => s.id !== entry.id));
      toast.success(`นำ ${entry.email} ออกจาก Suppression List แล้ว`);
    } catch {
      toast.error("ไม่สามารถลบรายชื่อออกจาก Suppression List ได้");
    }
  };

  const handleRequestDeleteCampaign = async (camp: PromotionCampaignDoc) => {
    const quickEligibility = evaluateCampaignDeletionEligibility(camp);
    if (!quickEligibility.allowed) {
      toast.error(quickEligibility.reason || "ไม่สามารถลบแคมเปญนี้ได้");
      return;
    }

    setCheckingDeleteId(camp.id);
    try {
      const [freshCamp, freshRecipients] = await Promise.all([
        getPromotionCampaign(camp.id),
        listCampaignRecipients(camp.id),
      ]);

      if (!freshCamp) {
        toast("ไม่พบแคมเปญนี้ในฐานข้อมูล (อาจถูกลบไปแล้ว)", { icon: "ℹ️" });
        await loadData();
        return;
      }

      const liveEligibility = evaluateCampaignDeletionEligibility(freshCamp, freshRecipients);
      if (!liveEligibility.allowed) {
        toast.error(liveEligibility.reason || "สถานะล่าสุดของแคมเปญไม่อนุญาตให้ลบ");
        await loadData();
        return;
      }

      setDeleteTarget(freshCamp);
      setDeleteAdminConfirmed(false);
      setDeleteError(null);
    } catch (err: any) {
      toast.error(err?.message || "ไม่สามารถตรวจสอบสถานะล่าสุดของแคมเปญก่อนลบได้");
    } finally {
      setCheckingDeleteId(null);
    }
  };

  const handleConfirmDeleteCampaign = async () => {
    if (!deleteTarget) return;
    if (!deleteAdminConfirmed) {
      toast.error("กรุณาติ๊กยืนยันความเข้าใจว่าไม่สามารถย้อนกลับการลบได้");
      return;
    }
    const curUser = auth.currentUser;
    if (!curUser) {
      toast.error("กรุณาเข้าสู่ระบบผู้ดูแลระบบใหม่อีกครั้ง");
      return;
    }

    setIsDeletingCampaign(true);
    setDeleteError(null);
    try {
      const idToken = await curUser.getIdToken();
      const res = await deletePromotionCampaign({
        idToken,
        campaignId: deleteTarget.id,
        adminConfirmed: true,
      });

      if (res.ok) {
        setDeleteTarget(null);
        setDeleteAdminConfirmed(false);
        setDeleteError(null);
        await loadData();
        toast.success(res.message || "ลบแคมเปญและรายชื่อผู้รับเรียบร้อยแล้ว");
      } else {
        const tag =
          res.httpStatus || res.code
            ? `[${res.httpStatus ? `HTTP ${res.httpStatus}` : ""}${res.httpStatus && res.code ? " · " : ""}${res.code || ""}] `
            : "";
        const errMessage = `${tag}${res.message}`;
        const partialRetryable = Boolean(
          res.partialFailure || res.httpStatus === 500 || res.code === "DELETE_PARTIAL_FAILURE" || res.code === "NETWORK_ERROR"
        );
        setDeleteError({
          message: errMessage,
          partialRetryable,
        });

        // Refresh dashboard and keep modal synced with latest Firestore counts for safe recovery
        await loadData();
        const refreshedTarget = await getPromotionCampaign(deleteTarget.id).catch(() => null);
        if (refreshedTarget) {
          setDeleteTarget(refreshedTarget);
        }
        toast.error(errMessage, { duration: 6000 });
      }
    } catch (err: any) {
      const errMessage = err?.message || "เกิดข้อผิดพลาดระหว่างการลบแคมเปญ";
      setDeleteError({
        message: errMessage,
        partialRetryable: true,
      });
      toast.error(errMessage);
    } finally {
      setIsDeletingCampaign(false);
    }
  };

  const filteredCampaigns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter(
      (c) =>
        (c.courseTitle || "").toLowerCase().includes(q) ||
        (c.subject || "").toLowerCase().includes(q) ||
        (c.id || "").toLowerCase().includes(q)
    );
  }, [campaigns, searchQuery]);

  const summary = useMemo(() => {
    let totalSent = 0;
    let totalPending = 0;
    let totalAttention = 0;
    campaigns.forEach((c) => {
      totalSent += c.sentCount || 0;
      totalPending += c.pendingCount || 0;
      totalAttention += (c.failedCount || 0) + (c.unknownCount || 0);
    });
    return {
      totalCampaigns: campaigns.length,
      totalSent,
      totalPending,
      totalAttention,
    };
  }, [campaigns]);

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] lg:text-[32px] font-bold text-[#333333] tracking-[0.02em] leading-[1.4]">
            ประชาสัมพันธ์หลักสูตร (Email Campaigns)
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            สร้าง ปรับแต่ง และติดตามการส่งอีเมลประชาสัมพันธ์หลักสูตรแบบสองภาษา (TH / EN) สำหรับคณาจารย์และบุคลากร BU
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowSuppressionPanel((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
          >
            <Ban className="w-4 h-4 text-slate-500" />
            Suppression List ({suppressions.length})
          </button>
          <button
            type="button"
            onClick={() => onOpenCampaignModal({ course: null, campaign: null, step: 1 })}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8b0000] hover:bg-[#6e0000] text-white text-xs font-bold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            สร้างแคมเปญใหม่
          </button>
        </div>
      </header>

      {/* Top KPI & Quota Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="p-4 rounded-2xl border border-slate-200 bg-white">
          <div className="text-xs font-semibold text-slate-500">แคมเปญทั้งหมด</div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{summary.totalCampaigns}</div>
        </div>
        <div className="p-4 rounded-2xl border border-slate-200 bg-white">
          <div className="text-xs font-semibold text-slate-500">ส่งเข้า MailApp แล้ว</div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">{summary.totalSent}</div>
          <div className="text-[11px] text-slate-400">Accepted by mail service</div>
        </div>
        <div className="p-4 rounded-2xl border border-slate-200 bg-white">
          <div className="text-xs font-semibold text-slate-500">รอส่งต่อ (Pending)</div>
          <div className="text-2xl font-bold text-slate-800 tabular-nums mt-1">{summary.totalPending}</div>
        </div>
        <div className="p-4 rounded-2xl border border-slate-200 bg-white">
          <div className="text-xs font-semibold text-slate-500">Failed / Unknown</div>
          <div className="text-2xl font-bold text-amber-700 tabular-nums mt-1">{summary.totalAttention}</div>
        </div>
        <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600">MailApp Quota วันนี้</span>
            <button
              type="button"
              disabled={quotaLoading}
              onClick={handleCheckQuota}
              className="text-[11px] font-bold text-[#8b0000] hover:underline inline-flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${quotaLoading ? "animate-spin" : ""}`} />
              เช็คโควตา
            </button>
          </div>
          <div className="text-lg font-bold text-slate-900 tabular-nums mt-1">
            {remainingQuota !== null ? `${remainingQuota} ฉบับ` : quotaNote ? "ตรวจสอบไม่ได้" : "กดเช็คโควตา"}
          </div>
          {quotaNote && <div className="text-[10px] text-amber-700 truncate">{quotaNote}</div>}
        </div>
      </div>

      {/* Suppression List Panel (Collapsible) */}
      {showSuppressionPanel && (
        <section className="p-5 rounded-2xl border border-slate-200 bg-white space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                รายการงดรับข่าวสาร (Suppression List)
              </h2>
              <p className="text-xs text-slate-500">
                อีเมลในรายการนี้จะถูกคัดกรองออกทั้งฝั่งหน้าจอและฝั่งเซิร์ฟเวอร์โดยอัตโนมัติในทุกแคมเปญ
              </p>
            </div>
          </div>

          <form onSubmit={handleAddSuppression} className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={newSuppressEmail}
              onChange={(e) => setNewSuppressEmail(e.target.value)}
              placeholder="อีเมล @bu.ac.th ที่ขอระงับข่าวสาร"
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              value={newSuppressReason}
              onChange={(e) => setNewSuppressReason(e.target.value)}
              placeholder="เหตุผล (เช่น ผู้รับแจ้งขอยกเลิก)"
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <button
              type="submit"
              disabled={savingSuppression}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold disabled:opacity-50"
            >
              {savingSuppression ? "กำลังบันทึก..." : "เพิ่มเข้า Suppression List"}
            </button>
          </form>

          <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {suppressions.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">ยังไม่มีอีเมลในรายการงดรับข่าวสาร</div>
            ) : (
              suppressions.map((entry) => (
                <div key={entry.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <span className="font-mono font-semibold text-slate-800">{entry.email}</span>
                    <span className="text-slate-400 mx-2">·</span>
                    <span className="text-slate-600">{entry.reason}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveSuppression(entry)}
                    className="text-slate-400 hover:text-red-600 p-1"
                    title="นำออกจากรายการ"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Search & Refresh Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาชื่อหลักสูตร หรือหัวข้ออีเมลแคมเปญ..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20"
          />
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={loadData}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          รีเฟรชรายการ
        </button>
      </div>

      {/* Campaigns List */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-[#8b0000]" />
            <span className="text-xs font-semibold">กำลังโหลดแคมเปญประชาสัมพันธ์...</span>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Mail className="w-10 h-10 text-slate-300 mx-auto" />
            <div className="text-sm font-bold text-slate-700">ยังไม่มีแคมเปญประชาสัมพันธ์หลักสูตร</div>
            <p className="text-xs text-slate-400">
              กดปุ่ม "สร้างแคมเปญใหม่" ด้านบน หรือเลือก "ประชาสัมพันธ์หลักสูตร" จากหน้าจัดการหลักสูตร
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredCampaigns.map((camp) => {
              const linkedCourse = coursesMap.get(camp.courseId) || null;
              const deleteEligibility = evaluateCampaignDeletionEligibility(camp);
              const isCheckingThisRow = checkingDeleteId === camp.id;
              return (
                <div
                  key={camp.id}
                  className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 uppercase">
                        {camp.language === "en" ? "EN" : "TH"}
                      </span>
                      <span
                        className={`font-bold px-2 py-0.5 rounded uppercase ${
                          camp.status === "completed"
                            ? "bg-emerald-50 text-emerald-700"
                            : camp.status === "completed_with_issues"
                            ? "bg-amber-50 text-amber-800"
                            : camp.status === "sending"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {camp.status}
                      </span>
                      {camp.unknownCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          Unknown {camp.unknownCount}
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 truncate">{camp.courseTitle}</h3>
                    <p className="text-xs text-slate-500 truncate">{camp.subject}</p>
                    <p className="text-[11px] text-slate-400 tabular-nums">
                      ทั้งหมด {camp.totalRecipients} · ส่งแล้ว {camp.sentCount} · รอส่ง {camp.pendingCount} · ล้มเหลว{" "}
                      {camp.failedCount} · ข้าม/งดรับ {(camp.skippedCount || 0) + (camp.suppressedCount || 0)}
                      {camp.lastProcessedAt
                        ? ` · ประมวลผลล่าสุด ${new Date(camp.lastProcessedAt).toLocaleString("th-TH")}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {camp.pendingCount > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenCampaignModal({
                            course: linkedCourse,
                            campaign: camp,
                            step: 5,
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8b0000] hover:bg-[#6e0000] text-white text-xs font-bold"
                      >
                        <Play className="w-3.5 h-3.5" />
                        ส่งต่อ ({camp.pendingCount})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        onOpenCampaignModal({
                          course: linkedCourse,
                          campaign: camp,
                          step: 6,
                        })
                      }
                      className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
                    >
                      ดูผลลัพธ์ / จัดการ
                    </button>
                    <button
                      type="button"
                      disabled={exportingId === camp.id}
                      onClick={() => handleExportCampaignCsv(camp)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-600 disabled:opacity-50"
                      title="ดาวน์โหลดรายงาน CSV"
                    >
                      <Download className="w-3.5 h-3.5" />
                      CSV
                    </button>
                    <button
                      type="button"
                      disabled={!deleteEligibility.allowed || isCheckingThisRow}
                      onClick={() => handleRequestDeleteCampaign(camp)}
                      title={
                        deleteEligibility.allowed
                          ? "ลบแคมเปญนี้ (เฉพาะ draft / ready / paused ที่ยังไม่มีผู้รับ sent หรือ unknown)"
                          : deleteEligibility.reason
                      }
                      aria-label={`ลบแคมเปญ ${camp.courseTitle}`}
                      className={
                        deleteEligibility.allowed
                          ? "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-50 hover:border-red-300 text-xs font-semibold text-red-700 disabled:opacity-50 transition-colors"
                          : "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-300 cursor-not-allowed"
                      }
                    >
                      {isCheckingThisRow ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      ลบ
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Safe Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-campaign-modal-title"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 bg-red-50 border-b border-red-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h2 id="delete-campaign-modal-title" className="text-base font-bold text-red-900">
                    ยืนยันการลบแคมเปญประชาสัมพันธ์
                  </h2>
                  <p className="text-xs text-red-700">
                    การลบแคมเปญและรายชื่อผู้รับไม่สามารถกู้คืนได้
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isDeletingCampaign}
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError(null);
                  setDeleteAdminConfirmed(false);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/70 disabled:opacity-40"
                aria-label="ปิดหน้าต่างยืนยัน"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-slate-500 shrink-0">ชื่อหลักสูตร:</span>
                  <span className="font-bold text-slate-900 text-right">{deleteTarget.courseTitle || "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500 shrink-0">Campaign ID:</span>
                  <span className="font-mono text-[11px] font-semibold text-slate-800 break-all text-right">
                    {deleteTarget.id}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500 shrink-0">สถานะแคมเปญ:</span>
                  <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-bold uppercase text-[11px]">
                    {deleteTarget.status}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500 shrink-0">จำนวนผู้รับทั้งหมด:</span>
                  <span className="font-bold text-slate-900 tabular-nums">{deleteTarget.totalRecipients} รายการ</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500 shrink-0">จำนวนที่ส่งอีเมลแล้ว:</span>
                  <span className="font-bold text-slate-900 tabular-nums">{deleteTarget.sentCount} รายการ</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold">คำเตือน: ไม่สามารถย้อนกลับได้ (Cannot be undone)</strong>
                  ระบบจะลบทั้งเอกสารแคมเปญและรายชื่อผู้รับทั้งหมดในแคมเปญนี้ (subcollection) ออกจากฐานข้อมูลอย่างถาวร โดยจะไม่กระทบข้อมูลหลักสูตร การลงทะเบียน การประเมิน หรือ Suppression List
                </div>
              </div>

              {deleteError && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 space-y-1.5">
                  <div className="font-bold">ไม่สามารถดำเนินการลบจนเสร็จสมบูรณ์ได้</div>
                  <div className="leading-relaxed break-words">{deleteError.message}</div>
                  {deleteError.partialRetryable ? (
                    <div className="text-[11px] text-red-800 font-medium">
                      แนวทางแก้ไข: กดปุ่ม &quot;ลองลบที่เหลืออีกครั้ง&quot; เพื่อทำความสะอาดรายการที่ค้างอยู่ต่อ หรือกดปิดเพื่อตรวจสอบรายการในแดชบอร์ด
                    </div>
                  ) : (
                    <div className="text-[11px] text-red-800 font-medium">
                      ระบบได้รีเฟรชข้อมูลล่าสุดแล้ว แคมเปญนี้ถูกปกป้องไว้ตามเงื่อนไขความปลอดภัย กรุณาปิดหน้าต่างเพื่อตรวจสอบสถานะในแดชบอร์ด
                    </div>
                  )}
                </div>
              )}

              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-300 bg-white cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={deleteAdminConfirmed}
                  disabled={isDeletingCampaign}
                  onChange={(e) => setDeleteAdminConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-400 text-red-700 focus:ring-red-600"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  ข้าพเจ้าในฐานะผู้ดูแลระบบยืนยันการลบแคมเปญนี้และรายชื่อผู้รับทั้งหมดภายในแคมเปญอย่างถาวร และเข้าใจว่าไม่สามารถกู้คืนได้
                </span>
              </label>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isDeletingCampaign}
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteError(null);
                    setDeleteAdminConfirmed(false);
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 disabled:opacity-40"
                >
                  ยกเลิก
                </button>
                {(!deleteError || deleteError.partialRetryable) && (
                  <button
                    type="button"
                    disabled={isDeletingCampaign || !deleteAdminConfirmed}
                    onClick={handleConfirmDeleteCampaign}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-bold disabled:opacity-40 transition-colors"
                  >
                    {isDeletingCampaign ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        กำลังลบข้อมูล...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5" />
                        {deleteError?.partialRetryable ? "ลองลบที่เหลืออีกครั้ง" : "ยืนยันการลบแคมเปญ"}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
