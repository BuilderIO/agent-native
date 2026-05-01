/**
 * <VoiceTranscriptionSection /> — provider picker for composer voice input.
 *
 * Writes the selection to application_state under `voice-transcription-prefs`
 * so the composer's `useVoiceDictation` hook picks it up on next record.
 *
 * Provider status comes from `/_agent-native/voice-providers/status`, which
 * mirrors the server transcription route's key/env resolution.
 */

import React, { useCallback, useEffect, useState } from "react";
import { agentNativePath } from "../api-path.js";
import {
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconMicrophone,
} from "@tabler/icons-react";
import { useBuilderStatus } from "./useBuilderStatus.js";

type Provider =
  | "openai"
  | "builder-gemini"
  | "builder"
  | "browser"
  | "gemini"
  | "groq";

interface Prefs {
  provider: Provider;
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
  browser: true;
}

const PREFS_URL = agentNativePath(
  "/_agent-native/application-state/voice-transcription-prefs",
);
const SECRETS_URL = agentNativePath("/_agent-native/secrets");
const PROVIDER_STATUS_URL = agentNativePath(
  "/_agent-native/voice-providers/status",
);
const DEFAULT_PROVIDER: Provider = "browser";

function isProvider(value: unknown): value is Provider {
  return (
    value === "openai" ||
    value === "builder-gemini" ||
    value === "builder" ||
    value === "browser" ||
    value === "gemini" ||
    value === "groq"
  );
}

export function VoiceTranscriptionSection() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [hasStoredProvider, setHasStoredProvider] = useState(false);
  const [openAiConfigured, setOpenAiConfigured] = useState<boolean | null>(
    null,
  );
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(
    null,
  );
  const [groqConfigured, setGroqConfigured] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { status: builderStatus } = useBuilderStatus();

  useEffect(() => {
    let cancelled = false;
    fetch(PREFS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Prefs | { value?: Prefs } | null) => {
        if (cancelled) return;
        const p =
          (body as Prefs | null)?.provider ??
          (body as { value?: Prefs } | null)?.value?.provider;
        setHasStoredProvider(isProvider(p));
        setProvider(isProvider(p) ? p : DEFAULT_PROVIDER);
      })
      .catch(() => !cancelled && setProvider(DEFAULT_PROVIDER));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hasStoredProvider || provider === null) return;
    if (builderStatus?.configured) setProvider("builder-gemini");
  }, [builderStatus?.configured, hasStoredProvider, provider]);

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
          });
      })
      .catch(() => {
        if (!cancelled) {
          setOpenAiConfigured(false);
          setGeminiConfigured(false);
          setGroqConfigured(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    async (next: Provider, previous: Provider | null) => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(PREFS_URL, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: next }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        // Revert the optimistic update so the UI matches server state.
        setProvider(previous);
        setSaveError(
          `Couldn't save: ${(err as Error)?.message ?? "network error"}. Try again.`,
        );
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const choose = (next: Provider) => {
    if (next === provider) return;
    const previous = provider;
    setProvider(next);
    void persist(next, previous);
  };

  if (provider === null) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <IconLoader2 size={10} className="animate-spin" />
        Loading…
      </div>
    );
  }

  const focusKey = (key: string) => {
    if (typeof window === "undefined") return;
    window.location.hash = `#secrets:${key}`;
  };

  return (
    <div className="space-y-2">
      <ProviderOption
        id="openai"
        selected={provider === "openai"}
        onSelect={() => choose("openai")}
        title="OpenAI Whisper"
        subtitle="Best quality. Requires an OpenAI API key."
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
        id="builder"
        selected={provider === "builder"}
        onSelect={() => choose("builder")}
        disabled={!builderStatus?.configured}
        title="Builder"
        subtitle={
          builderStatus?.configured
            ? "High-quality transcription via Builder.io. No API key needed."
            : "Connect your Builder.io account for high-quality transcription."
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
        id="builder-gemini"
        selected={provider === "builder-gemini"}
        onSelect={() => choose("builder-gemini")}
        disabled={!builderStatus?.configured}
        title="Builder Gemini Flash-Lite"
        subtitle={
          builderStatus?.configured
            ? "Fast Gemini 3.1 Flash-Lite transcription through Builder.io. No API key needed."
            : "Connect Builder.io to try Gemini 3.1 Flash-Lite without a Google key."
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
        selected={provider === "gemini"}
        onSelect={() => choose("gemini")}
        title="Google Gemini"
        subtitle="Fast transcription via Gemini Flash Lite. Requires a Gemini API key."
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
        id="groq"
        selected={provider === "groq"}
        onSelect={() => choose("groq")}
        title="Groq Whisper"
        subtitle="Fastest Whisper inference. Requires a Groq API key."
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

      <ProviderOption
        id="browser"
        selected={provider === "browser"}
        onSelect={() => choose("browser")}
        title="Browser (built-in)"
        subtitle="Lower quality, works offline. No key required."
      />

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
