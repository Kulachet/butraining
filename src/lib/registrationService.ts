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
    const regRef = doc(db, "registrations", `${course.id}_${instructor.uid}`);
    
    return await runTransaction(db, async (transaction) => {
      // 1. Check if already registered
      const regDoc = await transaction.get(regRef);
      if (regDoc.exists()) throw new Error("Already registered for this course");

      // 2. Get current course data to check seats and get sequence number
      const courseDoc = await transaction.get(courseRef);
      if (!courseDoc.exists()) throw new Error("Course not found");
      
      const currentCourse = courseDoc.data() as Course;
      
      // 3. Update session seats if applicable
      let updatedSessions = [...(currentCourse.sessions || [])];
      if (session) {
        const sessionIndex = updatedSessions.findIndex(s => s.sessionId === session.sessionId);
        if (sessionIndex === -1) throw new Error("Session not found");
        
        if (updatedSessions[sessionIndex].enrolledSeats >= updatedSessions[sessionIndex].maxSeats) {
          throw new Error("Session is full");
        }
        
        updatedSessions[sessionIndex].enrolledSeats += 1;
      }

      // 4. Update sequence number
      const nextSequence = (currentCourse.totalRegistrations || 0) + 1;
      
      // 5. Update course document
      transaction.update(courseRef, { 
        sessions: updatedSessions,
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

  async cancelRegistration(courseId: string, userId: string) {
    const courseRef = doc(db, "courses", courseId);
    const regRef = doc(db, "registrations", `${courseId}_${userId}`);

    return await runTransaction(db, async (transaction) => {
      // 1. Check if registration exists
      const regDoc = await transaction.get(regRef);
      if (!regDoc.exists()) throw new Error("ไม่พบข้อมูลการลงทะเบียน");
      const regData = regDoc.data() as Registration;

      // 2. Get current course data
      const courseDoc = await transaction.get(courseRef);
      if (!courseDoc.exists()) throw new Error("ไม่พบข้อมูลหลักสูตร");
      const currentCourse = courseDoc.data() as Course;

      // 3. Update session seats
      let updatedSessions = [...(currentCourse.sessions || [])];
      if (regData.sessionId) {
        const sessionIndex = updatedSessions.findIndex(s => s.sessionId === regData.sessionId);
        if (sessionIndex !== -1 && updatedSessions[sessionIndex].enrolledSeats > 0) {
          updatedSessions[sessionIndex].enrolledSeats -= 1;
        }
      } else if (updatedSessions.length > 0 && updatedSessions[0].enrolledSeats > 0) {
        updatedSessions[0].enrolledSeats -= 1;
      }

      // 4. Update total registrations to keep fallback logic correct
      const newTotal = Math.max(0, (currentCourse.totalRegistrations || 0) - 1);

      // 5. Update course document
      transaction.update(courseRef, { 
        sessions: updatedSessions,
        totalRegistrations: newTotal
      });

      // 6. Delete registration doc
      transaction.delete(regRef);
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
      const certificateUrl = `https://drive.google.com/uc?id=${course.driveFolderId}&export=download&filename=${reg.sequenceNumber}.pdf`;
      
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
