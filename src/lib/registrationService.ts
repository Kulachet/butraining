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
  serverTimestamp,
  runTransaction
} from "firebase/firestore";
import { db } from "./firebase";
import { Registration, Course, Instructor, Session, SessionAttendance } from "../types";
import { formatInstructorName, getCourseSessions, isMultiDayCourse } from "./utils";

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

    // (B) Verify remaining capacity against actual unique active registrations in Firestore
    const allRegsSnap = await getDocs(
      query(collection(db, "registrations"), where("courseId", "==", course.id))
    );
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

    // Deterministic legacy references to check inside transaction
    const legacyRef = doc(db, "registrations", `${course.id}_${instructor.uid}`);
    const defaultRef = doc(db, "registrations", `${course.id}_default_${instructor.uid}`);

    return await runTransaction(db, async (transaction) => {
      // 2. Transactional uniqueness checks:
      const regDoc = await transaction.get(regRef);
      if (regDoc.exists()) throw new Error("Already registered for this course");

      const legacyDoc = await transaction.get(legacyRef);
      if (legacyDoc.exists()) throw new Error("Already registered for this course");

      const defaultDoc = await transaction.get(defaultRef);
      if (defaultDoc.exists()) throw new Error("Already registered for this course");

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
        userId: instructor.uid,
        instructorId: instructor.id,
        userName: instructor.name,
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
    const currentMap = data.attendedSessions || {};

    const updatedMap: Record<string, SessionAttendance> = {
      ...currentMap,
      [sessionId]: {
        attended: newStatus,
        checkInAt: newStatus ? (currentMap[sessionId]?.checkInAt || new Date().toISOString()) : undefined,
        checkInSequenceNumber: newStatus ? (currentMap[sessionId]?.checkInSequenceNumber || 1) : undefined,
        sessionDate: sessionDate || currentMap[sessionId]?.sessionDate,
        sessionName: sessionName || currentMap[sessionId]?.sessionName,
      },
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
  }
};
