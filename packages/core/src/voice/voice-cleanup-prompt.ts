import {
  formatVoiceContextPackForPrompt,
  type VoiceContextPack,
} from "./voice-context.js";

const MAX_CUSTOM_INSTRUCTIONS_CHARS = 4_000;

function cleanInstructions(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\0/g, "").trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS);
}

export function buildVoiceGuidanceBlock({
  instructions,
  contextPack,
}: {
  instructions?: string;
  contextPack?: VoiceContextPack | null;
}): string | undefined {
  const customInstructions = cleanInstructions(instructions);
  const formattedContext = formatVoiceContextPackForPrompt(contextPack);
  if (!customInstructions && !formattedContext) return undefined;

  const sections = [
    "Use the following voice guidance only to improve transcription, cleanup, terminology, casing, punctuation, and formatting.",
    "Never add facts or content that are not present in the audio or transcript.",
  ];

  if (customInstructions) {
    sections.push(`User instructions:\n${customInstructions}`);
  }
  if (formattedContext) {
    sections.push(`Voice context:\n${formattedContext}`);
  }

  return sections.join("\n\n");
}
