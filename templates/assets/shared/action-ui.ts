export const ASSETS_VARIATION_GRID_RENDERER = "assets.variation-grid";

export interface AssetVariationCardImage {
  id: string;
  libraryId: string;
  title: string | null;
  previewUrl: string;
  thumbnailUrl?: string;
  mediaType?: string;
  mimeType?: string;
  status?: string;
  role?: string;
  draftPendingApproval?: boolean;
  prompt?: string;
}

export interface AssetVariationCardResult {
  images: AssetVariationCardImage[];
}

export function projectAssetVariationResult(
  args: Record<string, unknown>,
  value: unknown,
): AssetVariationCardResult | null {
  if (!isRecord(value)) return null;

  const slotPrompts = new Map<string, string>();
  if (Array.isArray(args.slots)) {
    for (const slot of args.slots) {
      if (!isRecord(slot)) continue;
      if (typeof slot.slotId === "string" && typeof slot.prompt === "string") {
        slotPrompts.set(slot.slotId, slot.prompt);
      }
    }
  }
  const fallbackPrompt = [args.prompt, args.feedback, args.instruction].find(
    (prompt): prompt is string => typeof prompt === "string" && Boolean(prompt),
  );
  const candidates = Array.isArray(value.images) ? value.images : [value];
  const images = candidates.flatMap((candidate) => {
    if (!isRecord(candidate) || candidate.ok === false) return [];
    const previewUrl =
      typeof candidate.previewUrl === "string"
        ? candidate.previewUrl
        : typeof candidate.thumbnailUrl === "string"
          ? candidate.thumbnailUrl
          : undefined;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.libraryId !== "string" ||
      !previewUrl
    ) {
      return [];
    }

    const prompt =
      (typeof candidate.slotId === "string"
        ? slotPrompts.get(candidate.slotId)
        : undefined) ??
      (typeof candidate.prompt === "string" ? candidate.prompt : undefined) ??
      fallbackPrompt ??
      undefined;
    return [
      {
        id: candidate.id,
        libraryId: candidate.libraryId,
        title: typeof candidate.title === "string" ? candidate.title : null,
        previewUrl,
        ...(typeof candidate.thumbnailUrl === "string"
          ? { thumbnailUrl: candidate.thumbnailUrl }
          : {}),
        ...(typeof candidate.mediaType === "string"
          ? { mediaType: candidate.mediaType }
          : {}),
        ...(typeof candidate.mimeType === "string"
          ? { mimeType: candidate.mimeType }
          : {}),
        ...(typeof candidate.status === "string"
          ? { status: candidate.status }
          : {}),
        ...(typeof candidate.role === "string" ? { role: candidate.role } : {}),
        ...(candidate.draftPendingApproval === true
          ? { draftPendingApproval: true }
          : {}),
        ...(prompt ? { prompt: prompt.slice(0, 240) } : {}),
      },
    ];
  });

  return images.length ? { images } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
