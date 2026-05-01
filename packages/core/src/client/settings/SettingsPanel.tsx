import { agentNativePath } from "../api-path.js";
import React, {
  Suspense,
  lazy,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import {
  IconChevronDown,
  IconCheck,
  IconExternalLink,
  IconBrain,
  IconBrowser,
  IconGitBranch,
  IconCloud,
  IconDatabase,
  IconShield,
  IconPlugConnected,
  IconTopologyRing2,
  IconLoader2,
  IconUpload,
  IconCoin,
  IconMail,
  IconKey,
  IconMicrophone,
  IconBolt,
} from "@tabler/icons-react";
import { SettingsSection } from "./SettingsSection.js";
import { useBuilderStatus } from "./useBuilderStatus.js";
import { BuilderBMark } from "../builder-mark.js";
import { AgentsSection } from "./AgentsSection.js";
import { UsageSection } from "./UsageSection.js";
import { SecretsSection } from "./SecretsSection.js";
import { VoiceTranscriptionSection } from "./VoiceTranscriptionSection.js";
import { AutomationsSection } from "./AutomationsSection.js";
import { PROVIDER_ENV_PLACEHOLDERS } from "../../agent/engine/provider-env-vars.js";

const IntegrationsPanel = lazy(() =>
  import("../integrations/IntegrationsPanel.js").then((m) => ({
    default: m.IntegrationsPanel,
  })),
);

// ─── Shared helpers ─────────────────────────────────────────────────────────

function SettingsSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <div
            className="h-3 rounded bg-muted-foreground/10"
            style={{ width: i === 0 ? "30%" : i === 1 ? "100%" : "60%" }}
          />
          {i < 2 && (
            <div className="h-9 rounded-md border border-border bg-muted-foreground/5" />
          )}
        </div>
      ))}
    </div>
  );
}

interface SettingsSelectOption {
  value: string;
  label: string;
  description?: string;
}

const CONTROL_STYLE = {
  fontSize: 12,
  lineHeight: 1,
} satisfies React.CSSProperties;

function SettingsSelect({
  label,
  labelAdornment,
  value,
  options,
  onValueChange,
}: {
  label: string;
  labelAdornment?: React.ReactNode;
  value: string;
  options: SettingsSelectOption[];
  onValueChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium text-foreground">{label}</p>
        {labelAdornment}
      </div>
      <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
        <SelectPrimitive.Trigger
          className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-3 text-left text-[12px] text-foreground outline-none transition-colors hover:bg-accent/40 data-[placeholder]:text-muted-foreground"
          aria-label={label}
          style={CONTROL_STYLE}
        >
          <SelectPrimitive.Value>
            {selected?.label ?? value}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon asChild>
            <IconChevronDown size={14} className="text-muted-foreground" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            className="z-[9999] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="relative flex w-full cursor-pointer select-none items-start gap-2 rounded-md px-8 py-2.5 text-[12px] outline-none data-[highlighted]:bg-accent/60 data-[state=checked]:bg-accent/40"
                  style={CONTROL_STYLE}
                >
                  <span className="absolute left-2 top-2.5 flex h-4 w-4 items-center justify-center text-muted-foreground">
                    <SelectPrimitive.ItemIndicator>
                      <IconCheck size={14} />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <SelectPrimitive.ItemText>
                      <span className="text-foreground">{option.label}</span>
                    </SelectPrimitive.ItemText>
                    {option.description ? (
                      <span className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </div>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}

// ─── Disconnect button for the Builder card's connected state ───────────────
//
// Two-step confirmation: first click arms the button ("Confirm?"), second
// click actually disconnects. Arm auto-reverts after 4s of idle so a user
// who wandered off doesn't come back to a disconnect waiting for them.
//
// Hits /_agent-native/builder/disconnect which scrubs BUILDER_* keys from the
// template `.env`, `process.env`, and the `persisted-env-vars` settings row.
// On success we dispatch `agent-engine:configured-changed` so dependent cards
// refresh inline (no hard reload — that was racing with nitro's env-runner
// restart and hitting React Router's error boundary).
function DisconnectBuilderButton() {
  const { status } = useBuilderStatus();
  const [phase, setPhase] = useState<"idle" | "armed" | "busy">("idle");
  const [err, setErr] = useState<string | null>(null);
  const armedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Env-managed: Builder identity comes from the deploy-level
  // BUILDER_PRIVATE_KEY. Disconnection is operator-controlled (rotate / unset
  // the env var); the per-user disconnect endpoint refuses with 409.
  if (status?.envManaged) return null;

  const clearArmedTimer = useCallback(() => {
    if (armedTimerRef.current) {
      clearTimeout(armedTimerRef.current);
      armedTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearArmedTimer();
  }, [clearArmedTimer]);

  const performDisconnect = useCallback(async () => {
    setPhase("busy");
    setErr(null);
    clearArmedTimer();
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/builder/disconnect"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      // Parse defensively — a nitro 404 fallback returns HTML, not JSON,
      // and res.json() on that would throw.
      const text = await res.text();
      let body: {
        ok?: boolean;
        error?: string;
        warnings?: Record<string, string>;
      } = {};
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          // Non-JSON response — likely a 404/HTML fallback.
        }
      }
      if (!res.ok) {
        throw new Error(
          body.error || `Failed (${res.status}). Is dev:all up to date?`,
        );
      }
      if (body.ok !== true) {
        throw new Error(body.error || "Disconnect didn't confirm ok");
      }
      if (body.warnings && Object.keys(body.warnings).length > 0) {
        // Disconnect flag persisted (we only reach here when ok:true), so
        // the user IS disconnected — but some ancillary cleanup failed.
        // Log so it's visible during dev; don't block the success path.
        console.warn(
          "[builder-disconnect] completed with warnings:",
          body.warnings,
        );
      }
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
      setPhase("idle");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Disconnect failed");
      setPhase("idle");
    }
  }, [clearArmedTimer]);

  const handleDisconnectClick = useCallback(() => {
    if (phase === "busy") return;
    if (phase === "idle") {
      // First click — arm the button. Auto-revert after 4s to avoid a
      // stale "confirm" state someone else could hit by accident.
      setPhase("armed");
      setErr(null);
      clearArmedTimer();
      armedTimerRef.current = setTimeout(() => {
        setPhase("idle");
        armedTimerRef.current = null;
      }, 4000);
      return;
    }
    // phase === "armed" — user confirmed, actually disconnect.
    void performDisconnect();
  }, [phase, performDisconnect, clearArmedTimer]);

  const handleCancel = useCallback(() => {
    clearArmedTimer();
    setPhase("idle");
  }, [clearArmedTimer]);

  if (phase === "armed") {
    return (
      <>
        <button
          type="button"
          onClick={handleDisconnectClick}
          className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20"
        >
          Confirm disconnect
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40"
        >
          Cancel
        </button>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDisconnectClick}
        disabled={phase === "busy"}
        className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40 disabled:opacity-60 disabled:cursor-wait"
        aria-busy={phase === "busy"}
      >
        {phase === "busy" ? (
          <>
            <IconLoader2 size={10} className="animate-spin" />
            Disconnecting…
          </>
        ) : (
          "Disconnect"
        )}
      </button>
      {err && <span className="text-[10px] text-destructive">{err}</span>}
    </>
  );
}

// ─── "Connect Builder.io" card (shared across all sections) ─────────────────

function UseBuilderCard({
  connectUrl,
  connected,
  orgName,
  label = "Connect Builder.io",
  subtitle = "One click, no API key needed.",
  dim,
}: {
  connectUrl?: string;
  connected: boolean;
  orgName?: string;
  label?: string;
  subtitle?: string;
  dim?: boolean;
}) {
  const { status } = useBuilderStatus();
  const envManaged = !!status?.envManaged;
  const bgClass = dim ? "" : "bg-accent/30";

  if (connected) {
    return (
      <div className={`rounded-md border border-border px-2.5 py-2 ${bgClass}`}>
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium text-foreground">
            Builder.io
          </div>
          <span className="flex items-center gap-1 text-[10px] text-green-500">
            <IconCheck size={10} />
            Connected
          </span>
        </div>
        {orgName && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{orgName}</p>
        )}
        {envManaged ? (
          <p className="text-[10px] text-muted-foreground mt-1">
            Managed by deployment — applied to all users of this app.
          </p>
        ) : (
          <div className="flex items-center gap-2 mt-2.5">
            {connectUrl && (
              <a
                href={connectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] no-underline text-muted-foreground hover:text-foreground hover:bg-accent/40"
              >
                Reconnect
                <IconExternalLink size={10} />
              </a>
            )}
            <DisconnectBuilderButton />
          </div>
        )}
      </div>
    );
  }

  if (!connectUrl) return null;

  return (
    <a
      href={connectUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-md border border-border px-3 py-3 no-underline bg-gradient-to-br from-teal-500/10 via-transparent to-transparent hover:border-foreground/30 transition-colors`}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
          <BuilderBMark className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] font-semibold text-foreground">
              {label}
            </span>
          </div>
          <p className="text-[10.5px] text-muted-foreground mt-0.5 leading-snug">
            {subtitle}
          </p>
        </div>
        <IconExternalLink
          size={12}
          className="shrink-0 text-muted-foreground mt-0.5"
        />
      </div>
    </a>
  );
}

// ─── Manual setup card ──────────────────────────────────────────────────────

function ManualSetupCard({
  hint,
  docsUrl,
  docsLabel = "Read the docs",
  children,
  dim,
  sourceBadge,
}: {
  hint?: string;
  docsUrl?: string;
  docsLabel?: string;
  children?: React.ReactNode;
  dim?: boolean;
  /** Optional "Connected via X" badge shown in the header row. */
  sourceBadge?: string;
}) {
  return (
    <div
      className={`rounded-md border border-border px-2.5 py-2 ${dim ? "" : "bg-accent/30"}`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-medium text-foreground">
          Set up manually
        </div>
        {sourceBadge ? (
          <span className="flex items-center gap-1 text-[10px] text-green-500">
            <IconCheck size={10} />
            {sourceBadge}
          </span>
        ) : null}
      </div>
      {hint && (
        <p className="text-[10px] text-muted-foreground mb-1.5">{hint}</p>
      )}
      {children}
      {docsUrl && (
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-1.5 rounded border border-border px-2.5 py-1 text-[10px] font-medium no-underline text-muted-foreground hover:text-foreground hover:bg-accent/40"
        >
          {docsLabel}
          <IconExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

// ─── LLM helpers ────────────────────────────────────────────────────────────

function friendlyModelName(model: string): string {
  const claude = model.match(
    /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d{8,})?$/,
  );
  if (claude) {
    const tier = claude[1][0].toUpperCase() + claude[1].slice(1);
    return `${tier} ${claude[2]}.${claude[3]}`;
  }
  if (model.startsWith("gpt-")) return `GPT-${model.slice(4)}`;
  if (/^o\d/.test(model)) return model;
  const gemini = model.match(/^gemini-(.+?)(?:-preview)?$/);
  if (gemini) {
    const parts = gemini[1]
      .split("-")
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(" ");
    return `Gemini ${parts}${model.endsWith("-preview") ? " (preview)" : ""}`;
  }
  return model;
}

type SettingsStatus = {
  engine: string;
  source: "env" | "settings";
  envVar: string | null;
} | null;

function computeSourceBadge(args: {
  settingsConfigured: boolean;
  settingsStatus: SettingsStatus;
  envConfigured: boolean;
  envVar: string | undefined;
  builderConnected: boolean;
}): string | undefined {
  const { settingsConfigured, settingsStatus } = args;
  if (settingsConfigured) {
    if (settingsStatus?.source === "env") {
      return `Connected via ${settingsStatus.envVar ?? args.envVar ?? "env"}`;
    }
    return "Connected via template (server-side)";
  }
  if (args.envConfigured) return `Connected via ${args.envVar ?? "env"}`;
  if (args.builderConnected) return "Connected via Builder";
  return undefined;
}

function latestModelsOnly(models: string[]): string[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    const claude = m.match(/^claude-(opus|sonnet|haiku)-/);
    if (claude) {
      if (seen.has(claude[1])) return false;
      seen.add(claude[1]);
      return true;
    }
    const gemini = m.match(/^gemini-(\d+(?:\.\d+)?)-(.+?)(?:-preview)?$/);
    if (gemini) {
      const family = gemini[2];
      if (seen.has(`gemini-${family}`)) return false;
      seen.add(`gemini-${family}`);
      return true;
    }
    return true;
  });
}

// ─── LLM Section ────────────────────────────────────────────────────────────

interface EngineInfo {
  name: string;
  label: string;
  description: string;
  defaultModel: string;
  supportedModels: string[];
  requiredEnvVars: string[];
}

const PROVIDER_DOCS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  "ai-sdk:anthropic": "https://console.anthropic.com/settings/keys",
  "ai-sdk:openai": "https://platform.openai.com/api-keys",
  "ai-sdk:google": "https://aistudio.google.com/apikey",
  "ai-sdk:openrouter": "https://openrouter.ai/keys",
  "ai-sdk:groq": "https://console.groq.com/keys",
  "ai-sdk:mistral": "https://console.mistral.ai/api-keys/",
  "ai-sdk:cohere": "https://dashboard.cohere.com/api-keys",
};

function LLMSectionInner({
  builderLoading,
  connectUrl,
  connected,
  orgName,
  open,
  onToggle,
}: {
  builderLoading?: boolean;
  connectUrl?: string;
  connected: boolean;
  orgName?: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [envKeys, setEnvKeys] = useState<
    Array<{ key: string; configured: boolean }>
  >([]);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [currentEngine, setCurrentEngine] = useState("anthropic");
  const [currentModel, setCurrentModel] = useState("");
  const [selectedEngine, setSelectedEngine] = useState("anthropic");
  const [selectedModel, setSelectedModel] = useState("");
  const [applyNote, setApplyNote] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    | { ok: true; latencyMs: number; model: string }
    | { ok: false; error: string }
    | null
  >(null);
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [envLoaded, setEnvLoaded] = useState(false);
  const [enginesLoaded, setEnginesLoaded] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const initialLoading =
    !envLoaded || !enginesLoaded || !statusLoaded || !!builderLoading;

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/env-status"))
      .then((r) => (r.ok ? r.json() : []))
      .then(setEnvKeys)
      .catch(() => {})
      .finally(() => setEnvLoaded(true));
  }, [saved]);

  const notifyConfigChanged = useCallback(() => {
    window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
  }, []);

  const refreshSettingsStatus = useCallback(() => {
    fetch(agentNativePath("/_agent-native/agent-engine/status"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (
          data?.configured &&
          typeof data.engine === "string" &&
          (data.source === "env" || data.source === "settings")
        ) {
          setSettingsStatus({
            engine: data.engine,
            source: data.source,
            envVar: typeof data.envVar === "string" ? data.envVar : null,
          });
        } else {
          setSettingsStatus(null);
        }
      })
      .catch(() => {})
      .finally(() => setStatusLoaded(true));
  }, []);

  useEffect(() => {
    refreshSettingsStatus();
  }, [refreshSettingsStatus]);

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/actions/manage-agent-engine"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setEngines(data.engines ?? []);
        const cur = data.current ?? {};
        setCurrentEngine(cur.engine ?? "anthropic");
        setCurrentModel(cur.model ?? "");
        setSelectedEngine(cur.engine ?? "anthropic");
        setSelectedModel(cur.model ?? "");
      })
      .catch(() => {})
      .finally(() => setEnginesLoaded(true));
  }, []);

  const selectedEngineInfo = engines.find((e) => e.name === selectedEngine);
  const envVar = selectedEngineInfo?.requiredEnvVars?.[0];
  const envConfigured = envVar
    ? (envKeys.find((k) => k.key === envVar)?.configured ?? false)
    : false;
  const settingsConfigured =
    settingsStatus != null && settingsStatus.engine === currentEngine;
  const anyKeyConfigured = envConfigured || connected || settingsConfigured;
  const sourceBadge = computeSourceBadge({
    settingsConfigured,
    settingsStatus,
    envConfigured,
    envVar,
    builderConnected: connected,
  });

  const engineChanged =
    selectedEngine !== currentEngine || selectedModel !== currentModel;

  // Hide the Anthropic-via-AI-SDK alias (redundant with the native entry)
  // and Ollama (no API key to set here). The currently-selected engine is
  // always kept so a stale setting doesn't vanish from the picker.
  const providerOptions: SettingsSelectOption[] = engines
    .filter(
      (e) =>
        e.name === selectedEngine ||
        (e.name !== "ai-sdk:anthropic" && e.name !== "ai-sdk:ollama"),
    )
    .map((e) => ({ value: e.name, label: e.label }));

  const modelOptions: SettingsSelectOption[] = latestModelsOnly(
    selectedEngineInfo?.supportedModels ?? [],
  ).map((m) => ({ value: m, label: friendlyModelName(m) }));

  const handleSave = async () => {
    if (!apiKey.trim() || !envVar) return;
    setSaving(true);
    try {
      const res = await fetch(agentNativePath("/_agent-native/env-vars"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vars: [{ key: envVar, value: apiKey.trim() }],
        }),
      });
      if (res.ok) {
        setSaved(true);
        setApiKey("");
        refreshSettingsStatus();
        notifyConfigChanged();
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnectError(null);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/agent-engine/disconnect"),
        {
          method: "POST",
        },
      );
      if (res.ok) {
        setTestResult(null);
        setApplyNote(false);
        refreshSettingsStatus();
        notifyConfigChanged();
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setDisconnectError(
        body?.error ??
          (res.status === 401
            ? "You must be signed in to disconnect."
            : `Disconnect failed (HTTP ${res.status})`),
      );
    } catch (err) {
      setDisconnectError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/actions/manage-agent-engine"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "test",
            engine: selectedEngine,
            model: selectedModel || selectedEngineInfo?.defaultModel,
          }),
        },
      );
      // The action endpoint wraps tool output; some paths return the JSON
      // string as-is, others wrap in { result }. Accept either shape.
      const data = await res.json();
      const parsed =
        typeof data === "string"
          ? JSON.parse(data)
          : typeof data?.result === "string"
            ? JSON.parse(data.result)
            : data;
      if (parsed?.ok) {
        setTestResult({
          ok: true,
          latencyMs: parsed.latencyMs ?? 0,
          model: parsed.model ?? selectedModel,
        });
      } else {
        setTestResult({
          ok: false,
          error: parsed?.error ?? "Test failed (no error message)",
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleApply = async () => {
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/actions/manage-agent-engine"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "set",
            engine: selectedEngine,
            model: selectedModel,
          }),
        },
      );
      if (res.ok) {
        setCurrentEngine(selectedEngine);
        setCurrentModel(selectedModel);
        setApplyNote(true);
        refreshSettingsStatus();
        notifyConfigChanged();
        setTimeout(() => setApplyNote(false), 4000);
      }
    } catch {}
  };

  return (
    <SettingsSection
      icon={<IconBrain size={14} />}
      title="LLM"
      subtitle="Connect any major LLM — Claude, GPT, Gemini, and more."
      required
      connected={initialLoading ? undefined : anyKeyConfigured}
      open={open}
      onToggle={onToggle}
    >
      {initialLoading ? (
        <SettingsSkeleton lines={3} />
      ) : (
        <div className="space-y-2">
          <UseBuilderCard
            connectUrl={connectUrl}
            connected={connected}
            orgName={orgName}
            label="Connect Builder.io"
          />
          {!connected && (
            <ManualSetupCard
              hint="Choose your AI provider and model."
              docsUrl={PROVIDER_DOCS[selectedEngine]}
              sourceBadge={sourceBadge}
              docsLabel="Get an API key"
            >
              <div className="space-y-2 mb-1">
                <SettingsSelect
                  label="Provider"
                  value={selectedEngine}
                  options={providerOptions}
                  onValueChange={(val) => {
                    setSelectedEngine(val);
                    const info = engines.find((e) => e.name === val);
                    setSelectedModel(info?.defaultModel ?? "");
                    setApiKey("");
                  }}
                />

                {/* Free-form input so OpenRouter/Ollama custom model IDs can
                be typed — the registry's supportedModels is only suggestions. */}
                <div className="space-y-1.5">
                  <p className="text-[12px] font-medium text-foreground">
                    Model
                  </p>
                  <input
                    type="text"
                    list={`model-suggestions-${selectedEngine}`}
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    placeholder={
                      selectedEngineInfo?.defaultModel ?? "e.g. model-id"
                    }
                    spellCheck={false}
                    autoComplete="off"
                    className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none transition-colors hover:bg-accent/40 focus:ring-1 focus:ring-accent placeholder:text-muted-foreground/50"
                    style={CONTROL_STYLE}
                  />
                  {modelOptions.length > 0 && (
                    <datalist id={`model-suggestions-${selectedEngine}`}>
                      {modelOptions.map((opt) => (
                        <option
                          key={opt.value}
                          value={opt.value}
                          label={opt.label}
                        />
                      ))}
                    </datalist>
                  )}
                </div>

                {envVar && envConfigured ? (
                  <div className="flex items-center gap-1.5 text-[10px] text-green-500">
                    <IconCheck size={10} />
                    {envVar} configured
                  </div>
                ) : envVar ? (
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSave();
                      }}
                      placeholder={PROVIDER_ENV_PLACEHOLDERS[envVar] ?? "..."}
                      className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                    />
                    <button
                      onClick={handleSave}
                      disabled={!apiKey.trim() || saving}
                      className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
                    >
                      {saving ? (
                        <IconLoader2 size={10} className="animate-spin" />
                      ) : saved ? (
                        <IconCheck size={10} />
                      ) : (
                        "Save"
                      )}
                    </button>
                  </div>
                ) : null}

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="rounded border border-border px-2.5 py-1 text-[10px] font-medium text-foreground hover:bg-accent/40 disabled:opacity-40"
                  >
                    {testing ? (
                      <span className="flex items-center gap-1">
                        <IconLoader2 size={10} className="animate-spin" />
                        Testing…
                      </span>
                    ) : (
                      "Test"
                    )}
                  </button>
                  {engineChanged && (
                    <button
                      onClick={handleApply}
                      className="rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-foreground hover:bg-accent/80"
                    >
                      Apply
                    </button>
                  )}
                  {settingsStatus != null && (
                    <button
                      onClick={handleDisconnect}
                      className="ml-auto rounded border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
                      title="Clear the saved engine — the app will fall back to the default until you re-apply."
                    >
                      Disconnect
                    </button>
                  )}
                </div>
                {testResult && testResult.ok && (
                  <p className="flex items-center gap-1 text-[10px] text-green-500">
                    <IconCheck size={10} />
                    Test passed — {testResult.latencyMs}ms
                  </p>
                )}
                {testResult && testResult.ok === false && (
                  <p className="text-[10px] text-destructive">
                    Test failed: {testResult.error}
                  </p>
                )}
                {disconnectError && (
                  <p className="text-[10px] text-destructive">
                    Disconnect failed: {disconnectError}
                  </p>
                )}
                {applyNote && (
                  <p className="text-[10px] text-muted-foreground">
                    Changes take effect on next conversation
                  </p>
                )}
              </div>
            </ManualSetupCard>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

// ─── Email Section ──────────────────────────────────────────────────────────

function EmailSectionInner({
  open,
  onToggle,
}: {
  open?: boolean;
  onToggle?: () => void;
}) {
  const [envKeys, setEnvKeys] = useState<
    Array<{ key: string; configured: boolean }>
  >([]);
  const [resendKey, setResendKey] = useState("");
  const [sendgridKey, setSendgridKey] = useState("");
  const [fromAddr, setFromAddr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [emailProvider, setEmailProvider] = useState<"resend" | "sendgrid">(
    "resend",
  );
  const [envLoaded, setEnvLoaded] = useState(false);

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/env-status"))
      .then((r) => (r.ok ? r.json() : []))
      .then(setEnvKeys)
      .catch(() => {})
      .finally(() => setEnvLoaded(true));
  }, [saved]);

  const resendConfigured =
    envKeys.find((k) => k.key === "RESEND_API_KEY")?.configured ?? false;
  const sendgridConfigured =
    envKeys.find((k) => k.key === "SENDGRID_API_KEY")?.configured ?? false;
  const fromConfigured =
    envKeys.find((k) => k.key === "EMAIL_FROM")?.configured ?? false;
  const anyConfigured = resendConfigured || sendgridConfigured;

  useEffect(() => {
    if (sendgridConfigured && !resendConfigured) {
      setEmailProvider("sendgrid");
    }
  }, [resendConfigured, sendgridConfigured]);

  const save = async (vars: Array<{ key: string; value: string }>) => {
    setSaving(true);
    try {
      const res = await fetch(agentNativePath("/_agent-native/env-vars"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vars }),
      });
      if (res.ok) {
        setSaved(true);
        setResendKey("");
        setSendgridKey("");
        setFromAddr("");
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveResend = () => {
    const vars: Array<{ key: string; value: string }> = [];
    if (resendKey.trim())
      vars.push({ key: "RESEND_API_KEY", value: resendKey.trim() });
    if (fromAddr.trim())
      vars.push({ key: "EMAIL_FROM", value: fromAddr.trim() });
    if (vars.length) save(vars);
  };

  const saveSendgrid = () => {
    const vars: Array<{ key: string; value: string }> = [];
    if (sendgridKey.trim())
      vars.push({ key: "SENDGRID_API_KEY", value: sendgridKey.trim() });
    if (fromAddr.trim())
      vars.push({ key: "EMAIL_FROM", value: fromAddr.trim() });
    if (vars.length) save(vars);
  };

  return (
    <SettingsSection
      icon={<IconMail size={14} />}
      title="Email"
      subtitle="Send password resets and team invitations. Without a provider, emails are logged to the server console."
      connected={!envLoaded ? undefined : anyConfigured}
      open={open}
      onToggle={onToggle}
    >
      {!envLoaded ? (
        <SettingsSkeleton lines={2} />
      ) : (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Provider
            </span>
            <select
              value={emailProvider}
              onChange={(e) =>
                setEmailProvider(e.target.value as "resend" | "sendgrid")
              }
              className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="resend">Resend</option>
              <option value="sendgrid">SendGrid</option>
            </select>
          </label>

          {emailProvider === "resend" ? (
            <ManualSetupCard
              hint="Use Resend for transactional email."
              docsUrl="https://resend.com/api-keys"
              docsLabel="Get a Resend key"
            >
              {resendConfigured ? (
                <div className="mb-1 flex items-center gap-1.5 text-[10px] text-green-500">
                  <IconCheck size={10} />
                  RESEND_API_KEY configured
                </div>
              ) : (
                <div className="mb-1 flex gap-1.5">
                  <input
                    type="password"
                    value={resendKey}
                    onChange={(e) => setResendKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveResend();
                    }}
                    placeholder="re_..."
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={saveResend}
                    disabled={!resendKey.trim() || saving}
                    className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
                  >
                    {saving ? (
                      <IconLoader2 size={10} className="animate-spin" />
                    ) : saved ? (
                      <IconCheck size={10} />
                    ) : (
                      "Save"
                    )}
                  </button>
                </div>
              )}
              {fromConfigured ? (
                <div className="flex items-center gap-1.5 text-[10px] text-green-500">
                  <IconCheck size={10} />
                  EMAIL_FROM configured
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={fromAddr}
                    onChange={(e) => setFromAddr(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveResend();
                    }}
                    placeholder="From address - e.g. Acme <hi@acme.com>"
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                  />
                  {!resendConfigured ? null : (
                    <button
                      onClick={saveResend}
                      disabled={!fromAddr.trim() || saving}
                      className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
                    >
                      {saving ? (
                        <IconLoader2 size={10} className="animate-spin" />
                      ) : saved ? (
                        <IconCheck size={10} />
                      ) : (
                        "Save"
                      )}
                    </button>
                  )}
                </div>
              )}
            </ManualSetupCard>
          ) : (
            <ManualSetupCard
              hint="Use SendGrid for transactional email. SendGrid requires a verified from address."
              docsUrl="https://app.sendgrid.com/settings/api_keys"
              docsLabel="Get a SendGrid key"
            >
              {sendgridConfigured ? (
                <div className="mb-1 flex items-center gap-1.5 text-[10px] text-green-500">
                  <IconCheck size={10} />
                  SENDGRID_API_KEY configured
                </div>
              ) : (
                <div className="mb-1 flex gap-1.5">
                  <input
                    type="password"
                    value={sendgridKey}
                    onChange={(e) => setSendgridKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveSendgrid();
                    }}
                    placeholder="SG...."
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={saveSendgrid}
                    disabled={!sendgridKey.trim() || saving}
                    className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
                  >
                    {saving ? (
                      <IconLoader2 size={10} className="animate-spin" />
                    ) : saved ? (
                      <IconCheck size={10} />
                    ) : (
                      "Save"
                    )}
                  </button>
                </div>
              )}
              {fromConfigured ? (
                <div className="flex items-center gap-1.5 text-[10px] text-green-500">
                  <IconCheck size={10} />
                  EMAIL_FROM configured
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={fromAddr}
                    onChange={(e) => setFromAddr(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveSendgrid();
                    }}
                    placeholder="From address - e.g. Acme <hi@acme.com>"
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                  />
                  {!sendgridConfigured ? null : (
                    <button
                      onClick={saveSendgrid}
                      disabled={!fromAddr.trim() || saving}
                      className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
                    >
                      {saving ? (
                        <IconLoader2 size={10} className="animate-spin" />
                      ) : saved ? (
                        <IconCheck size={10} />
                      ) : (
                        "Save"
                      )}
                    </button>
                  )}
                </div>
              )}
            </ManualSetupCard>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

// ─── Main SettingsPanel ─────────────────────────────────────────────────────

export interface SettingsPanelProps {
  isDevMode: boolean;
  onToggleDevMode: () => void;
  showDevToggle: boolean;
  devAppUrl?: string;
}

const environmentOptions: SettingsSelectOption[] = [
  {
    value: "production",
    label: "Production",
    description: "Restricted to app tools only.",
  },
  {
    value: "development",
    label: "Development",
    description: "Full access to code editing, shell, and files.",
  },
];

export function SettingsPanel({
  isDevMode,
  onToggleDevMode,
  showDevToggle,
  devAppUrl,
}: SettingsPanelProps) {
  const { status: builder, loading: builderLoading } = useBuilderStatus();
  const connected = builder?.configured ?? false;
  const connectUrl = builder?.connectUrl;
  const orgName = builder?.orgName;

  // Detect whether the app registered any secrets — controls whether the
  // "API Keys & Connections" section renders at all.
  const [focusSecretKey, setFocusSecretKey] = useState<string | undefined>(
    undefined,
  );

  // Accordion: only one section open at a time (null = all closed)
  const [openSection, setOpenSection] = useState<string | null>("llm");
  const toggle = (id: string) =>
    setOpenSection((prev) => (prev === id ? null : id));

  // Support `#secrets:<KEY>` hash fragments from the onboarding CTA — opens
  // the section and focuses the matching input.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHash = () => {
      const hash = window.location.hash?.replace(/^#/, "") ?? "";
      if (hash.startsWith("secrets:") || hash === "secrets") {
        setOpenSection("secrets");
        const key = hash.slice("secrets:".length);
        setFocusSecretKey(key || undefined);
      }
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2"
      style={{ overflowY: "auto" }}
    >
      {/* Environment toggle + dev app link */}
      {(showDevToggle || devAppUrl) && (
        <div className="space-y-2 pb-2 border-b border-border mb-2">
          {showDevToggle && (
            <SettingsSelect
              label="Environment"
              labelAdornment={
                devAppUrl ? (
                  <a
                    href={devAppUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open app in new tab"
                    aria-label="Open app in new tab"
                    className="flex items-center text-muted-foreground hover:text-foreground"
                  >
                    <IconExternalLink size={14} />
                  </a>
                ) : undefined
              }
              value={isDevMode ? "development" : "production"}
              options={environmentOptions}
              onValueChange={(next) => {
                const nextIsDev = next === "development";
                if (nextIsDev !== isDevMode) onToggleDevMode();
              }}
            />
          )}
        </div>
      )}

      {/* LLM */}
      <LLMSectionInner
        builderLoading={builderLoading}
        connectUrl={connectUrl}
        connected={connected}
        orgName={orgName}
        open={openSection === "llm"}
        onToggle={() => toggle("llm")}
      />

      {/* Voice transcription */}
      <SettingsSection
        icon={<IconMicrophone size={14} />}
        title="Voice Transcription"
        subtitle="How the composer microphone turns your voice into text."
        open={openSection === "voice"}
        onToggle={() => toggle("voice")}
      >
        <VoiceTranscriptionSection />
      </SettingsSection>

      {/* Automations */}
      <SettingsSection
        icon={<IconBolt size={14} />}
        title="Automations"
        subtitle="Event-triggered and scheduled automations."
        open={openSection === "automations"}
        onToggle={() => toggle("automations")}
      >
        <AutomationsSection />
      </SettingsSection>

      {/* API Keys & Connections */}
      <SettingsSection
        icon={<IconKey size={14} />}
        title="API Keys & Connections"
        subtitle="Service credentials and automation keys."
        open={openSection === "secrets"}
        onToggle={() => toggle("secrets")}
      >
        <SecretsSection focusKey={focusSecretKey} />
      </SettingsSection>

      {/* Hosting */}
      <SettingsSection
        icon={<IconCloud size={14} />}
        title="Hosting"
        subtitle="Deploy your app to the cloud."
        connected={connected}
        open={openSection === "hosting"}
        onToggle={() => toggle("hosting")}
      >
        <div className="space-y-2">
          <UseBuilderCard
            connectUrl={connectUrl}
            connected={connected}
            orgName={orgName}
          />
          <ManualSetupCard
            hint="Deploy manually to Netlify, Vercel, Cloudflare, or any Nitro-supported target."
            docsUrl="https://www.builder.io/c/docs/agent-native-deployment"
            dim={connected}
          />
        </div>
      </SettingsSection>

      {/* Database */}
      <SettingsSection
        icon={<IconDatabase size={14} />}
        title="Database"
        subtitle="Connect a cloud database for persistent storage."
        connected={connected}
        open={openSection === "database"}
        onToggle={() => toggle("database")}
      >
        <div className="space-y-2">
          <UseBuilderCard
            connectUrl={connectUrl}
            connected={connected}
            orgName={orgName}
          />
          <ManualSetupCard
            hint="Set DATABASE_URL in your .env to connect Neon, Supabase, Turso, or any Postgres/SQLite database."
            docsUrl="https://www.builder.io/c/docs/agent-native-database"
            dim={connected}
          />
        </div>
      </SettingsSection>

      {/* File uploads */}
      <SettingsSection
        icon={<IconUpload size={14} />}
        title="File uploads"
        subtitle="Where user-uploaded files (avatars, chat attachments) are stored."
        connected={connected}
        open={openSection === "uploads"}
        onToggle={() => toggle("uploads")}
      >
        <div className="space-y-2">
          <UseBuilderCard
            connectUrl={connectUrl}
            connected={connected}
            orgName={orgName}
          />
          <ManualSetupCard
            hint="Without a provider, files are stored as base64 in your database. Fine for dev, not recommended for production."
            docsUrl="https://www.builder.io/c/docs/agent-native-file-uploads"
            dim={connected}
          />
        </div>
      </SettingsSection>

      {/* Authentication */}
      <SettingsSection
        icon={<IconShield size={14} />}
        title="Authentication"
        subtitle="Set up user authentication and access control."
        connected={connected}
        open={openSection === "auth"}
        onToggle={() => toggle("auth")}
      >
        <div className="space-y-2">
          <UseBuilderCard
            connectUrl={connectUrl}
            connected={connected}
            orgName={orgName}
          />
          <ManualSetupCard
            hint="Configure Better Auth with BETTER_AUTH_SECRET and optional Google/GitHub OAuth providers."
            docsUrl="https://www.builder.io/c/docs/agent-native-authentication"
            dim={connected}
          />
        </div>
      </SettingsSection>

      {/* Email */}
      <EmailSectionInner
        open={openSection === "email"}
        onToggle={() => toggle("email")}
      />

      {/* Browser Automation */}
      <SettingsSection
        icon={<IconBrowser size={14} />}
        title="Browser Automation"
        subtitle="Let agents control a real browser for web tasks."
        connected={connected}
        open={openSection === "browser"}
        onToggle={() => toggle("browser")}
      >
        <UseBuilderCard
          connectUrl={connectUrl}
          connected={connected}
          orgName={orgName}
        />
      </SettingsSection>

      {/* Background Agent */}
      <SettingsSection
        icon={<IconGitBranch size={14} />}
        title="Background Agent"
        subtitle="Make code changes from production mode via Builder."
        connected={connected}
        open={openSection === "background"}
        onToggle={() => toggle("background")}
      >
        <UseBuilderCard
          connectUrl={connectUrl}
          connected={connected}
          orgName={orgName}
        />
      </SettingsSection>

      {/* Integrations */}
      <SettingsSection
        icon={<IconPlugConnected size={14} />}
        title="Integrations"
        subtitle="Connect messaging platforms and external services."
        open={openSection === "integrations"}
        onToggle={() => toggle("integrations")}
      >
        <Suspense fallback={null}>
          <IntegrationsPanel />
        </Suspense>
      </SettingsSection>

      {/* Usage & spend */}
      <SettingsSection
        icon={<IconCoin size={14} />}
        title="Usage"
        subtitle="Track token consumption and estimated cost — broken down by chat, automations, and background jobs."
        open={openSection === "usage"}
        onToggle={() => toggle("usage")}
      >
        <UsageSection />
      </SettingsSection>

      {/* A2A Agents */}
      <SettingsSection
        icon={<IconTopologyRing2 size={14} />}
        title="Connected Agents (A2A)"
        subtitle="Manage remote agents connected via the A2A protocol."
        open={openSection === "a2a"}
        onToggle={() => toggle("a2a")}
      >
        <AgentsSection />
      </SettingsSection>
    </div>
  );
}
