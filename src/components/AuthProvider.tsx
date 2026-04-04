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

  const checkInstructor = async (email: string, uid: string) => {
    try {
      // 1. Try to find by email (Master Data Sync)
      const q = query(collection(db, "instructors"), where("email", "==", email));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const instructorDoc = querySnapshot.docs[0];
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

      // 2. Fallback to UID lookup (Manual Registration)
      const docRef = doc(db, "instructors", uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setInstructor(docSnap.data() as Instructor);
      } else {
        setInstructor(null);
      }
    } catch (error) {
      console.error("Error fetching instructor:", error);
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
          await checkInstructor(currentUser.email, currentUser.uid);
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
