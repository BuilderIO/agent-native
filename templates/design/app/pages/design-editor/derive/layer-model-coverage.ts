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
