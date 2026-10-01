import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/**
 * Converts unsupported CSS Color 4 (oklch, oklab, lab, lch) into valid Hex/RGB
 * using a temporary canvas 2D rendering context or deterministic color map.
 */
function createColorConverter(doc: Document) {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const canvas = doc.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  } catch (e) {
    // Canvas context fallback
  }

  return function toSafeColor(colorStr: string): string {
    if (!colorStr || typeof colorStr !== "string") return colorStr;
    
    // If color does not contain modern color functions, return as-is
    if (!colorStr.includes("oklch") && !colorStr.includes("oklab") && !colorStr.includes("lab") && !colorStr.includes("lch")) {
      return colorStr;
    }

    // Try native canvas conversion
    if (ctx) {
      try {
        ctx.fillStyle = "#000000";
        ctx.fillStyle = colorStr;
        const res = ctx.fillStyle;
        if (res && !res.includes("oklch") && !res.includes("oklab") && !res.includes("lab") && !res.includes("lch")) {
          return res;
        }
      } catch {
        // Continue to fallback
      }
    }

    // Fallback mappings for Tailwind OKLCH lightness values
    if (colorStr.includes("oklch(0.9") || colorStr.includes("oklch(0.98") || colorStr.includes("oklch(0.97")) {
      return "#F8FAFC";
    }
    if (colorStr.includes("oklch(0.8")) {
      return "#E2E8F0";
    }
    if (colorStr.includes("oklch(0.2") || colorStr.includes("oklch(0.1")) {
      return "#0F172A";
    }
    return "#1E293B";
  };
}

/**
 * Sanitizes all elements in the cloned document scoped to the PDF report container
 * and cleanses any stylesheets inside the cloned document of unsupported oklch values.
 */
function sanitizeClonedReportDom(clonedDoc: Document, containerId: string) {
  const container = clonedDoc.getElementById(containerId);
  if (!container) return;

  const toSafeColor = createColorConverter(clonedDoc);

  // 1. Sanitize any embedded <style> tags in the cloned document
  const styleTags = Array.from(clonedDoc.querySelectorAll<HTMLStyleElement>("style"));
  styleTags.forEach((styleTag) => {
    try {
      if (styleTag.textContent && (styleTag.textContent.includes("oklch") || styleTag.textContent.includes("oklab"))) {
        styleTag.textContent = styleTag.textContent.replace(/oklch\([^)]+\)/gi, (match) => {
          return toSafeColor(match);
        }).replace(/oklab\([^)]+\)/gi, (match) => {
          return toSafeColor(match);
        });
      }
    } catch (e) {
      console.warn("Could not sanitize style tag:", e);
    }
  });

  // 2. Target relevant CSS properties on the container and its children
  const elements = [container, ...Array.from(container.querySelectorAll<HTMLElement>("*"))];

  const colorProperties = [
    "color",
    "backgroundColor",
    "borderTopColor",
    "borderRightColor",
    "borderBottomColor",
    "borderLeftColor",
    "outlineColor",
    "textDecorationColor"
  ] as const;

  elements.forEach((el) => {
    try {
      const computed = clonedDoc.defaultView?.getComputedStyle(el) || window.getComputedStyle(el);

      colorProperties.forEach((prop) => {
        const val = computed[prop];
        if (val && (val.includes("oklch") || val.includes("oklab") || val.includes("lab") || val.includes("lch"))) {
          el.style[prop] = toSafeColor(val);
        }
      });

      // SVG Elements
      if (el instanceof SVGElement || el.tagName.toLowerCase() === "svg" || el.closest("svg")) {
        const fill = el.getAttribute("fill") || computed.fill;
        if (fill && (fill.includes("oklch") || fill.includes("oklab") || fill.includes("lab") || fill.includes("lch"))) {
          const safeFill = toSafeColor(fill);
          el.setAttribute("fill", safeFill);
          el.style.fill = safeFill;
        }
        const stroke = el.getAttribute("stroke") || computed.stroke;
        if (stroke && (stroke.includes("oklch") || stroke.includes("oklab") || stroke.includes("lab") || stroke.includes("lch"))) {
          const safeStroke = toSafeColor(stroke);
          el.setAttribute("stroke", safeStroke);
          el.style.stroke = safeStroke;
        }
      }
    } catch (e) {
      // Element traversal guard
    }
  });
}

/**
 * Preload required Thai typography fonts prior to canvas rasterization.
 */
async function preloadFonts() {
  if (typeof document !== "undefined" && document.fonts) {
    try {
      await document.fonts.ready;
      await Promise.allSettled([
        document.fonts.load('400 16px "Prompt"'),
        document.fonts.load('600 16px "Prompt"'),
        document.fonts.load('700 16px "Prompt"'),
        document.fonts.load('400 16px "Kanit"'),
        document.fonts.load('600 16px "Kanit"'),
        document.fonts.load('700 16px "Kanit"')
      ]);
    } catch (e) {
      console.warn("Font preloading notice:", e);
    }
  }
}

export async function exportEvaluationPdf(
  containerId: string,
  filename: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const container = document.getElementById(containerId);
  if (!container) {
    throw new Error("ไม่พบโครงร่างเอกสารสำหรับสร้าง PDF");
  }

  const pageElements = Array.from(container.querySelectorAll<HTMLElement>(".pdf-page"));
  if (pageElements.length === 0) {
    throw new Error("ไม่พบหน้าที่ต้องการส่งออก");
  }

  // Preload fonts to guarantee Thai glyph stability
  await preloadFonts();

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true
  });

  const totalPages = pageElements.length;

  for (let i = 0; i < totalPages; i++) {
    if (onProgress) {
      onProgress(`กำลังประมวลผลหน้า ${i + 1} จาก ${totalPages}...`);
    }

    const pageEl = pageElements[i];

    const canvas = await html2canvas(pageEl, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: 800,
      onclone: (clonedDoc) => {
        sanitizeClonedReportDom(clonedDoc, containerId);
      }
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const pdfWidth = 210;
    const pdfHeight = 297;

    if (i > 0) {
      pdf.addPage("a4", "portrait");
    }

    pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");
  }

  if (onProgress) {
    onProgress("กำลังดาวน์โหลดไฟล์ PDF...");
  }

  pdf.save(filename);
}
