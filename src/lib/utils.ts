import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Centralized display-name formatter based on instructor ID.
 * 
 * RULES:
 * - A-prefix (Academic):
 *   - No existing academic title -> add "อ."
 *   - Has ผศ., รศ., ศ., ดร. or a combined title -> preserve existing title; do not add "อ."
 * - C-prefix (Support/Staff):
 *   - Always display "คุณ" instead of "อ."
 * - Z-prefix (External/Guest):
 *   - Always display "คุณ" instead of "อ."
 * 
 * Supports both uppercase and lowercase ID prefixes.
 * Checks academic titles stored in either name or position field.
 * Prevents duplicate prefixes.
 */
export function formatInstructorName(
  nameOrInstructor: string | { name?: string; id?: string; position?: string } | undefined | null,
  id?: string,
  position?: string
): string {
  let name = "";
  let finalId = id;
  let finalPosition = position;

  if (typeof nameOrInstructor === "object" && nameOrInstructor !== null) {
    name = nameOrInstructor.name || "";
    if (!finalId && nameOrInstructor.id) finalId = nameOrInstructor.id;
    if (!finalPosition && nameOrInstructor.position) finalPosition = nameOrInstructor.position;
  } else if (typeof nameOrInstructor === "string") {
    name = nameOrInstructor;
  }

  if (!name || typeof name !== "string") return "";
  const trimmedName = name.trim();
  if (!trimmedName) return "";

  const trimmedId = (finalId || "").toString().trim();
  const idPrefix = trimmedId ? trimmedId.charAt(0).toUpperCase() : "";
  const trimmedPos = (finalPosition || "").toString().trim();

  // 1. Identify higher academic titles in name
  const academicTitleRegexes = [
    { regex: /^(?:ผู้ช่วยศาสตราจารย์\s*ดร\.?|ผศ\.?\s*ดร\.?|ผศ\.\s*ดร)/i, title: "ผศ.ดร." },
    { regex: /^(?:รองศาสตราจารย์\s*ดร\.?|รศ\.?\s*ดร\.?|รศ\.\s*ดร)/i, title: "รศ.ดร." },
    { regex: /^(?:ศาสตราจารย์\s*ดร\.?|ศ\.?\s*ดร\.?|ศ\.\s*ดร)/i, title: "ศ.ดร." },
    { regex: /^(?:ผู้ช่วยศาสตราจารย์|ผศ\.|ผศ\s+)/i, title: "ผศ." },
    { regex: /^(?:รองศาสตราจารย์|รศ\.|รศ\s+)/i, title: "รศ." },
    { regex: /^(?:ศาสตราจารย์|ศ\.|ศ\s+)/i, title: "ศ." },
    { regex: /^(?:ด็อกเตอร์|ดร\.|ดร\s+)/i, title: "ดร." },
  ];

  let nameTitle: string | null = null;
  for (const item of academicTitleRegexes) {
    if (item.regex.test(trimmedName)) {
      nameTitle = item.title;
      break;
    }
  }

  // 2. Identify higher academic titles in position
  let posTitle: string | null = null;
  if (trimmedPos) {
    const posPatterns = [
      { regex: /(?:ผู้ช่วยศาสตราจารย์\s*ดร\.?|ผศ\.?\s*ดร\.?|ผศ\.\s*ดร)/i, title: "ผศ.ดร." },
      { regex: /(?:รองศาสตราจารย์\s*ดร\.?|รศ\.?\s*ดร\.?|รศ\.\s*ดร)/i, title: "รศ.ดร." },
      { regex: /(?:ศาสตราจารย์\s*ดร\.?|ศ\.?\s*ดร\.?|ศ\.\s*ดร)/i, title: "ศ.ดร." },
      { regex: /(?:ผู้ช่วยศาสตราจารย์|^ผศ\.?|\bผศ\.)/i, title: "ผศ." },
      { regex: /(?:รองศาสตราจารย์|^รศ\.?|\bรศ\.)/i, title: "รศ." },
      { regex: /(?:ศาสตราจารย์|^ศ\.?|\bศ\.)/i, title: "ศ." },
      { regex: /(?:ดร\.?|ด็อกเตอร์)/i, title: "ดร." },
    ];
    for (const item of posPatterns) {
      if (item.regex.test(trimmedPos)) {
        posTitle = item.title;
        break;
      }
    }
  }

  // 3. Strip leading generic prefixes (อ., อาจารย์, คุณ) without corrupting names starting with vowels
  const stripGenericPrefix = (str: string): string => {
    let s = str.trim();
    if (/^อาจารย์\s*/i.test(s)) {
      return s.replace(/^อาจารย์\s*/i, "").trim();
    }
    if (/^อ\.\s*/i.test(s)) {
      return s.replace(/^อ\.\s*/i, "").trim();
    }
    if (/^อ\s+/i.test(s)) {
      return s.replace(/^อ\s+/i, "").trim();
    }
    if (/^คุณ\s+/i.test(s)) {
      return s.replace(/^คุณ\s+/i, "").trim();
    }
    // Only strip "คุณ" if it is not followed by attached Thai vowel (which indicates a name like คุณากร, คุณาธิป)
    if (/^คุณ[^\u0E30-\u0E39\u0E47-\u0E4E]/i.test(s)) {
      if (!/^คุณ[าุูโิีึืะั]/i.test(s)) {
        return s.replace(/^คุณ/i, "").trim();
      }
    }
    return s;
  };

  const cleanBaseName = stripGenericPrefix(trimmedName);

  // === CASE 1: C-prefix or Z-prefix ===
  // Rule: Always display "คุณ" instead of "อ."
  if (idPrefix === "C" || idPrefix === "Z") {
    return `คุณ${cleanBaseName}`;
  }

  // === CASE 2: A-prefix (or default / unspecified ID) ===
  // 1) Has academic title in name: preserve existing title, do not add "อ."
  if (nameTitle) {
    return trimmedName;
  }

  // 2) Has academic title in position: prepend that academic title
  if (posTitle) {
    return `${posTitle}${cleanBaseName}`;
  }

  // 3) No existing academic title: add "อ."
  return `อ.${cleanBaseName}`;
}

const THAI_WEEKDAYS = [
  'วันอาทิตย์',
  'วันจันทร์',
  'วันอังคาร',
  'วันพุธ',
  'วันพฤหัสบดี',
  'วันศุกร์',
  'วันเสาร์'
];

const THAI_MONTHS_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม'
];

const EN_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];

const EN_MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

/**
 * Safely parse date string into year, month, day, and day-of-week
 * without timezone day-shift bugs.
 */
export function parseDateParts(dateString: string | undefined): {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
} | null {
  if (!dateString || typeof dateString !== 'string') return null;
  const trimmed = dateString.trim();
  const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    // Use noon (12:00:00) local time to guarantee immunity from UTC/DST day-shift
    const d = new Date(year, month - 1, day, 12, 0, 0);
    return {
      year,
      month,
      day,
      dayOfWeek: d.getDay()
    };
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    dayOfWeek: d.getDay()
  };
}

/**
 * Standard Thai Date Formatter:
 * 2026-12-14 -> วันจันทร์ที่ 14 ธันวาคม 2569
 * 2026-12-15 -> วันอังคารที่ 15 ธันวาคม 2569
 */
export function formatDateThai(dateString: string | undefined, format: 'full' | 'short' = 'full'): string {
  if (!dateString) return "";
  const parts = parseDateParts(dateString);
  if (!parts) return dateString;

  const thaiYear = parts.year + 543; // Buddhist Era
  if (format === 'short') {
    const dayStr = parts.day.toString().padStart(2, '0');
    const monthStr = parts.month.toString().padStart(2, '0');
    return `${dayStr}/${monthStr}/${thaiYear}`;
  }

  const weekdayName = THAI_WEEKDAYS[parts.dayOfWeek] || "";
  const monthName = THAI_MONTHS_FULL[parts.month - 1] || "";
  return `${weekdayName}ที่ ${parts.day} ${monthName} ${thaiYear}`;
}

/**
 * Standard English Date Formatter:
 * 2026-12-14 -> Monday, December 14, 2026
 * 2026-12-15 -> Tuesday, December 15, 2026
 */
export function formatDateEn(dateString: string | undefined, format: 'full' | 'short' = 'full'): string {
  if (!dateString) return "";
  const parts = parseDateParts(dateString);
  if (!parts) return dateString;

  if (format === 'short') {
    const monthShort = EN_MONTHS_FULL[parts.month - 1]?.slice(0, 3) || "";
    return `${monthShort} ${parts.day}, ${parts.year}`;
  }

  const weekdayName = EN_WEEKDAYS[parts.dayOfWeek] || "";
  const monthName = EN_MONTHS_FULL[parts.month - 1] || "";
  return `${weekdayName}, ${monthName} ${parts.day}, ${parts.year}`;
}

export function formatDateLocalized(
  dateString: string | undefined, 
  lang: 'th' | 'en' = 'th',
  format: 'full' | 'short' = 'full'
): string {
  if (lang === 'en') return formatDateEn(dateString, format);
  return formatDateThai(dateString, format);
}

/**
 * Standard Time Formatter:
 * Thai: 09.00–16.00 น.
 * English: 09:00 - 16:00
 */
export function formatSessionTime(startTime?: string, endTime?: string, lang: 'th' | 'en' = 'th'): string {
  if (!startTime && !endTime) return "";
  
  const cleanTime = (t?: string) => {
    if (!t) return "";
    const trimmed = t.trim();
    const parts = trimmed.split(":");
    if (parts.length >= 2) {
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }
    return trimmed;
  };

  const s = cleanTime(startTime);
  const e = cleanTime(endTime);

  if (lang === 'th') {
    const sTh = s.replace(':', '.');
    const eTh = e.replace(':', '.');
    if (sTh && eTh) {
      return `${sTh}–${eTh} น.`;
    }
    return `${sTh || eTh} น.`;
  }

  // English
  if (s && e) {
    return `${s} - ${e}`;
  }
  return s || e;
}

/**
 * Normalizes sessions from course.
 * For legacy courses without sessions, derives a single session from date/startTime/endTime.
 * Always returns sessions sorted chronologically by date then startTime with stable IDs.
 */
export function getCourseSessions(course: Partial<import("../types").Course> | undefined | null): import("../types").CourseSession[] {
  if (!course) return [];
  
  if (Array.isArray(course.sessions) && course.sessions.length > 0) {
    const list = course.sessions.map((s, idx) => ({
      id: s.id || (s as any).sessionId || `session_${idx + 1}`,
      sessionId: (s as any).sessionId || s.id || `session_${idx + 1}`,
      sessionName: s.sessionName || `Day ${idx + 1}`,
      date: s.date || course.date || "",
      startTime: s.startTime || course.startTime || "09:00",
      endTime: s.endTime || course.endTime || "12:00",
      locationType: s.locationType || 'On-site',
      locationDetail: s.locationDetail || course.locationDetail || "",
      maxSeats: s.maxSeats ?? course.maxSeats ?? 40,
      enrolledSeats: s.enrolledSeats ?? 0
    }));

    // If ThailandPSF or multi-day workshop only has 1 session persisted,
    // supplement the second date (2026-12-15) from the course announcement schedule
    if (list.length === 1 && (course.isMultiDay || course.title?.includes("ThailandPSF"))) {
      const s1 = list[0];
      const s2Date = s1.date === "2026-12-14" ? "2026-12-15" : "";
      if (s2Date) {
        list.push({
          id: "psf_day_2",
          sessionId: "psf_day_2",
          sessionName: "วันที่ 2",
          date: s2Date,
          startTime: s1.startTime || "09:00",
          endTime: s1.endTime || "16:00",
          locationType: s1.locationType || 'On-site',
          locationDetail: s1.locationDetail || course.locationDetail || "",
          maxSeats: s1.maxSeats ?? 100,
          enrolledSeats: s1.enrolledSeats ?? 0
        });
      }
    }

    return list.sort((a, b) => {
      const dateCmp = (a.date || "").localeCompare(b.date || "");
      if (dateCmp !== 0) return dateCmp;
      return (a.startTime || "").localeCompare(b.startTime || "");
    });
  }

  if (course.date) {
    return [{
      id: "default",
      sessionId: "default",
      sessionName: "วันที่ 1",
      date: course.date,
      startTime: course.startTime || "09:00",
      endTime: course.endTime || "12:00",
      locationType: 'On-site',
      locationDetail: course.locationDetail || "",
      maxSeats: course.maxSeats ?? 40,
      enrolledSeats: course.enrolledSeats ?? 0
    }];
  }

  return [];
}

export function isMultiDayCourse(course: Partial<import("../types").Course> | undefined | null): boolean {
  if (!course) return false;
  if (course.isMultiDay) return true;
  const sessions = getCourseSessions(course);
  return sessions.length > 1;
}

export function generateGoogleCalendarUrl(course: any, session?: any): string {
  const title = encodeURIComponent(`[Training] ${course.title}`);
  const details = encodeURIComponent(`${course.description || ''}\n\nวิทยากร: ${course.instructorName}`);
  
  const targetDate = session?.date || course.date;
  const targetStartTime = session?.startTime || course.startTime || '09:00';
  const targetEndTime = session?.endTime || course.endTime || '16:00';
  const location = encodeURIComponent(session?.locationDetail || course.locationDetail || '');

  const formatDate = (dateStr: string, timeStr: string) => {
    // Assuming Thai timezone (+07:00) for the input
    const d = new Date(`${dateStr}T${timeStr}:00+07:00`);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().replace(/-|:|\.\d+/g, '');
  };

  try {
    const start = formatDate(targetDate, targetStartTime);
    const end = formatDate(targetDate, targetEndTime);
    if (!start || !end) throw new Error("Invalid date");
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
  } catch (e) {
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&location=${location}`;
  }
}
