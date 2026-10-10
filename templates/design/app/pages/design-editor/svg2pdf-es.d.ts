declare module "svg2pdf.js/dist/svg2pdf.es.js" {
  import type { jsPDF } from "jspdf";

  export function svg2pdf(
    element: Element,
    pdf: jsPDF,
    options?: {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      loadImages?: boolean | RegExp;
      loadExternalStyleSheets?: boolean;
    },
  ): Promise<jsPDF>;
}
