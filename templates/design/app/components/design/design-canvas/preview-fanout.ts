export type PreviewReplacer = (
  nextContent: string,
  selector?: string | null,
  selectorCandidates?: string[],
  options?: { forceFullDocument?: boolean },
) => boolean;

/**
 * One screen can be mounted as several canvases at once — the primary frame
 * plus a frame per breakpoint — and a single registration slot means only the
 * last one mounted ever receives a host push, leaving the others showing
 * whatever their srcdoc was built from.
 */
const replacersByScreen = new Map<string, Set<PreviewReplacer>>();

export function registerPreviewReplacer(
  screenId: string,
  replacer: PreviewReplacer,
): () => void {
  let replacers = replacersByScreen.get(screenId);
  if (!replacers) {
    replacers = new Set();
    replacersByScreen.set(screenId, replacers);
  }
  replacers.add(replacer);
  return () => {
    const current = replacersByScreen.get(screenId);
    if (!current) return;
    current.delete(replacer);
    if (current.size === 0) replacersByScreen.delete(screenId);
  };
}

/** `primary` first so its result stays the one the caller reports. */
export function previewReplacersFor(
  screenId: string | null | undefined,
  primary?: PreviewReplacer,
): PreviewReplacer[] {
  const others = screenId ? [...(replacersByScreen.get(screenId) ?? [])] : [];
  const rest = others.filter((replacer) => replacer !== primary);
  return primary ? [primary, ...rest] : rest;
}
