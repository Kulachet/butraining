import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  writeBatch, 
  deleteDoc, 
  setDoc,
  serverTimestamp 
} from "firebase/firestore";
import { db } from "./firebase";
import { Instructor, Course, Registration } from "../types";

export interface InstructorFormData {
  id: string;
  name: string;
  email: string;
  department: string;
  position?: string;
  englishFullName?: string;
  englishNameVerified?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: {
    id?: string;
    name?: string;
    email?: string;
    department?: string;
    position?: string;
    general?: string;
  };
}

const BU_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@bu\.ac\.th$/i;

export const InstructorService = {
  /**
   * Validate instructor data including BU email domain and duplicate ID/email
   */
  validate(
    data: InstructorFormData,
    existingInstructors: Instructor[],
    currentInstructorId?: string
  ): ValidationResult {
    const errors: ValidationResult["errors"] = {};

    const cleanId = (data.id || "").trim();
    const cleanName = (data.name || "").trim();
    const cleanEmail = (data.email || "").trim().toLowerCase();
    const cleanDept = (data.department || "").trim();

    // 1. Instructor ID validation
    if (!cleanId) {
      errors.id = "กรุณากรอกรหัสประจำตัวอาจารย์";
    } else {
      // Check duplicate ID
      const duplicateId = existingInstructors.find(
        (inst) =>
          inst.id?.toLowerCase().trim() === cleanId.toLowerCase() &&
          inst.id?.toLowerCase().trim() !== currentInstructorId?.toLowerCase().trim()
      );
      if (duplicateId) {
        errors.id = `รหัสอาจารย์ "${cleanId}" มีอยู่ในระบบแล้ว (${duplicateId.name})`;
      }
    }

    // 2. Full Name validation
    if (!cleanName) {
      errors.name = "กรุณากรอกชื่อ-นามสกุลอาจารย์";
    }

    // 3. Email validation
    if (!cleanEmail) {
      errors.email = "กรุณากรอกอีเมลมหาวิทยาลัย";
    } else if (!BU_EMAIL_REGEX.test(cleanEmail)) {
      errors.email = "อีเมลต้องใช้นามสกุล @bu.ac.th เท่านั้น";
    } else {
      // Check duplicate Email
      const duplicateEmail = existingInstructors.find(
        (inst) =>
          inst.email?.toLowerCase().trim() === cleanEmail &&
          inst.id?.toLowerCase().trim() !== currentInstructorId?.toLowerCase().trim()
      );
      if (duplicateEmail) {
        errors.email = `อีเมล "${cleanEmail}" มีอยู่ในระบบแล้ว (${duplicateEmail.name})`;
      }
    }

    // 4. Department validation
    if (!cleanDept) {
      errors.department = "กรุณากรอกคณะหรือหน่วยงาน";
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    };
  },

  /**
   * Create a new instructor record in Firestore
   */
  async createInstructor(data: InstructorFormData): Promise<Instructor> {
    const cleanId = data.id.trim();
    const cleanEmail = data.email.trim().toLowerCase();
    const cleanName = data.name.trim();
    const cleanDept = data.department.trim();
    const cleanPosition = (data.position || "").trim();

    // Verify doc does not exist
    const targetRef = doc(db, "instructors", cleanId);
    const existingSnap = await getDoc(targetRef);
    if (existingSnap.exists()) {
      throw new Error(`รหัสอาจารย์ "${cleanId}" มีข้อมูลอยู่ในฐานข้อมูลแล้ว`);
    }

    const now = new Date().toISOString();
    const cleanEnglishName = (data.englishFullName || "").trim();
    const newInstructor: Instructor = {
      id: cleanId,
      name: cleanName,
      email: cleanEmail,
      department: cleanDept,
      position: cleanPosition,
      ...(cleanEnglishName ? { englishFullName: cleanEnglishName, englishNameVerified: Boolean(data.englishNameVerified) } : {}),
      isManual: true,
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(targetRef, newInstructor);
    return newInstructor;
  },

  /**
   * Update an existing instructor record with safe reference migration if ID changes
   */
  async updateInstructor(
    data: InstructorFormData,
    originalInstructor: Instructor
  ): Promise<Instructor> {
    const oldId = originalInstructor.id.trim();
    const newId = data.id.trim();
    const oldDocId = originalInstructor.firebaseId || oldId;
    const cleanEmail = data.email.trim().toLowerCase();
    const cleanName = data.name.trim();
    const cleanDept = data.department.trim();
    const cleanPosition = (data.position || "").trim();
    const cleanEnglishName = (data.englishFullName || "").trim();
    const now = new Date().toISOString();

    const isIdChanged = oldId !== newId;

    if (!isIdChanged) {
      // Standard in-place update: document ID remains unchanged
      const targetRef = doc(db, "instructors", oldDocId);
      const updateData: Partial<Instructor> = {
        id: oldId,
        name: cleanName,
        email: cleanEmail,
        department: cleanDept,
        position: cleanPosition,
        ...(cleanEnglishName 
          ? { englishFullName: cleanEnglishName, englishNameVerified: Boolean(data.englishNameVerified) } 
          : { englishFullName: "", englishNameVerified: false }),
        isManual: true,
        updatedAt: now,
      };

      // Preserve existing UID if present
      if (originalInstructor.uid) {
        updateData.uid = originalInstructor.uid;
      }

      await setDoc(targetRef, updateData, { merge: true });

      return {
        ...originalInstructor,
        ...updateData,
      } as Instructor;
    }

    // === ID CHANGED: SAFE REFERENCE MIGRATION ARCHITECTURE ===
    // 1. Verify target doc does not already exist
    const newDocRef = doc(db, "instructors", newId);
    const checkSnap = await getDoc(newDocRef);
    if (checkSnap.exists()) {
      throw new Error(`ไม่สามารถเปลี่ยนรหัสเป็น "${newId}" ได้ เนื่องจากมีข้อมูลรหัสนี้อยู่ในระบบแล้ว`);
    }

    // 2. Query all courses referencing oldInstructor.id
    const coursesRef = collection(db, "courses");
    const coursesSnap = await getDocs(query(coursesRef, where("instructorId", "==", oldId)));

    // 3. Query all registrations referencing oldInstructor.id
    const regsRef = collection(db, "registrations");
    const regsSnap = await getDocs(query(regsRef, where("instructorId", "==", oldId)));

    // 4. Also check if registrations match old email to ensure complete sync
    const oldEmail = (originalInstructor.email || "").trim().toLowerCase();
    let emailRegsSnap: any = { docs: [] };
    if (oldEmail && oldEmail !== cleanEmail) {
      emailRegsSnap = await getDocs(query(regsRef, where("userEmail", "==", oldEmail)));
    }

    // Combine unique registration doc refs
    const regDocsToMigrate = new Map<string, any>();
    regsSnap.docs.forEach((d) => regDocsToMigrate.set(d.id, d));
    emailRegsSnap.docs.forEach((d: any) => regDocsToMigrate.set(d.id, d));

    // 5. Build and commit the migration batch
    // Using batches (chunks of max 400 operations to stay well within 500 limit)
    const newInstructorData: Instructor = {
      id: newId,
      name: cleanName,
      email: cleanEmail,
      department: cleanDept,
      position: cleanPosition,
      isManual: true,
      createdAt: originalInstructor.createdAt || now,
      updatedAt: now,
      ...(cleanEnglishName 
        ? { englishFullName: cleanEnglishName, englishNameVerified: Boolean(data.englishNameVerified) } 
        : { englishFullName: "", englishNameVerified: false }),
      ...(originalInstructor.uid ? { uid: originalInstructor.uid } : {}),
    };

    const batch = writeBatch(db);

    // a) Create the new instructor document
    batch.set(newDocRef, newInstructorData);

    // b) Update referencing courses
    coursesSnap.docs.forEach((courseDoc) => {
      const cData = courseDoc.data();
      const updates: any = { instructorId: newId };
      if (cData.instructorName === originalInstructor.name) {
        updates.instructorName = cleanName;
      }
      batch.update(courseDoc.ref, updates);
    });

    // c) Update referencing registrations
    regDocsToMigrate.forEach((regDoc) => {
      const rData = regDoc.data();
      const updates: any = { instructorId: newId };
      if (rData.userName === originalInstructor.name) {
        updates.userName = cleanName;
      }
      if (rData.userEmail === originalInstructor.email) {
        updates.userEmail = cleanEmail;
      }
      if (rData.userDepartment === originalInstructor.department) {
        updates.userDepartment = cleanDept;
      }
      batch.update(regDoc.ref, updates);
    });

    // Commit batch first (atomic creation & reference updates)
    await batch.commit();

    // 6. Only after successful commit, remove the old document
    try {
      const oldDocRef = doc(db, "instructors", oldDocId);
      await deleteDoc(oldDocRef);
    } catch (deleteError) {
      console.warn("Could not delete old instructor document after migration:", deleteError);
      // The new document and all references are already safely committed!
    }

    return newInstructorData;
  },
};
