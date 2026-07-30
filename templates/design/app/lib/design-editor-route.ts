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
