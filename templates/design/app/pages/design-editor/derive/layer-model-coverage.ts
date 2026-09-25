// Screens this small project within a frame, so a few-screen design keeps
// every Layers model from its first render instead of waiting for idle time.
export const LAYER_MODEL_SYNC_CHARS = 256_000;

/**
 * The Layers models one render builds. A many-screen design must not project
 * every screen before its first frame, so only screens something already
 * needs get a model; the rest wait for the idle fill. Every screen is built
 * anyway when the rest is small enough to project now, or when a selection
 * names a layer none of the built models own.
 */
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
