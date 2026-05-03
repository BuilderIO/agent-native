/**
 * <VoiceTranscriptionSection /> — source + cleanup settings for voice input.
 *
 * Writes the selection to application_state under `voice-transcription-prefs`
 * so the composer's `useVoiceDictation` hook picks it up on next record. The
 * legacy `provider` field is still written alongside `transcriptionMode` so
 * older clients continue to normalize safely.
 *
 * Provider status comes from `/_agent-native/voice-providers/status`, which
 * mirrors the server transcription route's key/env resolution.
 */

import React, { useCallback, useEffect, useState } from "react";
import { agentNativePath } from "../api-path.js";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconLoader2,
  IconMicrophone,
} from "@tabler/icons-react";
import { useBuilderStatus } from "./useBuilderStatus.js";

type TranscriptionMode = "mac-native" | "google-realtime" | "batch";

type Provider =
  | "auto"
  | "openai"
  | "builder-gemini"
  | "builder"
  | "browser"
  | "gemini"
  | "groq";

interface Prefs {
  transcriptionMode?: TranscriptionMode;
  provider?: Provider;
  instructions?: string;
}

interface SecretStatus {
  key: string;
  status: "set" | "unset" | "invalid";
}

interface ProviderStatus {
  builder: boolean;
  gemini: boolean;
  openai: boolean;
  groq: boolean;
  googleRealtime?: boolean;
  browser: true;
  native?: true;
}

const PREFS_URL = agentNativePath(
  "/_agent-native/application-state/voice-transcription-prefs",
);
const CLEANUP_PREFS_URL = agentNativePath(
  "/_agent-native/application-state/voice-cleanup-prefs",
);
const SECRETS_URL = agentNativePath("/_agent-native/secrets");
const PROVIDER_STATUS_URL = agentNativePath(
  "/_agent-native/voice-providers/status",
);
const DEFAULT_TRANSCRIPTION_MODE: TranscriptionMode = "batch";
const DEFAULT_BATCH_PROVIDER: Provider = "auto";
const GOOGLE_REALTIME_STREAMING_ENABLED = false;

function isProvider(value: unknown): value is Provider {
  return (
    value === "auto" ||
    value === "openai" ||
    value === "builder-gemini" ||
    value === "builder" ||
    value === "browser" ||
    value === "gemini" ||
    value === "groq"
  );
}

function isTranscriptionMode(value: unknown): value is TranscriptionMode {
  return (
    value === "mac-native" || value === "google-realtime" || value === "batch"
  );
}

function normalizeProvider(value: unknown): Provider | null {
  if (!isProvider(value)) return null;
  return value === "builder" ? "builder-gemini" : value;
}

function legacyModeFromProvider(provider: Provider | null): TranscriptionMode {
  if (provider === "browser") return "mac-native";
  return "batch";
}

function providerForMode(
  mode: TranscriptionMode,
  currentProvider: Provider | null,
): Provider {
  if (mode === "mac-native") return "browser";
  if (mode === "google-realtime") return "auto";
  if (!currentProvider || currentProvider === "browser") {
    return DEFAULT_BATCH_PROVIDER;
  }
  return currentProvider;
}

function batchProvider(provider: Provider | null): Provider {
  if (!provider || provider === "browser") return DEFAULT_BATCH_PROVIDER;
  return provider;
}

export function VoiceTranscriptionSection() {
  const [transcriptionMode, setTranscriptionMode] =
    useState<TranscriptionMode | null>(null);
  const [provider, setProvider] = useState<Provider>(DEFAULT_BATCH_PROVIDER);
  const [instructions, setInstructions] = useState("");
  const [openAiConfigured, setOpenAiConfigured] = useState<boolean | null>(
    null,
  );
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(
    null,
  );
  const [groqConfigured, setGroqConfigured] = useState<boolean | null>(null);
  const [googleRealtimeConfigured, setGoogleRealtimeConfigured] = useState<
    boolean | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cleanupEnabled, setCleanupEnabled] = useState<boolean | null>(null);
  const { status: builderStatus } = useBuilderStatus();

  // Read cleanup pref (default: true if Builder is connected).
  useEffect(() => {
    let cancelled = false;
    fetch(CLEANUP_PREFS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          body:
            | { enabled?: boolean }
            | { value?: { enabled?: boolean } }
            | null,
        ) => {
          if (cancelled) return;
          const stored =
            (body as { enabled?: boolean } | null)?.enabled ??
            (body as { value?: { enabled?: boolean } } | null)?.value?.enabled;
          if (typeof stored === "boolean") setCleanupEnabled(stored);
          else setCleanupEnabled(null); // resolve once builderStatus arrives
        },
      )
      .catch(() => !cancelled && setCleanupEnabled(null));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cleanupEnabled !== null) return;
    if (builderStatus?.configured !== undefined) {
      setCleanupEnabled(!!builderStatus.configured);
    }
  }, [builderStatus?.configured, cleanupEnabled]);

  const toggleCleanup = async (next: boolean) => {
    const previous = cleanupEnabled;
    setCleanupEnabled(next);
    try {
      const res = await fetch(CLEANUP_PREFS_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      setCleanupEnabled(previous);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch(PREFS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Prefs | { value?: Prefs } | null) => {
        if (cancelled) return;
        const value =
          (body as { value?: Prefs } | null)?.value ?? (body as Prefs | null);
        const p = normalizeProvider(
          (body as Prefs | null)?.provider ??
            (body as { value?: Prefs } | null)?.value?.provider,
        );
        const storedMode = isTranscriptionMode(value?.transcriptionMode)
          ? value.transcriptionMode
          : null;
        const mode =
          storedMode ??
          (p ? legacyModeFromProvider(p) : DEFAULT_TRANSCRIPTION_MODE);
        const savedInstructions =
          (body as Prefs | null)?.instructions ??
          (body as { value?: Prefs } | null)?.value?.instructions;
        setTranscriptionMode(mode);
        setProvider(providerForMode(mode, p));
        if (typeof savedInstructions === "string") {
          setInstructions(savedInstructions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTranscriptionMode(DEFAULT_TRANSCRIPTION_MODE);
          setProvider(DEFAULT_BATCH_PROVIDER);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(PROVIDER_STATUS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((status: ProviderStatus | null) => {
        if (cancelled) return;
        if (status) {
          setOpenAiConfigured(status.openai);
          setGeminiConfigured(status.gemini);
          setGroqConfigured(status.groq);
          setGoogleRealtimeConfigured(!!status.googleRealtime);
          return;
        }
        return fetch(SECRETS_URL)
          .then((r) => (r.ok ? r.json() : []))
          .then((list: SecretStatus[]) => {
            if (cancelled) return;
            const find = (key: string) =>
              Array.isArray(list) ? list.find((s) => s.key === key) : null;
            setOpenAiConfigured(find("OPENAI_API_KEY")?.status === "set");
            setGeminiConfigured(find("GEMINI_API_KEY")?.status === "set");
            setGroqConfigured(find("GROQ_API_KEY")?.status === "set");
            setGoogleRealtimeConfigured(
              find("GOOGLE_APPLICATION_CREDENTIALS")?.status === "set",
            );
          });
      })
      .catch(() => {
        if (!cancelled) {
          setOpenAiConfigured(false);
          setGeminiConfigured(false);
          setGroqConfigured(false);
          setGoogleRealtimeConfigured(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    async (
      nextMode: TranscriptionMode,
      nextProvider: Provider,
      nextInstructions: string,
      previous: {
        transcriptionMode: TranscriptionMode | null;
        provider: Provider;
        instructions: string;
      },
    ) => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(PREFS_URL, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcriptionMode: nextMode,
            provider: nextProvider,
            instructions: nextInstructions.trim(),
          }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        // Revert the optimistic update so the UI matches server state.
        setTranscriptionMode(previous.transcriptionMode);
        setProvider(previous.provider);
        setInstructions(previous.instructions);
        setSaveError(
          `Couldn't save: ${(err as Error)?.message ?? "network error"}. Try again.`,
        );
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const focusKey = (key: string) => {
    if (typeof window === "undefined") return;
    window.location.hash = `#secrets:${key}`;
  };

  const chooseSource = (next: TranscriptionMode) => {
    if (next === transcriptionMode) return;
    if (
      next === "google-realtime" &&
      (!googleRealtimeConfigured || !GOOGLE_REALTIME_STREAMING_ENABLED)
    ) {
      setShowAdvanced(true);
      focusKey("GOOGLE_APPLICATION_CREDENTIALS");
      return;
    }
    const previous = { transcriptionMode, provider, instructions };
    const nextProvider = providerForMode(next, provider);
    setTranscriptionMode(next);
    setProvider(nextProvider);
    void persist(next, nextProvider, instructions, previous);
  };

  const chooseBatchProvider = (next: Provider) => {
    const nextProvider = batchProvider(normalizeProvider(next));
    if (transcriptionMode === "batch" && nextProvider === provider) return;
    const previous = { transcriptionMode, provider, instructions };
    setTranscriptionMode("batch");
    setProvider(nextProvider);
    void persist("batch", nextProvider, instructions, previous);
  };

  const updateInstructions = (next: string) => {
    const previous = { transcriptionMode, provider, instructions };
    setInstructions(next);
    if (transcriptionMode) {
      void persist(transcriptionMode, provider, next, previous);
    }
  };

  if (transcriptionMode === null) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <IconLoader2 size={10} className="animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-border bg-background p-2">
        <div className="mb-2 flex items-start justify-between gap-3 px-0.5">
          <div>
            <div className="text-[11px] font-medium text-foreground">
              Live transcription
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Choose where real-time words come from. Batch still runs after
              recording stops.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <ProviderOption
            id="mac-native"
            selected={transcriptionMode === "mac-native"}
            onSelect={() => chooseSource("mac-native")}
            title="Mac Native"
            subtitle="Free and fast in the macOS Tauri app. Web clients use the existing browser-native path when available."
            rightSlot={
              <span className="text-[10px] text-muted-foreground">
                Tauri default
              </span>
            }
          />
          <ProviderOption
            id="google-realtime"
            selected={transcriptionMode === "google-realtime"}
            onSelect={() => chooseSource("google-realtime")}
            disabled={
              !googleRealtimeConfigured || !GOOGLE_REALTIME_STREAMING_ENABLED
            }
            title="Google Realtime (coming soon)"
            subtitle={
              googleRealtimeConfigured
                ? "Credential detected. The streaming WebSocket path is not enabled yet, so keep using Mac Native or Batch."
                : "BYOK only for v1. Configure Google service account before selecting this source."
            }
            rightSlot={
              googleRealtimeConfigured ? (
                <span className="flex items-center gap-1 text-[10px] text-green-500">
                  <IconCheck size={10} />
                  Credential set
                </span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAdvanced(true);
                    focusKey("GOOGLE_APPLICATION_CREDENTIALS");
                  }}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                >
                  Configure
                  <IconExternalLink size={10} />
                </button>
              )
            }
          />
          <ProviderOption
            id="batch"
            selected={transcriptionMode === "batch"}
            onSelect={() => chooseSource("batch")}
            title="Batch"
            subtitle="Universal fallback. Sends audio after recording stops through Builder Gemini, Gemini, Groq, then OpenAI."
          />
        </div>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-accent/30 px-2.5 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-foreground">
            AI cleanup
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Polish punctuation, casing, filler words, titles, and summaries
            after capture. Builder Gemini is tried first; BYOK Gemini is the
            fallback.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={!!cleanupEnabled}
            onClick={() => toggleCleanup(!cleanupEnabled)}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
              cleanupEnabled
                ? "bg-[#625DF5]"
                : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${
                cleanupEnabled ? "translate-x-3.5" : "translate-x-0.5"
              }`}
            />
          </button>
          {cleanupEnabled && (
            <span className="text-[10px] text-muted-foreground">
              {builderStatus?.configured
                ? "Builder ready"
                : geminiConfigured
                  ? "Gemini key set"
                  : "Needs key"}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border bg-background">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-2 cursor-pointer"
        >
          <span className="text-[11px] font-medium text-foreground inline-flex items-center gap-1">
            {showAdvanced ? (
              <IconChevronDown size={12} />
            ) : (
              <IconChevronRight size={12} />
            )}
            Add API keys
          </span>
          <span className="text-[10px] text-muted-foreground">
            Google STT · Gemini · Groq · OpenAI
          </span>
        </button>

        {showAdvanced && (
          <div className="px-2 pb-2 space-y-2">
            <ProviderOption
              id="google-service-account"
              selected={transcriptionMode === "google-realtime"}
              onSelect={() => chooseSource("google-realtime")}
              disabled={
                !googleRealtimeConfigured || !GOOGLE_REALTIME_STREAMING_ENABLED
              }
              title="Google Speech-to-Text service account"
              subtitle="Service-account JSON for the future WebSocket to Google StreamingRecognize path. Saved credentials are detected now; streaming is still coming soon."
              rightSlot={
                googleRealtimeConfigured ===
                null ? null : googleRealtimeConfigured ? (
                  <span className="flex items-center gap-1 text-[10px] text-green-500">
                    <IconCheck size={10} />
                    Credential set
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      focusKey("GOOGLE_APPLICATION_CREDENTIALS");
                    }}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40"
                  >
                    Configure
                    <IconExternalLink size={10} />
                  </button>
                )
              }
            />

            <ProviderOption
              id="auto"
              selected={transcriptionMode === "batch" && provider === "auto"}
              onSelect={() => chooseBatchProvider("auto")}
              title="Automatic batch fallback"
              subtitle="Keep the current Clips fallback chain: Builder Gemini, Gemini, Groq, then OpenAI."
            />

            <ProviderOption
              id="builder-gemini"
              selected={
                transcriptionMode === "batch" && provider === "builder-gemini"
              }
              onSelect={() => chooseBatchProvider("builder-gemini")}
              disabled={!builderStatus?.configured}
              title="Builder.io Connect"
              subtitle={
                builderStatus?.configured
                  ? "Use Builder-hosted Gemini Flash-Lite for batch transcription and cleanup."
                  : "One-click connect for Gemini Flash-Lite cleanup and batch transcription. No Google key needed."
              }
              rightSlot={
                builderStatus?.configured ? (
                  <span className="flex items-center gap-1 text-[10px] text-green-500">
                    <IconCheck size={10} />
                    Connected
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = new URL(
                        agentNativePath("/_agent-native/builder/connect"),
                        window.location.origin,
                      ).href;
                      window.open(
                        url,
                        "_blank",
                        "noopener,noreferrer,width=600,height=700",
                      );
                    }}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40"
                  >
                    Connect Builder.io
                    <IconExternalLink size={10} />
                  </button>
                )
              }
            />

            <ProviderOption
              id="gemini"
              selected={transcriptionMode === "batch" && provider === "gemini"}
              onSelect={() => chooseBatchProvider("gemini")}
              title="Google Gemini"
              subtitle="BYOK Gemini for AI cleanup and optional strict batch transcription."
              rightSlot={
                geminiConfigured === null ? null : geminiConfigured ? (
                  <span className="flex items-center gap-1 text-[10px] text-green-500">
                    <IconCheck size={10} />
                    Key set
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      focusKey("GEMINI_API_KEY");
                    }}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40"
                  >
                    Add key
                    <IconExternalLink size={10} />
                  </button>
                )
              }
            />

            <ProviderOption
              id="openai"
              selected={transcriptionMode === "batch" && provider === "openai"}
              onSelect={() => chooseBatchProvider("openai")}
              title="OpenAI Whisper"
              subtitle="Batch Whisper provider. Requires an OpenAI API key."
              rightSlot={
                openAiConfigured === null ? null : openAiConfigured ? (
                  <span className="flex items-center gap-1 text-[10px] text-green-500">
                    <IconCheck size={10} />
                    Key set
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      focusKey("OPENAI_API_KEY");
                    }}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40"
                  >
                    Add key
                    <IconExternalLink size={10} />
                  </button>
                )
              }
            />

            <ProviderOption
              id="groq"
              selected={transcriptionMode === "batch" && provider === "groq"}
              onSelect={() => chooseBatchProvider("groq")}
              title="Groq Whisper"
              subtitle="Fast Whisper batch provider. Requires a Groq API key."
              rightSlot={
                groqConfigured === null ? null : groqConfigured ? (
                  <span className="flex items-center gap-1 text-[10px] text-green-500">
                    <IconCheck size={10} />
                    Key set
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      focusKey("GROQ_API_KEY");
                    }}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40"
                  >
                    Add key
                    <IconExternalLink size={10} />
                  </button>
                )
              }
            />
          </div>
        )}
      </div>

      {(cleanupEnabled || transcriptionMode === "batch") && (
        <div className="rounded-md border border-border bg-accent/20 px-2.5 py-2">
          <label
            htmlFor="voice-transcription-instructions"
            className="block text-[10px] font-medium text-foreground"
          >
            Custom instructions
          </label>
          <textarea
            id="voice-transcription-instructions"
            value={instructions}
            onChange={(event) => updateInstructions(event.target.value)}
            placeholder="Names, casing, punctuation, style, or terms to preserve."
            className="mt-1 min-h-16 w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Included with batch transcription and AI cleanup.
          </p>
        </div>
      )}

      {saving && <p className="text-[10px] text-muted-foreground">Saving…</p>}
      {saveError && !saving && (
        <p className="text-[10px] text-red-500" role="alert">
          {saveError}
        </p>
      )}
    </div>
  );
}

interface ProviderOptionProps {
  id: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  subtitle?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

function ProviderOption({
  id,
  selected,
  disabled,
  onSelect,
  title,
  subtitle,
  rightSlot,
}: ProviderOptionProps) {
  const select = () => {
    if (!disabled) onSelect();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={select}
      onKeyDown={onKeyDown}
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      className={`w-full text-left rounded-md border px-2.5 py-2 flex items-start gap-2 ${
        selected
          ? "border-[#625DF5] bg-[#625DF5]/10"
          : "border-border bg-accent/30 hover:bg-accent/50"
      } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <span
        className={`mt-[2px] shrink-0 flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
          selected
            ? "border-[#625DF5] bg-[#625DF5]"
            : "border-muted-foreground/40 bg-background"
        }`}
      >
        {selected && (
          <span className="h-1.5 w-1.5 rounded-full bg-background" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-medium text-foreground">{title}</div>
          {rightSlot && <div className="shrink-0">{rightSlot}</div>}
        </div>
        {subtitle && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

export function VoiceTranscriptionIcon() {
  return <IconMicrophone size={14} />;
}
