import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatInstructorName(name: string | undefined): string {
  if (!name) return "";
  const trimmedName = name.trim();
  
  // Safe prefixes to check directly (with dots or full words)
  const standardPrefixes = [
    "ผศ.ดร.", "รศ.ดร.", "ศ.ดร.", 
    "ผศ.", "รศ.", "ศ.", "ดร.", "อ.", "อาจารย์"
  ];
  
  // Prefixes that are often typed without dots, but we MUST check if they are followed by a space
  // to avoid false positives (e.g., "ศ" in "ศิริพงศ์", "ดร" in "ดรุณี", "อ" in "อนุชา")
  const spaceRequiredPrefixes = [
    "ผศ", "รศ", "ศ", "ดร", "อ"
  ];

  let cleanedName = trimmedName;
  let hasPrefix = false;

  for (const prefix of standardPrefixes) {
    if (cleanedName.startsWith(prefix)) {
      hasPrefix = true;
      // Remove space after prefix if it exists
      if (cleanedName.startsWith(prefix + " ")) {
        cleanedName = prefix + cleanedName.substring(prefix.length).trim();
      }
      break;
    }
  }

  if (!hasPrefix) {
    for (const prefix of spaceRequiredPrefixes) {
      if (cleanedName.startsWith(prefix + " ")) {
        hasPrefix = true;
        // Normalize to dotted prefix and remove space
        cleanedName = prefix + "." + cleanedName.substring(prefix.length).trim();
        break;
      }
    }
  }

  if (!hasPrefix) {
    return `อ.${cleanedName}`;
  }
  return cleanedName;
}

export function formatDateThai(dateString: string | undefined): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear() + 543; // Convert to Buddhist Era
    
    return `${day}/${month}/${year}`;
  } catch (e) {
    return dateString;
  }
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
