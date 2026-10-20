export const LAYER_MODEL_SYNC_CHARS = 256_000;

export function buildNeededLayerModels<
  File extends { id: string },
  Model,
>(args: {
  files: readonly File[];
  isNeeded: (fileId: string) => boolean;
  contentLength: (fileId: string) => number;
  buildModel: (file: File) => Model;
  namesUnbuiltLayer: (built: Model[]) => boolean;
}): Model[] {
  const needed: File[] = [];
  let restChars = 0;
  for (const file of args.files) {
    if (args.isNeeded(file.id)) needed.push(file);
    else restChars += args.contentLength(file.id);
  }
  const built = needed.map(args.buildModel);
  return built.length !== args.files.length &&
    (restChars <= LAYER_MODEL_SYNC_CHARS || args.namesUnbuiltLayer(built))
    ? args.files.map(args.buildModel)
    : built;
}

const RECENT_LAYER_MODEL_SCREENS = 3;

/** Screens whose layer models outlive their need, most recently needed first. */
export function nextRecentLayerModelFileIds(
  previous: readonly string[],
  neededNow: readonly string[],
): string[] {
  const next = [...new Set(neededNow)];
  for (const fileId of previous) {
    if (!next.includes(fileId)) next.push(fileId);
  }
  return next.slice(0, RECENT_LAYER_MODEL_SCREENS);
}

const NON_LAYER_TAG = /^(script|style|template|link|meta|base|noscript)$/i;

/** Whether a screen's body holds an element, read without parsing the screen. */
export function screenBodyHasElements(content: string): boolean {
  const bodyOpen = /<body\b[^>]*>/i.exec(content);
  const tags = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:-]*)/g;
  tags.lastIndex = bodyOpen ? bodyOpen.index + bodyOpen[0].length : 0;
  for (let match = tags.exec(content); match; match = tags.exec(content)) {
    const tag = match[2];
    if (!tag) continue;
    if (match[1]) {
      if (tag.toLowerCase() === "body") return false;
      continue;
    }
    if (!NON_LAYER_TAG.test(tag)) return true;
    const close = new RegExp(`</${tag}\\s*>`, "gi");
    close.lastIndex = tags.lastIndex;
    const closed = close.exec(content);
    if (!closed) return false;
    tags.lastIndex = closed.index + closed[0].length;
  }
  return false;
}
