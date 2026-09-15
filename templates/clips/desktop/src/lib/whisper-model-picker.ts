import type { WhisperModelOption } from "../hooks/useWhisperSettings";

export function whisperModelOptionLabel(
  model: Pick<WhisperModelOption, "title" | "sizeMb">,
): string {
  return `${model.title} · ${model.sizeMb} MB`;
}
