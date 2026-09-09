/// <reference types="vite/client" />

declare module "react-dom/server.browser" {
  export * from "react-dom/server";
  export { default } from "react-dom/server";
}

declare module "dom-to-pptx" {
  export interface DomToPptxOptions {
    autoEmbedFonts?: boolean;
    fileName?: string;
    fonts?: Array<{ name: string; url?: string; urls?: string[] }>;
    height?: number;
    layout?: string;
    skipDownload?: boolean;
    svgAsVector?: boolean;
    width?: number;
  }

  export function exportToPptx(
    target: HTMLElement | string | Array<HTMLElement | string>,
    options?: DomToPptxOptions,
  ): Promise<Blob>;
}
