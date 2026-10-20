export const NATIVE_REGION_EXPORT_ATTRIBUTE = "data-an-native-region-export";
export const NATIVE_EDITOR_VIEWPORT_CLIP_RULE = `html:not([data-agent-native-interact]):not([${NATIVE_REGION_EXPORT_ATTRIBUTE}]){overflow:clip}`;

export function beginNativeRegionExport(root: Element): () => void {
  const previous = root.getAttribute(NATIVE_REGION_EXPORT_ATTRIBUTE);
  root.setAttribute(NATIVE_REGION_EXPORT_ATTRIBUTE, "");
  return () => {
    if (previous === null) root.removeAttribute(NATIVE_REGION_EXPORT_ATTRIBUTE);
    else root.setAttribute(NATIVE_REGION_EXPORT_ATTRIBUTE, previous);
  };
}
