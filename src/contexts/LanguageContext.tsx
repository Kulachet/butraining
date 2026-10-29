import React, { createContext, useContext, useState } from "react";

export type Language = "th" | "en";

export type TranslationKey = 
  | "welcomeHeading1"
  | "welcomeHeading2"
  | "welcomeHeadingSingle"
  | "welcomeOffice"
  | "welcomeDescription"
  | "welcomeSignInButton"
  | "navSignIn"
  | "navSignOut"
  | "navAdminPortal"
  | "heroBadge"
  | "heroTitle1"
  | "heroTitle2"
  | "heroSubtitle"
  | "searchPlaceholder"
  | "allCategory"
  | "noCoursesFound"
  | "cancelConfirmTitle"
  | "cancelConfirmDesc"
  | "cancelBack"
  | "cancelConfirmAction"
  | "cancelSessionLabel"
  | "profileTitle"
  | "profileVerified"
  | "profileId"
  | "profileFullName"
  | "profileEmail"
  | "profileDepartment"
  | "profileNotice"
  | "scheduleTitle"
  | "sessionLabel"
  | "multiDayBadge"
  | "multiDayNotice"
  | "multiDayRegistrationPending"
  | "trainingDate"
  | "trainingTime"
  | "room";

export const translations: Record<Language, Record<TranslationKey, string>> = {
  th: {
    welcomeHeading1: "ยินดีต้อนรับสู่ระบบลงทะเบียน",
    welcomeHeading2: "การอบรมเชิงปฏิบัติการ",
    welcomeHeadingSingle: "ยินดีต้อนรับสู่ระบบลงทะเบียนการอบรมเชิงปฏิบัติการ",
    welcomeOffice: "สำนักพัฒนาการเรียนรู้",
    welcomeDescription: "กรุณาเข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัย เพื่อดำเนินการลงทะเบียนอบรม",
    welcomeSignInButton: "เข้าสู่ระบบด้วย Google",
    navSignIn: "เข้าสู่ระบบ",
    navSignOut: "ออกจากระบบ",
    navAdminPortal: "Admin Portal",
    heroBadge: "Bangkok University Training Portal",
    heroTitle1: "พัฒนาศักยภาพอาจารย์",
    heroTitle2: "สู่ความเป็นเลิศทางวิชาการ",
    heroSubtitle: "ยกระดับทักษะการสอนและการวิจัยด้วยหลักสูตรที่ทันสมัย ออกแบบมาเพื่ออาจารย์มหาวิทยาลัยกรุงเทพโดยเฉพาะ",
    searchPlaceholder: "ค้นหาหลักสูตร หรือวิทยากร...",
    allCategory: "ทั้งหมด",
    noCoursesFound: "ไม่พบหลักสูตรที่ค้นหา",
    cancelConfirmTitle: "ยืนยันการยกเลิก",
    cancelConfirmDesc: "คุณต้องการยกเลิกการลงทะเบียนหลักสูตรนี้ใช่หรือไม่? ที่นั่งของคุณจะถูกคืนเข้าสู่ระบบ",
    cancelBack: "ย้อนกลับ",
    cancelConfirmAction: "ยกเลิกการลงทะเบียน",
    cancelSessionLabel: "เซสชัน:",
    profileTitle: "ข้อมูลโปรไฟล์อาจารย์",
    profileVerified: "Verified Instructor Account",
    profileId: "รหัสอาจารย์",
    profileFullName: "ชื่อ-นามสกุล",
    profileEmail: "อีเมลมหาวิทยาลัย",
    profileDepartment: "หน่วยงาน / คณะ",
    profileNotice: "* ข้อมูลโปรไฟล์ถูกซิงค์จากฐานข้อมูลกลางของมหาวิทยาลัยโดยอัตโนมัติ \nหากข้อมูลไม่ถูกต้อง กรุณาติดต่อสำนักพัฒนาการเรียนรู้",
    scheduleTitle: "กำหนดการอบรม",
    sessionLabel: "วันที่",
    multiDayBadge: "หลักสูตรต่อเนื่อง",
    multiDayNotice: "หลักสูตรนี้จัดอบรมหลายวัน โปรดตรวจสอบกำหนดการทุกวัน",
    multiDayRegistrationPending: "เปิดรับลงทะเบียนเร็วๆ นี้ (หลักสูตรหลายวัน)",
    trainingDate: "วันที่อบรม:",
    trainingTime: "เวลา:",
    room: "ห้อง:"
  },
  en: {
    welcomeHeading1: "Welcome to the",
    welcomeHeading2: "Academic Training Portal",
    welcomeHeadingSingle: "Welcome to the Academic Training Portal",
    welcomeOffice: "Learning Development Office",
    welcomeDescription: "Sign in with your Bangkok University Google account to explore and register for professional development workshops.",
    welcomeSignInButton: "Sign in with Google",
    navSignIn: "Sign in",
    navSignOut: "Sign out",
    navAdminPortal: "Admin Portal",
    heroBadge: "Bangkok University Training Portal",
    heroTitle1: "Empowering Faculty",
    heroTitle2: "Towards Academic Excellence",
    heroSubtitle: "Elevate teaching and research capabilities with modern workshops designed specifically for Bangkok University faculty.",
    searchPlaceholder: "Search workshops or instructors...",
    allCategory: "All",
    noCoursesFound: "No workshops found",
    cancelConfirmTitle: "Confirm Cancellation",
    cancelConfirmDesc: "Are you sure you want to cancel your registration? Your seat will be returned to the system.",
    cancelBack: "Back",
    cancelConfirmAction: "Confirm Cancellation",
    cancelSessionLabel: "Session:",
    profileTitle: "Instructor Profile",
    profileVerified: "Verified Instructor Account",
    profileId: "Instructor ID",
    profileFullName: "Full Name",
    profileEmail: "University Email",
    profileDepartment: "Department / Faculty",
    profileNotice: "Your profile information is automatically synchronized with the university's central database. If any information is incorrect, please contact the Learning Development Office.",
    scheduleTitle: "Training Schedule",
    sessionLabel: "Day",
    multiDayBadge: "Multi-day Workshop",
    multiDayNotice: "This workshop spans multiple dates. Please review the full schedule.",
    multiDayRegistrationPending: "Registration Opening Soon (Multi-day)",
    trainingDate: "Date:",
    trainingTime: "Time:",
    room: "Room:"
  }
};

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const STORAGE_KEY = "preferred_lang";

const LanguageContext = createContext<LanguageContextType>({
  lang: "th",
  setLang: () => {},
  t: (key: TranslationKey) => translations.th[key] || "",
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "th" || saved === "en") return saved;
    } catch {
      // localStorage may fail in restricted sandbox
    }
    return "th";
  });

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch (e) {
      console.error("Failed to save language preference:", e);
    }
  };

  const t = (key: TranslationKey): string => {
    return translations[lang]?.[key] || translations.th[key] || "";
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
