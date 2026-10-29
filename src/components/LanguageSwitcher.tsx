import React from "react";
import { useLanguage } from "../contexts/LanguageContext";
import { cn } from "../lib/utils";

interface LanguageSwitcherProps {
  className?: string;
  size?: "sm" | "md";
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ className, size = "md" }) => {
  const { lang, setLang } = useLanguage();

  return (
    <div 
      className={cn(
        "inline-flex items-center gap-0.5 bg-white/95 backdrop-blur-md border border-slate-200 rounded-full p-1 shadow-sm transition-all select-none",
        className
      )}
      role="group"
      aria-label="Language selector"
    >
      <button
        type="button"
        onClick={() => setLang("th")}
        className={cn(
          "font-semibold transition-all rounded-full flex items-center justify-center cursor-pointer",
          size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs",
          lang === "th"
            ? "bg-crimson text-white shadow-sm font-bold"
            : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
        )}
        aria-pressed={lang === "th"}
      >
        TH
      </button>
      <span className="text-slate-300 text-xs font-light px-0.5 pointer-events-none">|</span>
      <button
        type="button"
        onClick={() => setLang("en")}
        className={cn(
          "font-semibold transition-all rounded-full flex items-center justify-center cursor-pointer",
          size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs",
          lang === "en"
            ? "bg-crimson text-white shadow-sm font-bold"
            : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
        )}
        aria-pressed={lang === "en"}
      >
        EN
      </button>
    </div>
  );
};
