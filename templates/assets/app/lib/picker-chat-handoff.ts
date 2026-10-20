type PickerMediaType = "image" | "video";

export interface PickerChatHandoffInput {
  mediaType: PickerMediaType;
  prompt: string;
  count?: number;
  aspectRatio?: string | null;
  libraryId?: string | null;
  libraryTitle?: string | null;
  templateId?: string | null;
  templateTitle?: string | null;
  /** @deprecated Use templateId. */
  presetId?: string | null;
  /** @deprecated Use templateTitle. */
  presetTitle?: string | null;
  tier?: string | null;
  styleStrength?: string | null;
  includeLogo?: boolean | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function pluralizeCandidate(count: number): string {
  return count === 1 ? "candidate" : "candidates";
}

export function buildPickerChatHandoffPrompt(
  input: PickerChatHandoffInput,
): string {
  const prompt = clean(input.prompt) ?? "";
  const count = Math.min(6, Math.max(1, Math.round(input.count ?? 3)));
  const mediaLabel =
    input.mediaType === "video"
      ? "a video asset"
      : `${count} image ${pluralizeCandidate(count)}`;
  const lines = [`Generate ${mediaLabel} in Assets for this request:`, prompt];

  const libraryTitle = clean(input.libraryTitle);
  const libraryId = clean(input.libraryId);
  if (libraryTitle || libraryId) {
    lines.push(
      `Use the selected library: ${libraryTitle ?? "Untitled library"}${
        libraryId ? ` (${libraryId})` : ""
      }.`,
    );
  }

  const templateTitle = clean(input.templateTitle ?? input.presetTitle);
  const templateId = clean(input.templateId ?? input.presetId);
  if (templateTitle || templateId) {
    lines.push(
      `Use the selected template: ${templateTitle ?? "Untitled template"}${
        templateId ? ` (${templateId})` : ""
      }.`,
    );
  }

  const aspectRatio = clean(input.aspectRatio);
  if (input.mediaType === "image" && aspectRatio) {
    lines.push(`Use aspect ratio ${aspectRatio}.`);
  }

  const tier = clean(input.tier);
  if (tier) lines.push(`Use quality tier ${tier}.`);

  const styleStrength = clean(input.styleStrength);
  if (styleStrength) lines.push(`Use style strength ${styleStrength}.`);
  if (input.includeLogo) lines.push("Include the library logo if available.");

  lines.push("Open the picker with the generated candidates so I can choose.");
  return lines.filter(Boolean).join("\n");
}
