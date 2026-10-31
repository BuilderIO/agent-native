export const VOICE_ENGINE_KEY = "clips:voice-engine";
export const VOICE_POLISH_KEY = "clips:voice-polish";
// Before the engine and AI polish were separate settings, one key held both.
// It is only read to migrate installs that predate the split.
export const LEGACY_VOICE_PROVIDER_KEY = "clips:voice-provider";

interface VoiceEngineOption {
  id: string;
  label: string;
  offMacLabel?: string;
}

export const VOICE_ENGINES = [
  { id: "native", label: "Apple Speech", offMacLabel: "Browser built-in" },
  { id: "whisper", label: "Local Whisper" },
] as const satisfies readonly VoiceEngineOption[];

export type VoiceEngine = (typeof VOICE_ENGINES)[number]["id"];
export type VoicePolishProvider = "builder-gemini" | "gemini" | "groq";
export type VoicePolish = "off" | VoicePolishProvider;
export type VoicePolishMode = "off" | "builder" | "byok";
export type ByokPolishProvider = Extract<
  VoicePolishProvider,
  "gemini" | "groq"
>;

export interface VoiceSettings {
  engine: VoiceEngine;
  polish: VoicePolish;
}

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  engine: "native",
  polish: "off",
};

export function voiceEngineOptions(
  isMac: boolean,
): Array<{ value: VoiceEngine; label: string }> {
  return VOICE_ENGINES.map((engine: VoiceEngineOption) => ({
    value: engine.id as VoiceEngine,
    label: !isMac && engine.offMacLabel ? engine.offMacLabel : engine.label,
  }));
}

function isVoiceEngine(value: string | null): value is VoiceEngine {
  return VOICE_ENGINES.some((engine) => engine.id === value);
}

function isVoicePolish(value: string | null): value is VoicePolish {
  return (
    value === "off" ||
    value === "builder-gemini" ||
    value === "gemini" ||
    value === "groq"
  );
}

export function isByokPolishProvider(
  value: VoicePolish,
): value is ByokPolishProvider {
  return value === "gemini" || value === "groq";
}

export function voicePolishMode(polish: VoicePolish): VoicePolishMode {
  if (polish === "off") return "off";
  return isByokPolishProvider(polish) ? "byok" : "builder";
}

// On a Mac, "builder", "gemini" and "groq" always meant Apple Speech followed
// by that provider's cleanup. Off a Mac the same pair still resolves to browser
// speech plus cleanup, or server transcription when the browser cannot
// transcribe. Every other saved value ("macos-native", "browser", "auto",
// unset, unknown) resolved to built-in speech with no cleanup.
const LEGACY_VOICE_PROVIDERS = new Map<string, VoiceSettings>([
  ["whisper", { engine: "whisper", polish: "off" }],
  ["builder", { engine: "native", polish: "builder-gemini" }],
  ["builder-gemini", { engine: "native", polish: "builder-gemini" }],
  ["gemini", { engine: "native", polish: "gemini" }],
  ["groq", { engine: "native", polish: "groq" }],
]);

export function migrateLegacyVoiceProvider(
  saved: string | null,
): VoiceSettings {
  const migrated =
    saved === null ? undefined : LEGACY_VOICE_PROVIDERS.get(saved.trim());
  return { ...(migrated ?? DEFAULT_VOICE_SETTINGS) };
}

export function loadVoiceSettings(
  read: (key: string) => string | null,
): VoiceSettings {
  const engine = read(VOICE_ENGINE_KEY);
  const polish = read(VOICE_POLISH_KEY);
  if (isVoiceEngine(engine) && isVoicePolish(polish)) {
    return { engine, polish };
  }
  const legacy = migrateLegacyVoiceProvider(read(LEGACY_VOICE_PROVIDER_KEY));
  return {
    engine: isVoiceEngine(engine) ? engine : legacy.engine,
    polish: isVoicePolish(polish) ? polish : legacy.polish,
  };
}

export type DictationRoute =
  | {
      kind: "native" | "browser" | "whisper";
      cleanupProvider?: VoicePolishProvider;
    }
  | { kind: "server"; providerPref: VoicePolishProvider };

export function resolveDictationRoute(
  settings: VoiceSettings,
  env: { isMac: boolean; hasBrowserSpeech: boolean },
): DictationRoute {
  const kind =
    settings.engine === "whisper"
      ? "whisper"
      : env.isMac
        ? "native"
        : "browser";
  if (settings.polish === "off") return { kind };
  // Off a Mac, a webview without speech recognition sends the audio to the
  // polish provider to transcribe, as the combined setting always did.
  if (kind === "browser" && !env.hasBrowserSpeech) {
    return { kind: "server", providerPref: settings.polish };
  }
  return { kind, cleanupProvider: settings.polish };
}
