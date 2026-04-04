import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatInstructorName(name: string | undefined): string {
  if (!name) return "";
  const trimmedName = name.trim();
  const prefixes = [
    "ผศ.", "รศ.", "ศ.", "ดร.", "ผศ.ดร.", "รศ.ดร.", "ศ.ดร.", 
    "อ.", "อาจารย์", "ผศ", "รศ", "ศ", "ดร"
  ];
  
  const hasPrefix = prefixes.some(prefix => trimmedName.startsWith(prefix));
  
  if (!hasPrefix) {
    return `อ. ${trimmedName}`;
  }
  return trimmedName;
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
