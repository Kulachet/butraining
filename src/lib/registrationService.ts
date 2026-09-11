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
import { Registration, Course, Instructor, Session } from "../types";

export const RegistrationService = {
  async registerForCourse(course: Course, instructor: Instructor, session?: Session) {
    const courseRef = doc(db, "courses", course.id);
    const regId = `${course.id}_${session?.sessionId || "default"}_${instructor.uid}`;
    const regRef = doc(db, "registrations", regId);
    
    return await runTransaction(db, async (transaction) => {
      // 1. Check if already registered for this session
      const regDoc = await transaction.get(regRef);
      if (regDoc.exists()) throw new Error("Already registered for this session of the course");

      // 2. Get current course data to check seats and get sequence number
      const courseDoc = await transaction.get(courseRef);
      if (!courseDoc.exists()) throw new Error("Course not found");
      
      const currentCourse = courseDoc.data() as Course;
      
      // 3. Update session seats if applicable
      let updatedSessions = [...(currentCourse.sessions || [])];
      let enrolledSeats = currentCourse.enrolledSeats || 0;

      if (session) {
        const sessionIndex = updatedSessions.findIndex(s => s.sessionId === session.sessionId);
        if (sessionIndex === -1) throw new Error("Session not found");
        
        if (updatedSessions[sessionIndex].enrolledSeats >= updatedSessions[sessionIndex].maxSeats) {
          throw new Error("Session is full");
        }
        
        updatedSessions[sessionIndex].enrolledSeats += 1;
      } else {
        // Legacy course or single session without explicit session selection
        if (enrolledSeats >= (currentCourse.maxSeats || 50)) {
          throw new Error("Course is full");
        }
        enrolledSeats += 1;
      }

      // 4. Update sequence number
      const nextSequence = (currentCourse.totalRegistrations || 0) + 1;
      
      // 5. Update course document
      transaction.update(courseRef, { 
        sessions: updatedSessions,
        enrolledSeats: enrolledSeats,
        totalRegistrations: nextSequence
      });

      // 6. Create registration doc
      const regData = {
        courseId: course.id,
        courseTitle: course.title,
        sessionId: session?.sessionId || null,
        sessionName: session?.sessionName || null,
        userId: instructor.uid,
        instructorId: instructor.id,
        userName: instructor.name,
        userEmail: instructor.email,
        userPosition: instructor.position || "",
        userDepartment: instructor.department,
        sequenceNumber: nextSequence,
        attended: false,
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

  async sendCertificates(course: Course, registrations: Registration[]) {
    const mailRef = collection(db, "mail");
    const attendedUsers = registrations.filter(r => r.attended);

    for (const reg of attendedUsers) {
      const certificateUrl = `https://drive.google.com/uc?id=${course.driveFolderId}&export=download&filename=${reg.sequenceNumber}.png`;
      
      await addDoc(mailRef, {
        to: reg.userEmail,
        message: {
          subject: `ประกาศนียบัตรหลักสูตร: ${course.title}`,
          html: `
            <div style="font-family: sans-serif; padding: 20px;">
              <h2 style="color: #991b1b;">ขอแสดงความยินดี!</h2>
              <p>ท่านได้ผ่านการอบรมหลักสูตร <b>${course.title}</b> เรียบร้อยแล้ว</p>
              <p>ท่านสามารถดาวน์โหลดประกาศนียบัตรได้จากลิงก์ด้านล่าง:</p>
              <a href="${certificateUrl}" style="background: #991b1b; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">ดาวน์โหลดประกาศนียบัตร</a>
              <br/><br/>
              <p>ขอบคุณที่ร่วมเป็นส่วนหนึ่งในการพัฒนาศักยภาพอาจารย์กับเรา</p>
              <p>LDO Training Portal 2026</p>
            </div>
          `,
        },
        createdAt: serverTimestamp(),
      });
    }
  },

  async sendReminder(course: Course, registrations: Registration[]) {
    const mailRef = collection(db, "mail");
    
    for (const reg of registrations) {
      const sessionInfo = reg.sessionName ? ` (เซสชัน: ${reg.sessionName})` : "";
      
      await addDoc(mailRef, {
        to: reg.userEmail,
        message: {
          subject: `แจ้งเตือนการอบรม: ${course.title}${sessionInfo}`,
          html: `
            <div style="font-family: sans-serif; padding: 20px;">
              <h2 style="color: #991b1b;">แจ้งเตือนการอบรม</h2>
              <p>หลักสูตร <b>${course.title}</b> จะเริ่มในวันพรุ่งนี้</p>
              ${reg.sessionName ? `<p><b>เซสชัน:</b> ${reg.sessionName}</p>` : ""}
              <p><b>วันเวลา:</b> ${course.date}</p>
              <br/>
              <p>กรุณาเตรียมตัวให้พร้อมสำหรับการอบรม</p>
              <p>LDO Training Portal 2026</p>
            </div>
          `,
        },
        createdAt: serverTimestamp(),
      });
    }
  }
};
