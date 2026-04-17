/**
 * <VoiceTranscriptionSection /> — provider picker for composer voice input.
 *
 * Writes the selection to application_state under `voice-transcription-prefs`
 * so the composer's `useVoiceDictation` hook picks it up on next record.
 *
 * Providers:
 *   - "openai"  — best quality, requires OPENAI_API_KEY (user-scoped secret)
 *   - "builder" — coming soon (disabled placeholder)
 *   - "browser" — default; Web Speech API, low quality, works offline
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconMicrophone,
} from "@tabler/icons-react";

type Provider = "openai" | "builder" | "browser";

interface Prefs {
  provider: Provider;
}

interface SecretStatus {
  key: string;
  status: "set" | "unset" | "invalid";
}

const PREFS_URL = "/_agent-native/application-state/voice-transcription-prefs";
const SECRETS_URL = "/_agent-native/secrets";
const DEFAULT_PROVIDER: Provider = "browser";

export function VoiceTranscriptionSection() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [openAiConfigured, setOpenAiConfigured] = useState<boolean | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(PREFS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { value?: Prefs } | null) => {
        if (cancelled) return;
        const p = body?.value?.provider;
        setProvider(
          p === "openai" || p === "builder" || p === "browser"
            ? p
            : DEFAULT_PROVIDER,
        );
      })
      .catch(() => !cancelled && setProvider(DEFAULT_PROVIDER));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(SECRETS_URL)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: SecretStatus[]) => {
        if (cancelled) return;
        const openAi = Array.isArray(list)
          ? list.find((s) => s.key === "OPENAI_API_KEY")
          : null;
        setOpenAiConfigured(openAi?.status === "set");
      })
      .catch(() => !cancelled && setOpenAiConfigured(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: Provider) => {
    setSaving(true);
    try {
      await fetch(PREFS_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: { provider: next } }),
      });
    } finally {
      setSaving(false);
    }
  }, []);

  const choose = (next: Provider) => {
    if (next === provider) return;
    if (next === "builder") return; // placeholder — disabled
    setProvider(next);
    void persist(next);
  };

  if (provider === null) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <IconLoader2 size={10} className="animate-spin" />
        Loading…
      </div>
    );
  }

  const focusOpenAiKey = () => {
    if (typeof window === "undefined") return;
    window.location.hash = "#secrets:OPENAI_API_KEY";
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
                focusOpenAiKey();
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
        selected={false}
        onSelect={() => {}}
        disabled
        title="Builder"
        subtitle="Shared key across Builder workspaces. No setup needed."
        rightSlot={
          <span className="rounded-full bg-accent/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Coming soon
          </span>
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
    </div>
  );
}

interface ProviderOptionProps {
  id: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  subtitle?: string;
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
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
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
    </button>
  );
}

export function VoiceTranscriptionIcon() {
  return <IconMicrophone size={14} />;
}
