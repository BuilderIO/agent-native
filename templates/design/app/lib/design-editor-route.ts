import { SHELL_DESIGN_ID } from "./shell-design";

const DESIGN_EDITOR_ROUTE =
  /^\/(?<surface>design|visual-edit)\/(?<designId>[^/?#]+)(?:\/|$)/;

export function designEditorRoute(pathname: string): {
  designId: string;
  surface: "design" | "visual-edit";
} | null {
  const match = DESIGN_EDITOR_ROUTE.exec(pathname);
  const designId = match?.groups?.designId;
  const surface = match?.groups?.surface;
  if (!designId || (surface !== "design" && surface !== "visual-edit")) {
    return null;
  }
  try {
    return { designId: decodeURIComponent(designId), surface };
  } catch {
    return null;
  }
}

export function isDesignEditorRoute(pathname: string): boolean {
  return designEditorRoute(pathname) !== null;
}

export function isPersistedDesignEditorRoute(pathname: string): boolean {
  const route = designEditorRoute(pathname);
  return route !== null && route.designId !== SHELL_DESIGN_ID;
}

export function designEditorViewFromSearchParams(
  searchParams: URLSearchParams,
): "single" | "overview" | undefined {
  const value = searchParams.get("editorView") ?? searchParams.get("view");
  return value === "single" || value === "overview" ? value : undefined;
}
