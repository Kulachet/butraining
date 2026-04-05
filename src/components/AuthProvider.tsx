import React, { createContext, useContext, useEffect, useState } from "react";
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User 
} from "firebase/auth";
import { 
  doc, 
  getDoc, 
  setDoc, 
  serverTimestamp,
  query,
  collection,
  where,
  getDocs
} from "firebase/firestore";
import { auth, db, googleProvider } from "../lib/firebase";
import { AuthContextType, Instructor } from "../types";
import toast from "react-hot-toast";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [instructor, setInstructor] = useState<Instructor | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const checkInstructor = async (email: string, uid: string, displayName: string | null) => {
    try {
      const normalizedEmail = email.toLowerCase().trim();
      
      // 1. Try to find by normalized email (Master Data Sync)
      let q = query(collection(db, "instructors"), where("email", "==", normalizedEmail));
      let querySnapshot = await getDocs(q);
      
      let instructorDoc = null;

      if (!querySnapshot.empty) {
        instructorDoc = querySnapshot.docs[0];
      } else {
        // Fallback 1: Try exact email match just in case it's stored with mixed casing
        q = query(collection(db, "instructors"), where("email", "==", email.trim()));
        querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          instructorDoc = querySnapshot.docs[0];
        } else {
          // Fallback 2: Client-side case-insensitive search for existing mixed-case data
          // This is necessary because Firestore queries are strictly case-sensitive
          // and some CSV uploads might contain emails like "Sumalee.Y@bu.ac.th"
          const allDocs = await getDocs(collection(db, "instructors"));
          const matchedDoc = allDocs.docs.find(d => {
            const dataEmail = d.data().email;
            return dataEmail && dataEmail.toLowerCase().trim() === normalizedEmail;
          });
          if (matchedDoc) {
            instructorDoc = matchedDoc;
          }
        }
      }

      if (instructorDoc) {
        const docData = instructorDoc.data();
        
        // Link UID to this instructor record if not already linked
        if (docData.uid !== uid) {
          await setDoc(instructorDoc.ref, { uid: uid }, { merge: true });
        }

        setInstructor({
          ...docData,
          uid: uid,
        } as Instructor);
        return;
      }

      // If NO match is found: show the "Register" form as a fallback
      // By setting instructor to null, the LandingPage will show the NewInstructorModal
      setInstructor(null);
      
    } catch (error) {
      console.error("Error fetching instructor:", error);
      if (error instanceof Error && error.message.includes("Missing or insufficient permissions")) {
        toast.error("ข้อผิดพลาดสิทธิ์การเข้าถึงฐานข้อมูล กรุณาติดต่อผู้ดูแลระบบ");
      }
      setInstructor(null);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        if (!currentUser.email?.endsWith("@bu.ac.th")) {
          toast.error("การเข้าถึงจำกัดเฉพาะบัญชีมหาวิทยาลัยกรุงเทพเท่านั้น");
          await signOut(auth);
          setUser(null);
          setInstructor(null);
          setIsAdmin(false);
        } else {
          setUser(currentUser);
          console.log("Logged in as:", currentUser.email);
          await checkInstructor(currentUser.email, currentUser.uid, currentUser.displayName);
          // Check admin status (simple check for now)
          const adminEmail = "kulachet.l@bu.ac.th";
          const isUserAdmin = currentUser.email?.toLowerCase() === adminEmail.toLowerCase();
          console.log("Is Admin:", isUserAdmin);
          setIsAdmin(isUserAdmin);
        }
      } else {
        setUser(null);
        setInstructor(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
      toast.error("เข้าสู่ระบบไม่สำเร็จ");
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      toast.success("ออกจากระบบแล้ว");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const registerInstructor = async (data: Omit<Instructor, 'uid' | 'email' | 'createdAt'>) => {
    if (!user) return;
    try {
      const newInstructor: Instructor = {
        ...data,
        uid: user.uid,
        email: user.email!,
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, "instructors", user.uid), {
        ...newInstructor,
        createdAt: serverTimestamp(),
      });
      setInstructor(newInstructor);
      toast.success("ลงทะเบียนอาจารย์เรียบร้อยแล้ว");
    } catch (error) {
      console.error("Registration failed:", error);
      toast.error("ลงทะเบียนไม่สำเร็จ");
    }
  };

  return (
    <AuthContext.Provider value={{ user, instructor, loading, isAdmin, login, logout, registerInstructor }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
