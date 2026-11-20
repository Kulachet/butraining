import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit, 
  updateDoc, 
  doc, 
  getDoc,
  setDoc,
  serverTimestamp,
  runTransaction
} from "firebase/firestore";
import { db, auth } from "./firebase";
import { Registration, RegistrationSource, Course, Instructor, Session, SessionAttendance } from "../types";
import { formatInstructorName, getCourseSessions, isMultiDayCourse } from "./utils";

const BU_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@bu\.ac\.th$/i;

export interface WalkInFormInput {
  instructorId?: string;
  userName: string;
  userEmail: string;
  userDepartment: string;
  userPosition?: string;
  checkInAt: string;
  sessionId?: string;
  confirmAttended: boolean;
}

export interface WalkInValidationResult {
  isValid: boolean;
  errors: {
    instructorId?: string;
    userName?: string;
    userEmail?: string;
    userDepartment?: string;
    checkInAt?: string;
    confirmAttended?: string;
    general?: string;
  };
}

export function getRegistrationSource(reg: Partial<Registration> | null | undefined): RegistrationSource {
  return reg?.source === "walk_in" ? "walk_in" : "online";
}

export function findDuplicateCourseRegistration(
  registrations: Registration[],
  criteria: { email?: string; instructorId?: string; excludeRegId?: string }
): Registration | null {
  const emailNorm = (criteria.email || "").trim().toLowerCase();
  const idNorm = (criteria.instructorId || "").trim().toLowerCase();

  if (!emailNorm && !idNorm) return null;

  for (const reg of registrations) {
    if (criteria.excludeRegId && reg.id === criteria.excludeRegId) continue;

    const regEmail = (reg.userEmail || "").trim().toLowerCase();
    const regInstId = (reg.instructorId || "").trim().toLowerCase();

    if (emailNorm && regEmail && regEmail === emailNorm) {
      return reg;
    }
    if (idNorm && regInstId && regInstId === idNorm) {
      return reg;
    }
  }

  return null;
}

export function validateWalkInFormData(
  input: WalkInFormInput,
  options: { requireAttendanceConfirmation?: boolean } = {}
): WalkInValidationResult {
  const errors: WalkInValidationResult["errors"] = {};
  const cleanName = (input.userName || "").trim();
  const cleanEmail = (input.userEmail || "").trim().toLowerCase();
  const cleanDept = (input.userDepartment || "").trim();

  if (!cleanName) {
    errors.userName = "กรุณากรอกชื่อ-นามสกุลผู้เข้าร่วมอบรม";
  }

  if (!cleanEmail) {
    errors.userEmail = "กรุณากรอกอีเมลมหาวิทยาลัย (@bu.ac.th)";
  } else if (!BU_EMAIL_REGEX.test(cleanEmail)) {
    errors.userEmail = "อีเมลต้องใช้นามสกุล @bu.ac.th เท่านั้น";
  }

  if (!cleanDept) {
    errors.userDepartment = "กรุณาเลือกหรือระบุคณะ / หน่วยงาน";
  }

  if (!input.checkInAt || isNaN(new Date(input.checkInAt).getTime())) {
    errors.checkInAt = "กรุณาระบุวันและเวลาเข้าอบรมที่ถูกต้อง";
  }

  if (options.requireAttendanceConfirmation !== false && !input.confirmAttended) {
    errors.confirmAttended = "กรุณายืนยันว่าผู้เข้าร่วมได้เข้าอบรมจริง";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

function sanitizeDocIdSegment(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export function buildWalkInDocId(courseId: string, email: string, instructorId?: string): string {
  const coursePart = sanitizeDocIdSegment(courseId) || "course";
  const identityRaw = email?.trim() ? email.trim().toLowerCase() : (instructorId || "").trim().toLowerCase();
  const identityPart = sanitizeDocIdSegment(identityRaw) || `w_${Date.now()}`;
  return `walkin_${coursePart}_${identityPart}`;
}

export function buildSessionAttendanceEntry(params: {
  attended: boolean;
  checkInAt?: string | null;
  checkInSequenceNumber?: number | null;
  sessionDate?: string | null;
  sessionName?: string | null;
}): SessionAttendance {
  const entry: SessionAttendance = {
    attended: Boolean(params.attended),
  };

  if (params.attended) {
    if (params.checkInAt) {
      entry.checkInAt = params.checkInAt;
    }
    if (
      typeof params.checkInSequenceNumber === "number" &&
      !isNaN(params.checkInSequenceNumber) &&
      params.checkInSequenceNumber > 0
    ) {
      entry.checkInSequenceNumber = params.checkInSequenceNumber;
    }
  }

  if (params.sessionDate) {
    entry.sessionDate = params.sessionDate;
  }
  if (params.sessionName) {
    entry.sessionName = params.sessionName;
  }

  return entry;
}

export function sanitizeAttendedSessionsMap(
  map?: Record<string, SessionAttendance> | null
): Record<string, SessionAttendance> {
  const clean: Record<string, SessionAttendance> = {};
  if (!map || typeof map !== "object") return clean;

  for (const [key, val] of Object.entries(map)) {
    if (!val || typeof val !== "object") continue;
    clean[key] = buildSessionAttendanceEntry({
      attended: Boolean(val.attended),
      checkInAt: val.checkInAt ?? null,
      checkInSequenceNumber: val.checkInSequenceNumber ?? null,
      sessionDate: val.sessionDate ?? null,
      sessionName: val.sessionName ?? null,
    });
  }

  return clean;
}

export function buildCandidateOnlineDocIds(
  course: Pick<Course, "id" | "sessions">,
  uid: string,
  targetSessionId?: string
): string[] {
  if (!course?.id || !uid) return [];
  const ids = new Set<string>([
    `${course.id}_${uid}`,
    `${course.id}_default_${uid}`,
  ]);
  if (targetSessionId) {
    ids.add(`${course.id}_${targetSessionId}_${uid}`);
  }
  if (Array.isArray(course.sessions)) {
    for (const s of course.sessions) {
      const sid = (s as any)?.sessionId || s?.id;
      if (sid) ids.add(`${course.id}_${sid}_${uid}`);
    }
  }
  return Array.from(ids);
}

async function findLinkedInstructorUids(
  rawEmail: string,
  cleanEmail: string,
  cleanInstructorId: string
): Promise<string[]> {
  const uids = new Set<string>();
  try {
    const emailCandidates = Array.from(
      new Set([cleanEmail, rawEmail.trim()].filter(Boolean))
    );
    for (const em of emailCandidates) {
      const snap = await getDocs(
        query(collection(db, "instructors"), where("email", "==", em), limit(5))
      );
      snap.forEach((d) => {
        const uid = d.data()?.uid;
        if (typeof uid === "string" && uid.trim()) uids.add(uid.trim());
      });
    }
    if (cleanInstructorId) {
      const idSnap = await getDocs(
        query(collection(db, "instructors"), where("id", "==", cleanInstructorId), limit(5))
      );
      idSnap.forEach((d) => {
        const uid = d.data()?.uid;
        if (typeof uid === "string" && uid.trim()) uids.add(uid.trim());
      });
    }
  } catch {
    // Best-effort lookup; pre-transaction course query + deterministic refs still guard writes
  }
  return Array.from(uids);
}

export const RegistrationService = {
  async registerForCourse(course: Course, instructor: Instructor, session?: Session) {
    if (!instructor?.uid) {
      throw new Error("กรุณาเข้าสู่ระบบก่อนลงทะเบียน");
    }
    if (!course?.id) {
      throw new Error("ไม่พบข้อมูลหลักสูตร");
    }

    const courseRef = doc(db, "courses", course.id);
    const isMulti = isMultiDayCourse(course);

    // 1. Verify existing registration across all formats before creating document
    // (A) Check Firestore query for any active registration by courseId + userId
    const existingQ = query(
      collection(db, "registrations"),
      where("courseId", "==", course.id),
      where("userId", "==", instructor.uid),
      limit(1)
    );
    const existingSnap = await getDocs(existingQ);
    if (!existingSnap.empty) {
      throw new Error("Already registered for this course");
    }

    // (B) Verify remaining capacity and check cross-source duplicates (including Walk-in)
    const allRegsSnap = await getDocs(
      query(collection(db, "registrations"), where("courseId", "==", course.id))
    );
    const existingCourseRegs = allRegsSnap.docs.map(
      (d) => ({ id: d.id, ...d.data() } as Registration)
    );
    const crossSourceDup = findDuplicateCourseRegistration(existingCourseRegs, {
      email: instructor.email,
      instructorId: instructor.id,
    });
    if (crossSourceDup) {
      throw new Error("Already registered for this course");
    }

    const actualRegisteredCount = allRegsSnap.size;
    const maxCapacity = course.maxSeats || (course.sessions && course.sessions[0]?.maxSeats) || 50;
    if (actualRegisteredCount >= maxCapacity) {
      throw new Error("Course is full");
    }

    // Determine target sessionId and registration document ID
    const targetSessionId = isMulti 
      ? (course.sessions?.[0]?.sessionId || "default")
      : (session?.sessionId || "default");
    const targetSessionName = isMulti
      ? (course.sessions?.[0]?.sessionName || "กำหนดการอบรม")
      : (session?.sessionName || null);

    const regId = `${course.id}_${targetSessionId}_${instructor.uid}`;
    const regRef = doc(db, "registrations", regId);

    // Deterministic legacy & walk-in references to check inside transaction
    const legacyRef = doc(db, "registrations", `${course.id}_${instructor.uid}`);
    const defaultRef = doc(db, "registrations", `${course.id}_default_${instructor.uid}`);
    const walkInRef = doc(
      db,
      "registrations",
      buildWalkInDocId(course.id, instructor.email || "", instructor.id)
    );

    return await runTransaction(db, async (transaction) => {
      // 2. Transactional uniqueness checks:
      const regDoc = await transaction.get(regRef);
      if (regDoc.exists()) throw new Error("Already registered for this course");

      const legacyDoc = await transaction.get(legacyRef);
      if (legacyDoc.exists()) throw new Error("Already registered for this course");

      const defaultDoc = await transaction.get(defaultRef);
      if (defaultDoc.exists()) throw new Error("Already registered for this course");

      const walkInDoc = await transaction.get(walkInRef);
      if (walkInDoc.exists()) throw new Error("Already registered for this course");

      // 3. Get fresh course data to verify capacity and compute sequence
      const courseDoc = await transaction.get(courseRef);
      if (!courseDoc.exists()) throw new Error("Course not found");
      
      const currentCourse = courseDoc.data() as Course;
      const currentEnrolled = Math.max(currentCourse.enrolledSeats || 0, actualRegisteredCount);
      const courseMaxSeats = currentCourse.maxSeats || maxCapacity;

      if (currentEnrolled >= courseMaxSeats) {
        throw new Error("Course is full");
      }

      let updatedSessions = [...(currentCourse.sessions || [])];
      let newEnrolled = currentEnrolled + 1;
      let nextSequence = Math.max(currentCourse.totalRegistrations || 0, actualRegisteredCount) + 1;

      if (isMulti) {
        // Multi-day workshop: learners enroll once for the entire workshop cohort.
        // Synchronize all sessions with the updated cohort seat count.
        updatedSessions = updatedSessions.map(s => ({
          ...s,
          enrolledSeats: newEnrolled
        }));
      } else if (session) {
        const sessionIndex = updatedSessions.findIndex(s => s.sessionId === session.sessionId);
        if (sessionIndex !== -1) {
          if ((updatedSessions[sessionIndex].enrolledSeats || 0) >= (updatedSessions[sessionIndex].maxSeats || courseMaxSeats)) {
            throw new Error("Session is full");
          }
          updatedSessions[sessionIndex].enrolledSeats = (updatedSessions[sessionIndex].enrolledSeats || 0) + 1;
        }
        newEnrolled = updatedSessions.reduce((sum, s) => sum + (s.enrolledSeats || 0), 0);
      }

      // 4. Update course document atomically
      transaction.update(courseRef, { 
        sessions: updatedSessions,
        enrolledSeats: newEnrolled,
        totalRegistrations: nextSequence
      });

      // 5. Create registration doc: attended starts false, attendedSessions starts {}
      const regData = {
        courseId: course.id,
        courseTitle: course.title,
        sessionId: targetSessionId,
        sessionName: targetSessionName,
        source: "online" as RegistrationSource,
        userId: instructor.uid,
        instructorId: instructor.id,
        userName: instructor.name,
        ...(instructor.englishFullName ? { 
          userEnglishName: instructor.englishFullName.trim(),
        } : {}),
        userEmail: instructor.email,
        userPosition: instructor.position || "",
        userDepartment: instructor.department,
        sequenceNumber: nextSequence,
        attended: false,
        attendedSessions: {},
        registeredAt: new Date().toISOString(),
      };

      transaction.set(regRef, regData);

      return { id: regRef.id, ...regData };
    });
  },

  async cancelRegistration(courseId: string, userId: string, sessionId?: string, registrationId?: string) {
    if (!userId) {
      throw new Error("กรุณาเข้าสู่ระบบก่อนทำรายการ");
    }
    if (!courseId) {
      throw new Error("ไม่พบข้อมูลหลักสูตร");
    }

    const courseRef = doc(db, "courses", courseId);

    // Step 1: Locate the registration DocumentReference
    let regRef = null;

    // Strategy A: If registrationId was provided directly
    if (registrationId) {
      const directRef = doc(db, "registrations", registrationId);
      const directSnap = await getDoc(directRef);
      if (directSnap.exists()) {
        const data = directSnap.data();
        if (data.userId === userId && data.courseId === courseId) {
          regRef = directRef;
        }
      }
    }

    // Strategy B: Deterministic ID with provided sessionId
    if (!regRef && sessionId) {
      const sessionRef = doc(db, "registrations", `${courseId}_${sessionId}_${userId}`);
      const sessionSnap = await getDoc(sessionRef);
      if (sessionSnap.exists()) {
        regRef = sessionRef;
      }
    }

    // Strategy C: Deterministic ID with "default" session
    if (!regRef) {
      const defaultRef = doc(db, "registrations", `${courseId}_default_${userId}`);
      const defaultSnap = await getDoc(defaultRef);
      if (defaultSnap.exists()) {
        regRef = defaultRef;
      }
    }

    // Strategy D: Deterministic ID legacy (courseId_userId)
    if (!regRef) {
      const legacyRef = doc(db, "registrations", `${courseId}_${userId}`);
      const legacySnap = await getDoc(legacyRef);
      if (legacySnap.exists()) {
        regRef = legacyRef;
      }
    }

    // Strategy E: Check course's sessions if course has sessions and sessionId was omitted
    if (!regRef) {
      const courseSnap = await getDoc(courseRef);
      if (courseSnap.exists()) {
        const courseData = courseSnap.data() as Course;
        if (courseData.sessions && courseData.sessions.length > 0) {
          for (const s of courseData.sessions) {
            const sRef = doc(db, "registrations", `${courseId}_${s.sessionId}_${userId}`);
            const sSnap = await getDoc(sRef);
            if (sSnap.exists()) {
              regRef = sRef;
              break;
            }
          }
        }
      }
    }

    // Strategy F: Targeted Firestore query with minimum necessary filters (NO full collection scan)
    if (!regRef) {
      const q = sessionId
        ? query(
            collection(db, "registrations"),
            where("courseId", "==", courseId),
            where("userId", "==", userId),
            where("sessionId", "==", sessionId),
            limit(1)
          )
        : query(
            collection(db, "registrations"),
            where("courseId", "==", courseId),
            where("userId", "==", userId),
            limit(1)
          );
      const querySnap = await getDocs(q);
      if (!querySnap.empty) {
        regRef = querySnap.docs[0].ref;
      }
    }

    if (!regRef) {
      throw new Error("ไม่พบข้อมูลการลงทะเบียน กรุณารีเฟรชหน้าแล้วลองอีกครั้ง");
    }

    // Step 2: Atomic Transaction to delete registration and update course seat counts
    return await runTransaction(db, async (transaction) => {
      const regDoc = await transaction.get(regRef!);
      if (!regDoc.exists()) {
        throw new Error("ไม่พบข้อมูลการลงทะเบียน กรุณารีเฟรชหน้าแล้วลองอีกครั้ง");
      }
      const regData = regDoc.data() as Registration;

      // Ownership and identifiers verification
      if (regData.source === "walk_in") {
        throw new Error("ไม่สามารถยกเลิกรายการ Walk-in ด้วยตนเองได้");
      }
      if (regData.userId !== userId) {
        throw new Error("คุณไม่มีสิทธิ์ยกเลิกการลงทะเบียนนี้");
      }
      if (regData.courseId !== courseId) {
        throw new Error("ข้อมูลหลักสูตรไม่ตรงกัน");
      }
      if (sessionId && regData.sessionId && regData.sessionId !== sessionId) {
        throw new Error("ข้อมูลเซสชันไม่ตรงกัน");
      }

      // Read current course data
      const courseDoc = await transaction.get(courseRef);
      if (!courseDoc.exists()) {
        throw new Error("ไม่พบข้อมูลหลักสูตร");
      }
      const currentCourse = courseDoc.data() as Course;

      // Update session seats
      let updatedSessions = [...(currentCourse.sessions || [])];
      let enrolledSeats = currentCourse.enrolledSeats || 0;
      const isMulti = isMultiDayCourse(currentCourse);

      if (isMulti) {
        // Multi-day workshop: cohort enrollment is decremented by 1
        enrolledSeats = Math.max(0, enrolledSeats - 1);
        updatedSessions = updatedSessions.map(s => ({
          ...s,
          enrolledSeats: Math.max(0, (s.enrolledSeats || 1) - 1)
        }));
      } else {
        if (regData.sessionId) {
          let sessionIndex = updatedSessions.findIndex(s => s.sessionId === regData.sessionId);
          
          // If session ID not found (orphaned), default to the first session if available
          if (sessionIndex === -1 && updatedSessions.length > 0) {
            sessionIndex = 0;
          }

          if (sessionIndex !== -1 && (updatedSessions[sessionIndex].enrolledSeats || 0) > 0) {
            updatedSessions[sessionIndex].enrolledSeats -= 1;
          }
        } else {
          // Legacy course or single session
          if (updatedSessions.length > 0 && (updatedSessions[0].enrolledSeats || 0) > 0) {
            updatedSessions[0].enrolledSeats -= 1;
          } else if (enrolledSeats > 0) {
            enrolledSeats -= 1;
          }
        }

        // Maintain consistency of enrolledSeats with sessions
        if (updatedSessions.length > 0) {
          enrolledSeats = updatedSessions.reduce((sum, s) => sum + (s.enrolledSeats || 0), 0);
        } else if (enrolledSeats > 0) {
          enrolledSeats -= 1;
        }
      }

      // Update total registrations count
      const newTotal = Math.max(0, (currentCourse.totalRegistrations || 0) - 1);

      // Update course document
      transaction.update(courseRef, { 
        sessions: updatedSessions,
        enrolledSeats: enrolledSeats,
        totalRegistrations: newTotal
      });

      // Delete the registration doc
      transaction.delete(regRef!);
    });
  },

  async toggleAttendance(registrationId: string, attended: boolean) {
    const regRef = doc(db, "registrations", registrationId);
    await updateDoc(regRef, { attended });
  },

  /**
   * Performs check-in for a specific training session or single-day course.
   * - Validates session belongs to course.
   * - Enforces idempotency (repeated check-in does not alter sequence or duplicate attendance).
   * - Records session attendance in attendedSessions map indexed by CourseSession.id.
   * - Keeps legacy attended field synchronized for backward compatibility.
   */
  async checkInSession(courseId: string, userId: string, targetSessionId?: string) {
    if (!userId) throw new Error("กรุณาเข้าสู่ระบบก่อนเช็คอิน");
    if (!courseId) throw new Error("ไม่พบข้อมูลหลักสูตร");

    // 1. Fetch Course
    const courseRef = doc(db, "courses", courseId);
    const courseSnap = await getDoc(courseRef);
    if (!courseSnap.exists()) throw new Error("ไม่พบข้อมูลหลักสูตรในระบบ");
    const course = { id: courseSnap.id, ...courseSnap.data() } as Course;

    const courseSessions = getCourseSessions(course);
    const isMulti = courseSessions.length > 1;

    // 2. Resolve Active Session
    let activeSession = null;
    if (targetSessionId) {
      activeSession = courseSessions.find(s => s.id === targetSessionId || (s as any).sessionId === targetSessionId);
      if (!activeSession) {
        throw new Error("เซสชันหรือวันอบรมที่ระบุไม่ถูกต้องหรือไม่พบในหลักสูตรนี้");
      }
    } else if (isMulti) {
      // If multi-day and no session specified, check if today matches any session
      const todayStr = new Date().toISOString().split("T")[0];
      activeSession = courseSessions.find(s => s.date === todayStr);
      if (!activeSession) {
        // Return notice that session selection is required
        return {
          success: false,
          requiresSessionSelection: true,
          availableSessions: courseSessions,
          message: "หลักสูตรนี้จัดอบรมหลายวัน กรุณาเลือกวันที่ต้องการเช็คอิน",
        };
      }
    } else {
      // Single-day course default session
      activeSession = courseSessions[0] || {
        id: "default",
        date: course.date || "",
        startTime: course.startTime || "09:00",
        endTime: course.endTime || "12:00",
        sessionName: "การอบรม",
      };
    }

    const sessionIdToRecord = activeSession.id || (activeSession as any).sessionId || "default";

    // 3. Find Registration document for user in course
    let regRef = null;
    let regData: Registration | null = null;

    // Try direct ID
    const directRef1 = doc(db, "registrations", `${courseId}_${userId}`);
    const directSnap1 = await getDoc(directRef1);
    if (directSnap1.exists()) {
      regRef = directRef1;
      regData = { id: directSnap1.id, ...directSnap1.data() } as Registration;
    }

    if (!regRef) {
      const directRef2 = doc(db, "registrations", `${courseId}_default_${userId}`);
      const directSnap2 = await getDoc(directRef2);
      if (directSnap2.exists()) {
        regRef = directRef2;
        regData = { id: directSnap2.id, ...directSnap2.data() } as Registration;
      }
    }

    if (!regRef && course.sessions && course.sessions.length > 0) {
      for (const s of course.sessions) {
        const sRef = doc(db, "registrations", `${courseId}_${(s as any).sessionId || s.id}_${userId}`);
        const sSnap = await getDoc(sRef);
        if (sSnap.exists()) {
          regRef = sRef;
          regData = { id: sSnap.id, ...sSnap.data() } as Registration;
          break;
        }
      }
    }

    if (!regRef) {
      const q = query(
        collection(db, "registrations"),
        where("courseId", "==", courseId),
        where("userId", "==", userId),
        limit(1)
      );
      const querySnap = await getDocs(q);
      if (!querySnap.empty) {
        regRef = querySnap.docs[0].ref;
        regData = { id: querySnap.docs[0].id, ...querySnap.docs[0].data() } as Registration;
      }
    }

    if (!regRef || !regData) {
      throw new Error("คุณยังไม่ได้ลงทะเบียนในหลักสูตรนี้");
    }

    // 4. Idempotency Check: Already checked in for this session?
    const existingAttendedMap = regData.attendedSessions || {};
    const existingSessionAttendance = existingAttendedMap[sessionIdToRecord];
    
    // For single day without attendedSessions map yet, check legacy attended
    if (!isMulti && regData.attended) {
      return {
        success: true,
        isAlreadyCheckedIn: true,
        session: activeSession,
        registration: regData,
        message: "คุณได้เช็คอินเรียบร้อยแล้วก่อนหน้านี้",
      };
    }

    if (existingSessionAttendance && existingSessionAttendance.attended) {
      return {
        success: true,
        isAlreadyCheckedIn: true,
        session: activeSession,
        registration: regData,
        message: `คุณได้เช็คอินสำหรับ ${activeSession.sessionName || "วันนี้"} เรียบร้อยแล้วก่อนหน้านี้`,
      };
    }

    // 5. Calculate check-in sequence number
    const qAttendees = query(
      collection(db, "registrations"),
      where("courseId", "==", courseId),
      where("attended", "==", true)
    );
    const attendeesSnap = await getDocs(qAttendees);
    const nextSequence = attendeesSnap.size + 1;
    const nowIso = new Date().toISOString();

    // 6. Prepare updated attendedSessions map
    const newAttendedMap: Record<string, SessionAttendance> = {
      ...existingAttendedMap,
      [sessionIdToRecord]: {
        attended: true,
        checkInAt: nowIso,
        checkInSequenceNumber: nextSequence,
        sessionDate: activeSession.date,
        sessionName: activeSession.sessionName || "วันอบรม",
      },
    };

    const updatePayload = {
      attended: true,
      checkInAt: nowIso,
      checkInSequenceNumber: nextSequence,
      attendedSessions: newAttendedMap,
    };

    await updateDoc(regRef, updatePayload);

    const updatedRegistration: Registration = {
      ...regData,
      ...updatePayload,
    };

    return {
      success: true,
      isAlreadyCheckedIn: false,
      session: activeSession,
      registration: updatedRegistration,
      message: `เช็คอินสำเร็จ (${activeSession.sessionName || "วันอบรม"})! ยินดีต้อนรับเข้าสู่การอบรม`,
    };
  },

  /**
   * Admin function to toggle per-session attendance
   */
  async toggleSessionAttendance(
    registrationId: string, 
    sessionId: string, 
    newStatus: boolean, 
    sessionDate?: string, 
    sessionName?: string
  ) {
    const regRef = doc(db, "registrations", registrationId);
    const regSnap = await getDoc(regRef);
    if (!regSnap.exists()) throw new Error("ไม่พบข้อมูลการลงทะเบียน");

    const data = regSnap.data() as Registration;
    const currentMap = sanitizeAttendedSessionsMap(data.attendedSessions);
    const prevSession = currentMap[sessionId];

    const updatedMap: Record<string, SessionAttendance> = {
      ...currentMap,
      [sessionId]: buildSessionAttendanceEntry({
        attended: newStatus,
        checkInAt: newStatus ? (prevSession?.checkInAt || new Date().toISOString()) : null,
        checkInSequenceNumber: newStatus ? (prevSession?.checkInSequenceNumber || 1) : null,
        sessionDate: sessionDate || prevSession?.sessionDate || null,
        sessionName: sessionName || prevSession?.sessionName || null,
      }),
    };

    // Calculate overall attended flag: true if any session was attended
    const anyAttended = Object.values(updatedMap).some(s => s.attended);

    await updateDoc(regRef, {
      attended: anyAttended,
      attendedSessions: updatedMap,
    });
  },

  async sendCertificates(course: Course, registrations: Registration[]) {
    const mailRef = collection(db, "mail");
    const attendedUsers = registrations.filter(r => r.attended);

    // Look up current master instructor data for up-to-date ID, name, and position
    const instructorDocs = await getDocs(collection(db, "instructors"));
    const instructorMap = new Map<string, { id: string; name: string; position?: string }>();
    instructorDocs.forEach(d => {
      const data = d.data();
      if (data.id) {
        const item = { id: data.id, name: data.name, position: data.position };
        instructorMap.set(data.id.toLowerCase().trim(), item);
        if (data.email) {
          instructorMap.set(data.email.toLowerCase().trim(), item);
        }
      }
    });

    for (const reg of attendedUsers) {
      const certificateUrl = `https://drive.google.com/uc?id=${course.driveFolderId}&export=download&filename=${reg.sequenceNumber}.png`;
      const emailKey = reg.userEmail?.toLowerCase().trim();
      const idKey = reg.instructorId?.toLowerCase().trim();
      const matched = (emailKey && instructorMap.get(emailKey)) || (idKey && instructorMap.get(idKey));

      const resolvedId = matched?.id || reg.instructorId;
      const resolvedName = matched?.name || reg.userName;
      const resolvedPos = matched?.position !== undefined ? matched.position : reg.userPosition;

      const formattedName = formatInstructorName(resolvedName, resolvedId, resolvedPos);

      await addDoc(mailRef, {
        to: reg.userEmail,
        message: {
          subject: `ประกาศนียบัตรหลักสูตร: ${course.title}`,
          text: `เรียน ${formattedName}\n\nขอแสดงความยินดี! ท่านได้ผ่านการอบรมหลักสูตร "${course.title}" เรียบร้อยแล้ว\nท่านสามารถดาวน์โหลดประกาศนียบัตรได้จากลิงก์ด้านล่าง:\n${certificateUrl}\n\nขอบคุณที่ร่วมเป็นส่วนหนึ่งในการพัฒนาศักยภาพอาจารย์กับเรา\nสำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
              <h3 style="color: #1e3a8a; margin-top: 0;">เรียน ${formattedName},</h3>
              <h2 style="color: #991b1b; margin-top: 10px;">ขอแสดงความยินดี!</h2>
              <p>ท่านได้ผ่านการอบรมหลักสูตร <b>${course.title}</b> เรียบร้อยแล้ว</p>
              <p>ท่านสามารถดาวน์โหลดประกาศนียบัตรได้จากลิงก์ด้านล่าง:</p>
              <div style="margin: 25px 0;">
                <a href="${certificateUrl}" style="background: #991b1b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">ดาวน์โหลดประกาศนียบัตร</a>
              </div>
              <p style="color: #475569;">ขอบคุณที่ร่วมเป็นส่วนหนึ่งในการพัฒนาศักยภาพอาจารย์กับเรา</p>
              <p style="margin-top: 25px; font-weight: bold; color: #1e3a8a;">สำนักพัฒนาการเรียนรู้ (Learning Development Office)<br/>มหาวิทยาลัยกรุงเทพ</p>
            </div>
          `,
        },
        createdAt: serverTimestamp(),
      });
    }
  },

  async sendReminder(course: Course, registrations: Registration[]) {
    const mailRef = collection(db, "mail");
    
    // Look up current master instructor data for up-to-date ID, name, and position
    const instructorDocs = await getDocs(collection(db, "instructors"));
    const instructorMap = new Map<string, { id: string; name: string; position?: string }>();
    instructorDocs.forEach(d => {
      const data = d.data();
      if (data.id) {
        const item = { id: data.id, name: data.name, position: data.position };
        instructorMap.set(data.id.toLowerCase().trim(), item);
        if (data.email) {
          instructorMap.set(data.email.toLowerCase().trim(), item);
        }
      }
    });

    for (const reg of registrations) {
      const sessionInfo = reg.sessionName ? ` (เซสชัน: ${reg.sessionName})` : "";
      const emailKey = reg.userEmail?.toLowerCase().trim();
      const idKey = reg.instructorId?.toLowerCase().trim();
      const matched = (emailKey && instructorMap.get(emailKey)) || (idKey && instructorMap.get(idKey));

      const resolvedId = matched?.id || reg.instructorId;
      const resolvedName = matched?.name || reg.userName;
      const resolvedPos = matched?.position !== undefined ? matched.position : reg.userPosition;

      const formattedName = formatInstructorName(resolvedName, resolvedId, resolvedPos);

      await addDoc(mailRef, {
        to: reg.userEmail,
        message: {
          subject: `แจ้งเตือนการอบรม: ${course.title}${sessionInfo}`,
          text: `เรียน ${formattedName}\n\nหลักสูตร "${course.title}" จะเริ่มในวันพรุ่งนี้${sessionInfo}\nวันเวลา: ${course.date}\n\nกรุณาเตรียมตัวให้พร้อมสำหรับการอบรม\nสำนักพัฒนาการเรียนรู้ (Learning Development Office)\nมหาวิทยาลัยกรุงเทพ`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
              <h3 style="color: #1e3a8a; margin-top: 0;">เรียน ${formattedName},</h3>
              <h2 style="color: #991b1b; margin-top: 10px;">แจ้งเตือนการอบรม</h2>
              <p>หลักสูตร <b>${course.title}</b> จะเริ่มในวันพรุ่งนี้</p>
              ${reg.sessionName ? `<p><b>เซสชัน:</b> ${reg.sessionName}</p>` : ""}
              <p><b>วันเวลา:</b> ${course.date}</p>
              <br/>
              <p style="color: #475569;">กรุณาเตรียมตัวให้พร้อมสำหรับการอบรม</p>
              <p style="margin-top: 25px; font-weight: bold; color: #1e3a8a;">สำนักพัฒนาการเรียนรู้ (Learning Development Office)<br/>มหาวิทยาลัยกรุงเทพ</p>
            </div>
          `,
        },
        createdAt: serverTimestamp(),
      });
    }
  },

  /**
   * Administrator-only: Creates a verified Walk-in attendance record without requiring
   * a Firebase Auth UID or self-registration account.
   * Uses a deterministic Walk-in document ID inside a Firestore transaction to prevent
   * concurrent duplicates.
   */
  async addWalkInParticipant(
    course: Course,
    input: WalkInFormInput
  ): Promise<Registration> {
    const adminUser = auth.currentUser;
    if (!adminUser?.uid) {
      throw new Error("กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบก่อนทำรายการ");
    }
    if (!course?.id) {
      throw new Error("ไม่พบข้อมูลหลักสูตร");
    }

    const validation = validateWalkInFormData(input, {
      requireAttendanceConfirmation: true,
    });
    if (!validation.isValid) {
      const firstErr = Object.values(validation.errors)[0] || "ข้อมูล Walk-in ไม่ครบถ้วน";
      throw new Error(firstErr);
    }

    const cleanEmail = input.userEmail.trim().toLowerCase();
    const cleanName = input.userName.trim();
    const cleanDept = input.userDepartment.trim();
    const cleanPosition = (input.userPosition || "").trim();
    const cleanInstructorId = (input.instructorId || "").trim();
    const checkInIso = new Date(input.checkInAt).toISOString();
    const nowIso = new Date().toISOString();

    const courseRef = doc(db, "courses", course.id);
    const courseRegsSnap = await getDocs(
      query(collection(db, "registrations"), where("courseId", "==", course.id))
    );
    const existingRegs = courseRegsSnap.docs.map(
      (d) => ({ id: d.id, ...d.data() } as Registration)
    );

    const duplicate = findDuplicateCourseRegistration(existingRegs, {
      email: cleanEmail,
      instructorId: cleanInstructorId,
    });
    if (duplicate) {
      const dupErr = Object.assign(
        new Error(`พบรายชื่อ "${duplicate.userName}" ลงทะเบียนในหลักสูตรนี้แล้ว`),
        { code: "DUPLICATE_REGISTRATION", existingRegistration: duplicate }
      );
      throw dupErr;
    }

    const walkInDocId = buildWalkInDocId(course.id, cleanEmail, cleanInstructorId);
    const walkInRef = doc(db, "registrations", walkInDocId);

    const courseSessions = getCourseSessions(course);
    const isMulti = courseSessions.length > 1;
    const activeSession =
      (input.sessionId &&
        courseSessions.find(
          (s) => s.id === input.sessionId || (s as any).sessionId === input.sessionId
        )) ||
      courseSessions[0] ||
      null;

    const targetSessionId = isMulti
      ? activeSession?.id || (activeSession as any)?.sessionId || "default"
      : (activeSession as any)?.sessionId || activeSession?.id || "default";
    const targetSessionName = isMulti
      ? activeSession?.sessionName || "วันอบรม"
      : activeSession?.sessionName || null;

    const linkedUids = await findLinkedInstructorUids(
      input.userEmail,
      cleanEmail,
      cleanInstructorId
    );
    const candidateOnlineRefs = linkedUids.flatMap((uid) =>
      buildCandidateOnlineDocIds(course, uid, targetSessionId)
        .filter((id) => id !== walkInDocId)
        .map((id) => doc(db, "registrations", id))
    );

    const maxExistingSeq = existingRegs.reduce(
      (max, r) => Math.max(max, Number(r.sequenceNumber) || 0),
      0
    );
    const maxCheckInSeq = existingRegs.reduce(
      (max, r) => Math.max(max, Number(r.checkInSequenceNumber) || 0),
      0
    );

    return await runTransaction(db, async (transaction) => {
      const existingWalkInSnap = await transaction.get(walkInRef);
      if (existingWalkInSnap.exists()) {
        const dupErr = Object.assign(
          new Error("มีข้อมูลผู้เข้าอบรมรายนี้ในหลักสูตรแล้ว"),
          {
            code: "DUPLICATE_REGISTRATION",
            existingRegistration: {
              id: existingWalkInSnap.id,
              ...existingWalkInSnap.data(),
            } as Registration,
          }
        );
        throw dupErr;
      }

      for (const onlineRef of candidateOnlineRefs) {
        const onlineSnap = await transaction.get(onlineRef);
        if (onlineSnap.exists()) {
          const existingOnline = {
            id: onlineSnap.id,
            ...onlineSnap.data(),
          } as Registration;
          const dupErr = Object.assign(
            new Error(`พบรายชื่อ "${existingOnline.userName}" ลงทะเบียนออนไลน์ในหลักสูตรนี้แล้ว`),
            {
              code: "DUPLICATE_REGISTRATION",
              existingRegistration: existingOnline,
            }
          );
          throw dupErr;
        }
      }

      const courseSnap = await transaction.get(courseRef);
      if (!courseSnap.exists()) {
        throw new Error("ไม่พบข้อมูลหลักสูตรในระบบ");
      }

      const currentCourse = courseSnap.data() as Course;
      const nextSequence =
        Math.max(
          Number(currentCourse.totalRegistrations) || 0,
          maxExistingSeq,
          existingRegs.length
        ) + 1;
      const nextCheckInSeq = maxCheckInSeq + 1;

      let updatedSessions = [...(currentCourse.sessions || [])];
      let newEnrolled = (Number(currentCourse.enrolledSeats) || existingRegs.length) + 1;

      if (isMulti && updatedSessions.length > 0) {
        updatedSessions = updatedSessions.map((s) => ({
          ...s,
          enrolledSeats: (Number(s.enrolledSeats) || 0) + 1,
        }));
      } else if (updatedSessions.length > 0) {
        const sIdx = updatedSessions.findIndex((s) => s.sessionId === targetSessionId);
        const idxToBump = sIdx !== -1 ? sIdx : 0;
        updatedSessions[idxToBump] = {
          ...updatedSessions[idxToBump],
          enrolledSeats: (Number(updatedSessions[idxToBump].enrolledSeats) || 0) + 1,
        };
        newEnrolled = updatedSessions.reduce((sum, s) => sum + (Number(s.enrolledSeats) || 0), 0);
      }

      const attendedSessions: Record<string, SessionAttendance> = {};
      if (targetSessionId) {
        attendedSessions[targetSessionId] = buildSessionAttendanceEntry({
          attended: true,
          checkInAt: checkInIso,
          checkInSequenceNumber: nextCheckInSeq,
          sessionDate: activeSession?.date || course.date || null,
          sessionName: targetSessionName || "การอบรม",
        });
      }

      const newWalkInData: Omit<Registration, "id"> = {
        courseId: course.id,
        courseTitle: course.title,
        sessionId: targetSessionId,
        ...(targetSessionName ? { sessionName: targetSessionName } : {}),
        source: "walk_in",
        userId: null,
        instructorId: cleanInstructorId,
        userName: cleanName,
        userEmail: cleanEmail,
        userPosition: cleanPosition,
        userDepartment: cleanDept,
        sequenceNumber: nextSequence,
        checkInSequenceNumber: nextCheckInSeq,
        checkInAt: checkInIso,
        attended: true,
        attendedSessions,
        registeredAt: checkInIso,
        createdByAdminUid: adminUser.uid,
        createdByAdminEmail: adminUser.email || "",
        createdAt: nowIso,
        updatedByAdminUid: adminUser.uid,
        updatedAt: nowIso,
      };

      transaction.update(courseRef, {
        sessions: updatedSessions,
        enrolledSeats: newEnrolled,
        totalRegistrations: nextSequence,
      });

      transaction.set(walkInRef, newWalkInData);

      return { id: walkInRef.id, ...newWalkInData };
    });
  },

  /**
   * Administrator-only: Marks an existing registered participant (typically Online)
   * as attended without creating a duplicate registration document.
   */
  async markExistingAsAttended(params: {
    registrationId: string;
    course: Course;
    checkInAt?: string;
    sessionId?: string;
  }): Promise<Registration> {
    const adminUser = auth.currentUser;
    if (!adminUser?.uid) {
      throw new Error("กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบก่อนทำรายการ");
    }

    const regRef = doc(db, "registrations", params.registrationId);
    const checkInIso = params.checkInAt
      ? new Date(params.checkInAt).toISOString()
      : new Date().toISOString();
    const nowIso = new Date().toISOString();

    const courseRegsSnap = await getDocs(
      query(collection(db, "registrations"), where("courseId", "==", params.course.id))
    );
    const maxCheckInSeq = courseRegsSnap.docs.reduce((max, d) => {
      const val = Number(d.data()?.checkInSequenceNumber) || 0;
      return val > max ? val : max;
    }, 0);

    const courseSessions = getCourseSessions(params.course);
    const isMulti = courseSessions.length > 1;
    const activeSession =
      (params.sessionId &&
        courseSessions.find(
          (s) => s.id === params.sessionId || (s as any).sessionId === params.sessionId
        )) ||
      courseSessions[0] ||
      null;
    const targetSessionId =
      activeSession?.id || (activeSession as any)?.sessionId || "default";

    return await runTransaction(db, async (transaction) => {
      const regSnap = await transaction.get(regRef);
      if (!regSnap.exists()) {
        throw new Error("ไม่พบข้อมูลการลงทะเบียน");
      }

      const existing = { id: regSnap.id, ...regSnap.data() } as Registration;
      const assignedSeq = existing.checkInSequenceNumber || maxCheckInSeq + 1;
      const assignedCheckInAt = existing.checkInAt || checkInIso;

      const existingSessionsMap = sanitizeAttendedSessionsMap(existing.attendedSessions);
      const nextSessionsMap: Record<string, SessionAttendance> =
        isMulti || targetSessionId
          ? {
              ...existingSessionsMap,
              [targetSessionId]: buildSessionAttendanceEntry({
                attended: true,
                checkInAt: checkInIso,
                checkInSequenceNumber:
                  existingSessionsMap[targetSessionId]?.checkInSequenceNumber || assignedSeq,
                sessionDate: activeSession?.date || params.course.date || null,
                sessionName: activeSession?.sessionName || "วันอบรม",
              }),
            }
          : existingSessionsMap;

      const updates = {
        attended: true,
        checkInAt: assignedCheckInAt,
        checkInSequenceNumber: assignedSeq,
        attendedSessions: nextSessionsMap,
        updatedByAdminUid: adminUser.uid,
        updatedAt: nowIso,
      };

      transaction.update(regRef, updates);

      return { ...existing, ...updates };
    });
  },

  /**
   * Administrator-only: Updates information or attendance details of an existing
   * Walk-in participant record while preserving `source: 'walk_in'` and `userId: null`.
   * Uses a Firestore transaction to prevent concurrent email/instructorId collisions and
   * omits undefined nested fields so toggling attendance (true <-> false) always succeeds.
   */
  async updateWalkInParticipant(
    registrationId: string,
    course: Course,
    input: WalkInFormInput
  ): Promise<Registration> {
    const adminUser = auth.currentUser;
    if (!adminUser?.uid) {
      throw new Error("กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบก่อนทำรายการ");
    }

    const validation = validateWalkInFormData(input, {
      requireAttendanceConfirmation: false,
    });
    if (!validation.isValid) {
      const firstErr = Object.values(validation.errors)[0] || "ข้อมูล Walk-in ไม่ถูกต้อง";
      throw new Error(firstErr);
    }

    const cleanEmail = input.userEmail.trim().toLowerCase();
    const cleanName = input.userName.trim();
    const cleanDept = input.userDepartment.trim();
    const cleanPosition = (input.userPosition || "").trim();
    const cleanInstructorId = (input.instructorId || "").trim();
    const checkInIso = new Date(input.checkInAt).toISOString();
    const nowIso = new Date().toISOString();

    const courseRegsSnap = await getDocs(
      query(collection(db, "registrations"), where("courseId", "==", course.id))
    );
    const existingRegs = courseRegsSnap.docs.map(
      (d) => ({ id: d.id, ...d.data() } as Registration)
    );

    const duplicate = findDuplicateCourseRegistration(existingRegs, {
      email: cleanEmail,
      instructorId: cleanInstructorId,
      excludeRegId: registrationId,
    });
    if (duplicate) {
      throw new Error(
        `ข้อมูลอีเมลหรือรหัสอาจารย์ซ้ำกับผู้เข้าร่วมรายอื่นในหลักสูตรนี้ (${duplicate.userName})`
      );
    }

    const regRef = doc(db, "registrations", registrationId);
    const newWalkInDocId = buildWalkInDocId(course.id, cleanEmail, cleanInstructorId);
    const newWalkInRef =
      newWalkInDocId !== registrationId
        ? doc(db, "registrations", newWalkInDocId)
        : null;

    const courseSessions = getCourseSessions(course);
    const linkedUids = await findLinkedInstructorUids(
      input.userEmail,
      cleanEmail,
      cleanInstructorId
    );
    const candidateOnlineRefs = linkedUids.flatMap((uid) =>
      buildCandidateOnlineDocIds(course, uid, input.sessionId)
        .filter((id) => id !== registrationId)
        .map((id) => doc(db, "registrations", id))
    );

    return await runTransaction(db, async (transaction) => {
      const regSnap = await transaction.get(regRef);
      if (!regSnap.exists()) {
        throw new Error("ไม่พบข้อมูลผู้เข้าร่วม Walk-in");
      }

      if (newWalkInRef) {
        const collisionSnap = await transaction.get(newWalkInRef);
        if (collisionSnap.exists()) {
          const colliding = collisionSnap.data() as Registration;
          throw new Error(
            `ข้อมูลอีเมลหรือรหัสอาจารย์ซ้ำกับผู้เข้าร่วมรายอื่นในหลักสูตรนี้ (${colliding.userName || cleanEmail})`
          );
        }
      }

      for (const onlineRef of candidateOnlineRefs) {
        const onlineSnap = await transaction.get(onlineRef);
        if (onlineSnap.exists()) {
          const colliding = onlineSnap.data() as Registration;
          throw new Error(
            `พบการลงทะเบียนออนไลน์ของ "${colliding.userName || cleanEmail}" ในหลักสูตรนี้แล้ว`
          );
        }
      }

      const current = { id: regSnap.id, ...regSnap.data() } as Registration;
      if (getRegistrationSource(current) !== "walk_in") {
        throw new Error("ไม่สามารถแก้ไขข้อมูลส่วนตัวของผู้ลงทะเบียนออนไลน์ผ่านแบบฟอร์ม Walk-in ได้");
      }

      const activeSession =
        (input.sessionId &&
          courseSessions.find(
            (s) => s.id === input.sessionId || (s as any).sessionId === input.sessionId
          )) ||
        courseSessions.find(
          (s) => s.id === current.sessionId || (s as any).sessionId === current.sessionId
        ) ||
        courseSessions[0] ||
        null;
      const targetSessionId =
        input.sessionId ||
        current.sessionId ||
        activeSession?.id ||
        (activeSession as any)?.sessionId ||
        "default";

      const currentSessionsMap = sanitizeAttendedSessionsMap(current.attendedSessions);
      const prevTargetSession = currentSessionsMap[targetSessionId];

      const attended = Boolean(input.confirmAttended);
      const nextCheckInSeq = attended
        ? current.checkInSequenceNumber ||
          prevTargetSession?.checkInSequenceNumber ||
          existingRegs.reduce(
            (max, r) => Math.max(max, Number(r.checkInSequenceNumber) || 0),
            0
          ) + 1
        : null;

      if (targetSessionId) {
        currentSessionsMap[targetSessionId] = buildSessionAttendanceEntry({
          attended,
          checkInAt: attended ? checkInIso : null,
          checkInSequenceNumber: attended ? nextCheckInSeq : null,
          sessionDate:
            activeSession?.date || prevTargetSession?.sessionDate || course.date || null,
          sessionName:
            activeSession?.sessionName ||
            prevTargetSession?.sessionName ||
            current.sessionName ||
            "การอบรม",
        });
      }

      const updates: Record<string, any> = {
        instructorId: cleanInstructorId,
        userName: cleanName,
        userEmail: cleanEmail,
        userDepartment: cleanDept,
        userPosition: cleanPosition,
        attended,
        checkInAt: attended ? checkInIso : null,
        checkInSequenceNumber: nextCheckInSeq,
        attendedSessions: currentSessionsMap,
        updatedByAdminUid: adminUser.uid,
        updatedAt: nowIso,
      };

      transaction.update(regRef, updates);

      return {
        ...current,
        ...updates,
      } as Registration;
    });
  },
};
