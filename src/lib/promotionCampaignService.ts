import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  buildSuppressionDocId,
  CampaignLanguage,
  CampaignStatus,
  DEFAULT_PROMOTION_BATCH_SIZE,
  isAuthorizedUniversityEmail,
  normalizeEmailAddress,
  PosterConfig,
  PromotionCampaignDoc,
  PromotionRecipientDoc,
  PromotionTemplateData,
  RecipientDeliveryStatus,
  SuppressionEntry,
  ValidatedRecipient,
} from "./promotionCampaign";

const CAMPAIGNS_COLLECTION = "promotion_campaigns";
const SUPPRESSIONS_COLLECTION = "promotion_suppressions";

export function createNewCampaignId(courseId: string): string {
  const cleanCourse = (courseId || "course").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `promo_${cleanCourse}_${Date.now()}_${rand}`.slice(0, 96);
}

/**
 * Strips large inline base64 bytes before persisting campaign metadata to Firestore
 * (preserving Firestore document limits and Spark plan bandwidth).
 */
export function buildFirestoreCampaignRecord(params: {
  campaignId: string;
  courseId: string;
  courseTitle: string;
  language: CampaignLanguage;
  template: PromotionTemplateData;
  registrationUrl: string;
  poster: PosterConfig;
  recipientsCount: number;
  suppressedCount: number;
  batchSize?: number;
  adminUid: string;
  adminEmail: string;
  existingCreatedAt?: string;
}): PromotionCampaignDoc {
  const now = new Date().toISOString();
  const posterMeta =
    params.poster.mode === "inline_cid"
      ? {
          mimeType: params.poster.inlineMimeType || "image/jpeg",
          filename: params.poster.inlineFilename || "course_poster.jpg",
          ...(params.poster.width ? { width: params.poster.width } : {}),
          ...(params.poster.height ? { height: params.poster.height } : {}),
          ...(params.poster.byteSize ? { byteSize: params.poster.byteSize } : {}),
        }
      : undefined;

  const docData: PromotionCampaignDoc = {
    id: params.campaignId,
    courseId: params.courseId,
    courseTitle: params.courseTitle,
    language: params.language,
    subject: params.template.subject.trim().slice(0, 300),
    template: params.template,
    registrationUrl: params.registrationUrl.trim().slice(0, 1000),
    posterMode: params.poster.mode,
    ...(params.poster.publicUrl ? { posterUrl: params.poster.publicUrl } : {}),
    ...(posterMeta ? { posterMeta } : {}),
    status: params.recipientsCount > 0 ? "ready" : "draft",
    totalRecipients: params.recipientsCount,
    sentCount: 0,
    failedCount: 0,
    pendingCount: params.recipientsCount,
    unknownCount: 0,
    skippedCount: 0,
    suppressedCount: params.suppressedCount,
    batchSize: params.batchSize || DEFAULT_PROMOTION_BATCH_SIZE,
    createdByAdminUid: params.adminUid,
    createdByAdminEmail: params.adminEmail,
    createdAt: params.existingCreatedAt || now,
    updatedAt: now,
  };

  return docData;
}

export async function saveCampaignAndRecipients(params: {
  campaign: PromotionCampaignDoc;
  recipients: ValidatedRecipient[];
}): Promise<void> {
  const { campaign, recipients } = params;
  const campaignRef = doc(db, CAMPAIGNS_COLLECTION, campaign.id);

  // Clean optional undefined values at top level
  const cleanCampaign: Record<string, any> = {};
  Object.entries(campaign).forEach(([k, v]) => {
    if (v !== undefined) cleanCampaign[k] = v;
  });

  await setDoc(campaignRef, cleanCampaign, { merge: true });

  // Persist per-recipient docs using chunked writeBatch (<= 400 ops/batch to stay well under 500)
  const recipientsColl = collection(db, CAMPAIGNS_COLLECTION, campaign.id, "recipients");
  const now = new Date().toISOString();
  const CHUNK_SIZE = 380;

  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const slice = recipients.slice(i, i + CHUNK_SIZE);

    for (const r of slice) {
      const recRef = doc(recipientsColl, r.id);
      const docPayload: PromotionRecipientDoc = {
        id: r.id,
        campaignId: campaign.id,
        email: r.email,
        name: r.name || "",
        department: r.department || "",
        source: r.source,
        status: "pending",
        attempts: 0,
        updatedAt: now,
      };
      batch.set(recRef, docPayload);
    }

    await batch.commit();
  }
}

export async function listPromotionCampaigns(): Promise<PromotionCampaignDoc[]> {
  const q = query(collection(db, CAMPAIGNS_COLLECTION), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as PromotionCampaignDoc[];
}

export async function getPromotionCampaign(campaignId: string): Promise<PromotionCampaignDoc | null> {
  const snap = await getDoc(doc(db, CAMPAIGNS_COLLECTION, campaignId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as PromotionCampaignDoc;
}

export async function listCampaignRecipients(campaignId: string): Promise<PromotionRecipientDoc[]> {
  const snap = await getDocs(collection(db, CAMPAIGNS_COLLECTION, campaignId, "recipients"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as PromotionRecipientDoc[];
}

export async function recomputeAndSyncCampaignCounts(campaignId: string): Promise<PromotionCampaignDoc | null> {
  const [campaignSnap, recSnap] = await Promise.all([
    getDoc(doc(db, CAMPAIGNS_COLLECTION, campaignId)),
    getDocs(collection(db, CAMPAIGNS_COLLECTION, campaignId, "recipients")),
  ]);
  if (!campaignSnap.exists()) return null;

  let sentCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  let unknownCount = 0;
  let skippedCount = 0;

  recSnap.docs.forEach((d) => {
    const s = (d.data()?.status || "pending") as RecipientDeliveryStatus;
    if (s === "sent") sentCount++;
    else if (s === "failed") failedCount++;
    else if (s === "unknown" || s === "processing") unknownCount++;
    else if (s === "skipped") skippedCount++;
    else pendingCount++;
  });

  const totalRecipients = recSnap.docs.length;
  let nextStatus: CampaignStatus = "ready";
  if (totalRecipients === 0) {
    nextStatus = "draft";
  } else if (pendingCount > 0 && (sentCount > 0 || failedCount > 0 || unknownCount > 0)) {
    nextStatus = "paused";
  } else if (pendingCount === 0 && (failedCount > 0 || unknownCount > 0)) {
    nextStatus = "completed_with_issues";
  } else if (pendingCount === 0) {
    nextStatus = "completed";
  }

  const now = new Date().toISOString();
  await updateDoc(doc(db, CAMPAIGNS_COLLECTION, campaignId), {
    totalRecipients,
    sentCount,
    failedCount,
    pendingCount,
    unknownCount,
    skippedCount,
    status: nextStatus,
    updatedAt: now,
  });

  return {
    id: campaignSnap.id,
    ...campaignSnap.data(),
    totalRecipients,
    sentCount,
    failedCount,
    pendingCount,
    unknownCount,
    skippedCount,
    status: nextStatus,
    updatedAt: now,
  } as PromotionCampaignDoc;
}

/**
 * Requires explicit Admin review decision before changing `unknown` delivery records
 * (prevents blind automatic resends that could duplicate emails).
 */
export async function resolveUnknownRecipientsDecision(params: {
  campaignId: string;
  recipientIds: string[];
  targetStatus: "pending" | "skipped" | "sent";
  adminNote: string;
}): Promise<number> {
  const { campaignId, recipientIds, targetStatus, adminNote } = params;
  if (recipientIds.length === 0) return 0;

  const coll = collection(db, CAMPAIGNS_COLLECTION, campaignId, "recipients");
  const now = new Date().toISOString();
  const CHUNK_SIZE = 380;

  for (let i = 0; i < recipientIds.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const slice = recipientIds.slice(i, i + CHUNK_SIZE);
    for (const rid of slice) {
      batch.update(doc(coll, rid), {
        status: targetStatus,
        error: adminNote,
        updatedAt: now,
      });
    }
    await batch.commit();
  }

  await recomputeAndSyncCampaignCounts(campaignId);
  return recipientIds.length;
}

export async function listSuppressionList(): Promise<SuppressionEntry[]> {
  const q = query(collection(db, SUPPRESSIONS_COLLECTION), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as SuppressionEntry[];
}

export async function addSuppressionEntry(params: {
  email: string;
  reason: string;
  adminUid: string;
  adminEmail?: string;
}): Promise<SuppressionEntry> {
  const cleanEmail = normalizeEmailAddress(params.email);
  if (!isAuthorizedUniversityEmail(cleanEmail)) {
    throw new Error("รองรับการเพิ่มรายชื่อ @bu.ac.th ใน Suppression List เท่านั้น");
  }
  const id = buildSuppressionDocId(cleanEmail);
  const now = new Date().toISOString();
  const entry: SuppressionEntry = {
    id,
    email: cleanEmail,
    reason: (params.reason || "Admin opt-out / suppression").trim().slice(0, 300),
    addedByAdminUid: params.adminUid,
    ...(params.adminEmail ? { addedByAdminEmail: params.adminEmail } : {}),
    createdAt: now,
  };
  await setDoc(doc(db, SUPPRESSIONS_COLLECTION, id), entry);
  return entry;
}

export async function removeSuppressionEntry(id: string): Promise<void> {
  await deleteDoc(doc(db, SUPPRESSIONS_COLLECTION, id));
}
