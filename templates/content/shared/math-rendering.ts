import katex, { type KatexOptions } from "katex";

export const KATEX_VERSION = "0.17.0";
export const KATEX_STYLESHEET_URL = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;

export interface MathRenderSuccess {
  ok: true;
  html: string;
}

export interface MathRenderFailure {
  ok: false;
  error: string;
}

export type MathRenderResult = MathRenderSuccess | MathRenderFailure;

export function mathRenderOptions(displayMode: boolean): KatexOptions {
  return {
    displayMode,
    maxExpand: 1_000,
    output: "htmlAndMathml",
    strict: "warn",
    throwOnError: true,
    trust: false,
  };
}

export function mathRenderErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "This equation could not be rendered.";
}

export function renderMathToHtml(
  latex: string,
  displayMode: boolean,
): MathRenderResult {
  if (!latex.trim()) {
    return { ok: false, error: "This equation is empty." };
  }

  try {
    return {
      ok: true,
      html: katex.renderToString(latex, mathRenderOptions(displayMode)),
    };
  } catch (error) {
    return { ok: false, error: mathRenderErrorMessage(error) };
  }
}
