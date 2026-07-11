import * as SelectPrimitive from "@radix-ui/react-select";
import {
  IconChevronDown,
  IconChevronRight,
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
  IconEyeOff,
  IconBolt,
  IconGauge,
  IconUserCircle,
  IconApps,
  IconUsersGroup,
} from "@tabler/icons-react";
import React, {
  Suspense,
  lazy,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";

import { PROVIDER_ENV_PLACEHOLDERS } from "../../agent/engine/provider-env-vars.js";
import { saveAgentEngineProviderSettings } from "../agent-engine-key.js";
import { agentNativePath } from "../api-path.js";
import { BuilderBMark } from "../builder-mark.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { TeamPage } from "../org/TeamPage.js";
import { callAction } from "../use-action.js";
import { uploadAvatar, useAvatarUrl } from "../use-avatar.js";
import { useDevMode } from "../use-dev-mode.js";
import { useSession } from "../use-session.js";
import { cn } from "../utils.js";
import { AgentsSection } from "./AgentsSection.js";
import { AutomationsSection } from "./AutomationsSection.js";
import { DemoModeSection } from "./DemoModeSection.js";
import { SecretsSection } from "./SecretsSection.js";
import {
  SettingsSection,
  SettingsSurfaceProvider,
  useSettingsSurface,
  type SettingsSurface,
} from "./SettingsSection.js";
import type {
  SettingsSearchEntry,
  SettingsTabItem,
} from "./SettingsTabsPage.js";
import { UsageSection } from "./UsageSection.js";
import {
  type BuilderConnectFlow,
  useBuilderConnectFlow,
  useBuilderStatus,
} from "./useBuilderStatus.js";
import { VoiceTranscriptionSection } from "./VoiceTranscriptionSection.js";

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

const CONTROL_STYLE_PAGE = {
  fontSize: 14,
  lineHeight: 1.2,
} satisfies React.CSSProperties;

// Surface-aware class helpers so section bodies (shared with the compact
// sidebar) read as roomy, shadcn-style forms on the full settings page while
// staying dense in the sidebar.
function fieldLabelClass(isPage: boolean): string {
  return cn("font-medium text-foreground", isPage ? "text-sm" : "text-[12px]");
}

// Secondary label / row-title size (e.g. "This app", provider names).
function subTextClass(isPage: boolean): string {
  return isPage ? "text-sm" : "text-[11px]";
}

// Helper / hint / status note size.
function noteTextClass(isPage: boolean): string {
  return isPage ? "text-xs" : "text-[10px]";
}

function textInputClass(isPage: boolean): string {
  return cn(
    "flex w-full rounded-md border border-border bg-background text-foreground outline-none transition-colors hover:bg-accent/40 focus:ring-1 focus:ring-accent placeholder:text-muted-foreground/50",
    isPage ? "h-10 px-3 text-sm" : "h-9 px-3 text-[12px]",
  );
}

function pillButtonClass(
  isPage: boolean,
  tone: "solid" | "outline" | "ghost" = "outline",
): string {
  const base = cn(
    "inline-flex items-center justify-center gap-1 rounded-md font-medium transition-colors disabled:opacity-40",
    isPage ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-[10px]",
  );
  if (tone === "solid") {
    return cn(base, "bg-accent text-foreground hover:bg-accent/80");
  }
  if (tone === "ghost") {
    return cn(
      base,
      "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
    );
  }
  return cn(base, "border border-border text-foreground hover:bg-accent/40");
}

function SettingsSelect({
  label,
  labelAdornment,
  value,
  options,
  onValueChange,
  disabled = false,
}: {
  label: string;
  labelAdornment?: React.ReactNode;
  value: string;
  options: SettingsSelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const isPage = useSettingsSurface() === "page";
  const controlStyle = isPage ? CONTROL_STYLE_PAGE : CONTROL_STYLE;
  const selected = options.find((option) => option.value === value);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className={fieldLabelClass(isPage)}>{label}</p>
        {labelAdornment}
      </div>
      <SelectPrimitive.Root
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectPrimitive.Trigger
          className={cn(
            "flex w-full items-center justify-between rounded-md border border-border bg-background px-3 text-start text-foreground outline-none transition-colors hover:bg-accent/40 data-[placeholder]:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
            isPage ? "h-10 text-sm" : "h-9 text-[12px]",
          )}
          aria-label={label}
          style={controlStyle}
        >
          <SelectPrimitive.Value>
            {selected?.label ?? value}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon asChild>
            <IconChevronDown size={16} className="text-muted-foreground" />
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
                  className={cn(
                    "relative flex w-full cursor-pointer select-none items-start gap-2 rounded-md px-8 outline-none data-[highlighted]:bg-accent/60 data-[state=checked]:bg-accent/40",
                    isPage ? "py-2.5 text-sm" : "py-2.5 text-[12px]",
                  )}
                  style={controlStyle}
                >
                  <span className="absolute start-2 top-2.5 flex h-4 w-4 items-center justify-center text-muted-foreground">
                    <SelectPrimitive.ItemIndicator>
                      <IconCheck size={14} />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <SelectPrimitive.ItemText>
                      <span className="text-foreground">{option.label}</span>
                    </SelectPrimitive.ItemText>
                    {option.description ? (
                      <span
                        className={cn(
                          "mt-0.5 leading-relaxed text-muted-foreground",
                          isPage ? "text-xs" : "text-[11px]",
                        )}
                      >
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
// Hits /_agent-native/builder/disconnect which removes request-scoped
// Builder credentials from app_secrets. Deployment env credentials are left
// alone and remain as fallback. On success we dispatch
// `agent-engine:configured-changed` so dependent cards refresh inline.
function DisconnectBuilderButton() {
  const { status } = useBuilderStatus();
  const [phase, setPhase] = useState<"idle" | "armed" | "busy">("idle");
  const [err, setErr] = useState<string | null>(null);
  const armedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          body.error ||
            `Failed (${res.status}). Is your dev server up to date?`,
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

  // When only the deploy fallback is active there is nothing request-scoped
  // for this button to remove. The early return MUST come after every hook
  // above to satisfy rules-of-hooks.
  if (status?.credentialSource === "env") return null;

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
  builderFlow,
  connectUrl,
  connected,
  orgName,
  envManaged,
  credentialSource,
  trackingSource = "settings_panel_builder_card",
  trackingFlow = "connect_llm",
  label = "Connect Builder.io",
  subtitle = "Free credits to start — no API key needed.",
  dim,
}: {
  builderFlow: BuilderConnectFlow;
  connectUrl?: string;
  connected: boolean;
  orgName?: string;
  envManaged?: boolean;
  credentialSource?: "user" | "org" | "workspace" | "env";
  trackingSource?: string;
  trackingFlow?: string;
  label?: string;
  subtitle?: string;
  dim?: boolean;
}) {
  const isPage = useSettingsSurface() === "page";
  const effectiveConnected = connected || builderFlow.configured;
  const effectiveOrgName = builderFlow.orgName ?? orgName;
  const bgClass = dim ? "" : "bg-accent/30";
  const titleCls = isPage ? "text-sm" : "text-[11px]";
  const bodyCls = isPage ? "text-xs" : "text-[10px]";

  if (effectiveConnected) {
    return (
      <div
        className={cn(
          "rounded-md border border-border",
          isPage ? "px-3.5 py-3" : "px-2.5 py-2",
          bgClass,
        )}
      >
        <div className="flex items-center justify-between">
          <div className={cn("font-medium text-foreground", titleCls)}>
            Builder.io
          </div>
          <span
            className={cn("flex items-center gap-1 text-green-500", bodyCls)}
          >
            <IconCheck size={isPage ? 14 : 10} />
            Connected
          </span>
        </div>
        {effectiveOrgName && (
          <p className={cn("text-muted-foreground mt-0.5", bodyCls)}>
            {effectiveOrgName}
          </p>
        )}
        {envManaged ? (
          <p className={cn("text-muted-foreground mt-1", bodyCls)}>
            {credentialSource === "env"
              ? "Deployment fallback is available. Connect your own account to override it."
              : "Using your connected Builder account. Deployment fallback is still available."}
          </p>
        ) : null}
        {connectUrl || credentialSource !== "env" ? (
          <div className="flex items-center gap-2 mt-2.5">
            {connectUrl && (
              <button
                type="button"
                onClick={() =>
                  builderFlow.start({ trackingSource, trackingFlow })
                }
                disabled={builderFlow.connecting}
                className={cn(pillButtonClass(isPage, "ghost"), "no-underline")}
              >
                {builderFlow.connecting
                  ? "Connecting..."
                  : credentialSource === "env"
                    ? "Connect account"
                    : "Reconnect"}
                <IconExternalLink size={isPage ? 14 : 10} />
              </button>
            )}
            {credentialSource !== "env" ? <DisconnectBuilderButton /> : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (!connectUrl) return null;

  return (
    <button
      type="button"
      onClick={() => builderFlow.start({ trackingSource, trackingFlow })}
      disabled={builderFlow.connecting}
      className={cn(
        "block w-full rounded-md border border-border text-start no-underline bg-gradient-to-br from-teal-500/10 via-transparent to-transparent hover:border-foreground/30 transition-colors disabled:cursor-wait disabled:opacity-70",
        isPage ? "px-4 py-3.5" : "px-3 py-3",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md bg-foreground text-background",
            isPage ? "h-8 w-8" : "h-7 w-7",
          )}
        >
          <BuilderBMark className={isPage ? "h-4 w-4" : "h-3.5 w-3.5"} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={cn(
                "font-semibold text-foreground",
                isPage ? "text-sm" : "text-[12px]",
              )}
            >
              {builderFlow.connecting ? "Connecting Builder.io..." : label}
            </span>
            {builderFlow.connecting && (
              <IconLoader2
                size={isPage ? 14 : 12}
                className="shrink-0 animate-spin text-muted-foreground"
              />
            )}
          </div>
          <p
            className={cn(
              "text-muted-foreground mt-0.5 leading-snug",
              isPage ? "text-xs" : "text-[10.5px]",
            )}
          >
            {subtitle}
          </p>
          {builderFlow.error && (
            <p className={cn("mt-1 text-destructive", bodyCls)}>
              {builderFlow.error}
            </p>
          )}
        </div>
        <IconExternalLink
          size={isPage ? 14 : 12}
          className="shrink-0 text-muted-foreground mt-0.5"
        />
      </div>
    </button>
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
  const isPage = useSettingsSurface() === "page";
  const titleCls = isPage ? "text-sm" : "text-[11px]";
  const bodyCls = isPage ? "text-xs" : "text-[10px]";
  return (
    <div
      className={cn(
        "rounded-md border border-border",
        isPage ? "px-3.5 py-3" : "px-2.5 py-2",
        dim ? "" : "bg-accent/30",
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <div className={cn("font-medium text-foreground", titleCls)}>
          Set up manually
        </div>
        {sourceBadge ? (
          <span
            className={cn("flex items-center gap-1 text-green-500", bodyCls)}
          >
            <IconCheck size={isPage ? 14 : 10} />
            {sourceBadge}
          </span>
        ) : null}
      </div>
      {hint && (
        <p className={cn("text-muted-foreground mb-1.5", bodyCls)}>{hint}</p>
      )}
      {children}
      {docsUrl && (
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            pillButtonClass(isPage, "outline"),
            "mt-1.5 no-underline",
          )}
        >
          {docsLabel}
          <IconExternalLink size={isPage ? 14 : 10} />
        </a>
      )}
    </div>
  );
}

// ─── LLM helpers ────────────────────────────────────────────────────────────

function friendlyModelName(model: string): string {
  if (model === "z-ai/glm-5.2") return "GLM 5.2";
  const claude = model.match(
    /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?(?:-\d{8,})?$/,
  );
  if (claude) {
    const tier = claude[1][0].toUpperCase() + claude[1].slice(1);
    return `${tier} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  }
  if (model.startsWith("gpt-")) {
    const rest = model.slice(4);
    const gpt = rest.match(/^(\d+)[.-](\d+)(?:[.-](.+))?$/);
    if (gpt) {
      const suffix = gpt[3]
        ? ` ${gpt[3]
            .split("-")
            .map((part) => part[0].toUpperCase() + part.slice(1))
            .join(" ")}`
        : "";
      return `GPT-${gpt[1]}.${gpt[2]}${suffix}`;
    }
    return `GPT-${rest}`;
  }
  if (/^o\d/.test(model)) return model;
  const geminiVersioned = model.match(
    /^gemini-(\d+)-(\d+)-(.+?)(?:-preview)?$/,
  );
  if (geminiVersioned) {
    const variant = geminiVersioned[3]
      .split("-")
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(" ");
    return `Gemini ${geminiVersioned[1]}.${geminiVersioned[2]} ${variant}`;
  }
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
  if (args.builderConnected) return "Connected via Builder";
  if (settingsConfigured) {
    if (settingsStatus?.source === "env") {
      return `Connected via ${settingsStatus.envVar ?? args.envVar ?? "env"}`;
    }
    return "Connected via template (server-side)";
  }
  if (args.envConfigured) return `Connected via ${args.envVar ?? "env"}`;
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

export function AppDefaultModelField({
  engine,
  models,
  value,
  defaultModel,
  disabled,
  onValueChange,
  onEnter,
}: {
  engine: string;
  models: string[];
  value: string;
  defaultModel?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  onEnter?: () => void;
}) {
  const isPage = useSettingsSurface() === "page";
  const modelOptions: SettingsSelectOption[] = latestModelsOnly(models).map(
    (model) => ({ value: model, label: friendlyModelName(model) }),
  );

  // Builder models are a closed catalog (and are validated server-side), so a
  // real select keeps every available model visible even when one is already
  // selected. Native datalists filter against the current input value, which
  // made this field appear to contain only the active model.
  if (engine === "builder" && modelOptions.length > 0) {
    return (
      <SettingsSelect
        label="Model"
        value={value}
        options={modelOptions}
        onValueChange={onValueChange}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <p className={fieldLabelClass(isPage)}>Model</p>
      <input
        type="text"
        list={`app-model-suggestions-${engine}`}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onEnter?.();
        }}
        placeholder={defaultModel ?? "model-id"}
        spellCheck={false}
        autoComplete="off"
        className={cn(textInputClass(isPage), "disabled:opacity-60")}
        style={isPage ? CONTROL_STYLE_PAGE : CONTROL_STYLE}
      />
      {modelOptions.length > 0 && (
        <datalist id={`app-model-suggestions-${engine}`}>
          {modelOptions.map((option) => (
            <option
              key={option.value}
              value={option.value}
              label={option.label}
            />
          ))}
        </datalist>
      )}
    </div>
  );
}

// ─── LLM Section ────────────────────────────────────────────────────────────

interface EngineInfo {
  name: string;
  label: string;
  description: string;
  defaultModel: string;
  supportedModels: string[];
  requiredEnvVars: string[];
  installPackage?: string;
  packageInstalled?: boolean;
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
  builderFlow,
  builderLoading,
  connectUrl,
  connected,
  orgName,
  envManaged,
  credentialSource,
  open,
  onToggle,
}: {
  builderFlow: BuilderConnectFlow;
  builderLoading?: boolean;
  connectUrl?: string;
  connected: boolean;
  orgName?: string;
  envManaged?: boolean;
  credentialSource?: "user" | "org" | "workspace" | "env";
  open?: boolean;
  onToggle?: () => void;
}) {
  const isPage = useSettingsSurface() === "page";
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
  const [baseUrl, setBaseUrl] = useState("");
  const [baseUrlConfigured, setBaseUrlConfigured] = useState(false);
  const [clearBaseUrl, setClearBaseUrl] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
        setBaseUrlConfigured(Boolean(data?.openAiBaseUrlConfigured));
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
    callAction("manage-agent-engine" as any, { action: "list" } as any)
      .then((data) => {
        if (!data) return;
        const engineData = data as {
          engines?: EngineInfo[];
          current?: { engine?: string; model?: string };
        };
        setEngines(engineData.engines ?? []);
        const cur = engineData.current ?? {};
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
  const selectedEnginePackageInstalled =
    selectedEngineInfo?.packageInstalled !== false;
  const envConfigured = envVar
    ? (envKeys.find((k) => k.key === envVar)?.configured ?? false)
    : false;
  const settingsConfigured =
    settingsStatus != null && settingsStatus.engine === currentEngine;
  const builderConnected = connected || builderFlow.configured;
  const anyKeyConfigured =
    builderConnected ||
    (selectedEnginePackageInstalled && (envConfigured || settingsConfigured));
  const sourceBadge = computeSourceBadge({
    settingsConfigured,
    settingsStatus,
    envConfigured,
    envVar,
    builderConnected,
  });
  const manualSetupHint =
    selectedEngine === "ai-sdk:openrouter"
      ? "Provide an OpenRouter key to use OpenRouter models like GLM 5.2."
      : "Choose your AI provider and model.";

  const engineChanged =
    selectedEngine !== currentEngine || selectedModel !== currentModel;
  const isOpenAiEngine = selectedEngine === "ai-sdk:openai";
  const endpointChanged = isOpenAiEngine && (!!baseUrl.trim() || clearBaseUrl);
  const providerSettingsChanged = !!apiKey.trim() || endpointChanged;

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
    if (!providerSettingsChanged || !envVar) return;
    setSaving(true);
    try {
      const nextBaseUrl = isOpenAiEngine ? baseUrl.trim() : "";
      await saveAgentEngineProviderSettings({
        key: envVar,
        ...(apiKey.trim() ? { apiKey } : {}),
        ...(nextBaseUrl ? { baseUrl: nextBaseUrl } : {}),
        ...(isOpenAiEngine && clearBaseUrl ? { clearBaseUrl: true } : {}),
      });
      setSaved(true);
      setApiKey("");
      setBaseUrl("");
      setClearBaseUrl(false);
      if (nextBaseUrl) setBaseUrlConfigured(true);
      if (clearBaseUrl) setBaseUrlConfigured(false);
      refreshSettingsStatus();
      notifyConfigChanged();
      setTimeout(() => setSaved(false), 2000);
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
      const data = await callAction(
        "manage-agent-engine" as any,
        {
          action: "test",
          engine: selectedEngine,
          model: selectedModel || selectedEngineInfo?.defaultModel,
        } as any,
      );
      // Older action paths wrapped tool output in { result }. Accept either
      // shape while the action route normalizes JSON-string script output.
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
      id={settingsSectionDomId("llm")}
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
            builderFlow={builderFlow}
            connectUrl={connectUrl}
            connected={connected}
            orgName={orgName}
            envManaged={envManaged}
            credentialSource={credentialSource}
            trackingSource="llm_settings"
            trackingFlow="connect_llm"
            label="Connect Builder.io"
          />
          {!builderConnected && (
            <ManualSetupCard
              hint={manualSetupHint}
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
                    setBaseUrl("");
                    setClearBaseUrl(false);
                    setAdvancedOpen(false);
                  }}
                />

                {/* Free-form input so OpenRouter/Ollama custom model IDs can
                be typed — the registry's supportedModels is only suggestions. */}
                <div className="space-y-1.5">
                  <p className={fieldLabelClass(isPage)}>Model</p>
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
                    className={textInputClass(isPage)}
                    style={isPage ? CONTROL_STYLE_PAGE : CONTROL_STYLE}
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

                {isOpenAiEngine && (
                  <div className="border-t border-border/70 pt-2">
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((v) => !v)}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-0.5 py-1 text-left hover:text-foreground"
                    >
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-foreground">
                        {advancedOpen ? (
                          <IconChevronDown size={12} />
                        ) : (
                          <IconChevronRight
                            size={12}
                            className="rtl:-scale-x-100"
                          />
                        )}
                        Advanced
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        OpenAI-compatible endpoint
                      </span>
                    </button>

                    {advancedOpen && (
                      <div className="mt-1.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-medium text-foreground">
                            Endpoint URL
                          </p>
                          <span className="text-[10px] text-muted-foreground">
                            {baseUrlConfigured ? "Configured" : "Optional"}
                          </span>
                        </div>
                        <input
                          type="url"
                          value={baseUrl}
                          onChange={(e) => {
                            setBaseUrl(e.target.value);
                            if (e.target.value.trim()) setClearBaseUrl(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSave();
                          }}
                          placeholder={
                            baseUrlConfigured
                              ? "Leave blank to keep current endpoint"
                              : "https://gateway.example/v1"
                          }
                          disabled={clearBaseUrl}
                          spellCheck={false}
                          autoComplete="off"
                          className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none transition-colors hover:bg-accent/40 focus:ring-1 focus:ring-accent disabled:opacity-50 placeholder:text-muted-foreground/50"
                          style={CONTROL_STYLE}
                        />
                        <p className="text-[10px] leading-relaxed text-muted-foreground">
                          Use for LiteLLM or another OpenAI-compatible chat
                          gateway. Leave blank for OpenAI.
                        </p>
                        {baseUrlConfigured && (
                          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={clearBaseUrl}
                              onChange={(e) => {
                                setClearBaseUrl(e.target.checked);
                                if (e.target.checked) setBaseUrl("");
                              }}
                              className="h-3 w-3 accent-current"
                            />
                            Clear saved endpoint override
                          </label>
                        )}
                        {envVar && envConfigured && endpointChanged && (
                          <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
                          >
                            {saving ? (
                              <IconLoader2 size={10} className="animate-spin" />
                            ) : saved ? (
                              <IconCheck size={10} />
                            ) : (
                              "Save endpoint"
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {envVar && envConfigured ? (
                  <div
                    className={cn(
                      "flex items-center gap-1.5 text-green-500",
                      isPage ? "text-xs" : "text-[10px]",
                    )}
                  >
                    <IconCheck size={isPage ? 14 : 10} />
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
                      className={cn(textInputClass(isPage), "flex-1")}
                      style={isPage ? CONTROL_STYLE_PAGE : undefined}
                    />
                    <button
                      onClick={handleSave}
                      disabled={!providerSettingsChanged || saving}
                      className={pillButtonClass(isPage, "solid")}
                    >
                      {saving ? (
                        <IconLoader2
                          size={isPage ? 14 : 10}
                          className="animate-spin"
                        />
                      ) : saved ? (
                        <IconCheck size={isPage ? 14 : 10} />
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
                    className={pillButtonClass(isPage, "outline")}
                  >
                    {testing ? (
                      <span className="flex items-center gap-1">
                        <IconLoader2
                          size={isPage ? 14 : 10}
                          className="animate-spin"
                        />
                        Testing…
                      </span>
                    ) : (
                      "Test"
                    )}
                  </button>
                  {engineChanged && (
                    <button
                      onClick={handleApply}
                      className={pillButtonClass(isPage, "solid")}
                    >
                      Apply
                    </button>
                  )}
                  {settingsStatus != null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={handleDisconnect}
                          className={cn(
                            pillButtonClass(isPage, "outline"),
                            "ms-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40",
                          )}
                        >
                          Disconnect
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        Clear the saved engine — the app will fall back to the
                        default until you re-apply.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                {testResult && testResult.ok && (
                  <p
                    className={cn(
                      "flex items-center gap-1 text-green-500",
                      isPage ? "text-xs" : "text-[10px]",
                    )}
                  >
                    <IconCheck size={isPage ? 14 : 10} />
                    Test passed — {testResult.latencyMs}ms
                  </p>
                )}
                {testResult && testResult.ok === false && (
                  <p
                    className={cn(
                      "text-destructive",
                      isPage ? "text-xs" : "text-[10px]",
                    )}
                  >
                    Test failed: {testResult.error}
                  </p>
                )}
                {disconnectError && (
                  <p
                    className={cn(
                      "text-destructive",
                      isPage ? "text-xs" : "text-[10px]",
                    )}
                  >
                    Disconnect failed: {disconnectError}
                  </p>
                )}
                {applyNote && (
                  <p
                    className={cn(
                      "text-muted-foreground",
                      isPage ? "text-xs" : "text-[10px]",
                    )}
                  >
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

// ─── App Default Model Section ──────────────────────────────────────────────

interface AppModelDefaultEngine extends EngineInfo {
  configured: boolean;
}

interface AppModelDefaultsResponse {
  appId: string;
  engine: string | null;
  model: string | null;
  scope: "org" | "user" | "default";
  source: "org" | "user" | "default";
  canUpdate: boolean;
  orgId?: string | null;
  orgName?: string | null;
  role?: string | null;
  engines: AppModelDefaultEngine[];
}

function friendlyAppName(appId: string): string {
  return appId
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function AppModelDefaultsSectionInner({
  open,
  onToggle,
}: {
  open?: boolean;
  onToggle?: () => void;
}) {
  const isPage = useSettingsSurface() === "page";
  const [settings, setSettings] = useState<AppModelDefaultsResponse | null>(
    null,
  );
  const [selectedEngine, setSelectedEngine] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    fetch(agentNativePath("/_agent-native/agent-model-defaults"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AppModelDefaultsResponse | null) => {
        if (cancelled || !data) return;
        setSettings(data);
        const firstConfigured =
          data.engines.find((engine) => engine.configured) ?? data.engines[0];
        const nextEngine = data.engine ?? firstConfigured?.name ?? "";
        const nextEngineInfo =
          data.engines.find((engine) => engine.name === nextEngine) ??
          firstConfigured;
        setSelectedEngine(nextEngine);
        setSelectedModel(data.model ?? nextEngineInfo?.defaultModel ?? "");
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const selectedEngineInfo =
    settings?.engines.find((engine) => engine.name === selectedEngine) ?? null;
  const engineOptions: SettingsSelectOption[] = (settings?.engines ?? [])
    .filter(
      (engine) =>
        engine.name === selectedEngine ||
        (engine.name !== "ai-sdk:anthropic" && engine.name !== "ai-sdk:ollama"),
    )
    .map((engine) => ({
      value: engine.name,
      label:
        engine.name === "builder"
          ? "Builder.io Gateway"
          : engine.label || engine.name,
      description: engine.configured
        ? "Configured for this workspace"
        : engine.packageInstalled === false
          ? `Install ${engine.installPackage ?? "the provider packages"} to use this provider`
          : "Credentials not detected yet",
    }));
  const hasPendingChange =
    !!settings &&
    settings.canUpdate &&
    !!selectedEngine &&
    !!selectedModel.trim() &&
    (selectedEngine !== settings.engine ||
      selectedModel.trim() !== settings.model);
  const hasAppDefault = settings?.source !== "default";
  const scopeLabel =
    settings?.scope === "org"
      ? settings.orgName
        ? `${settings.orgName} organization`
        : "organization"
      : "your account";

  const notifyChanged = () => {
    window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
  };

  const save = async () => {
    if (!hasPendingChange) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/agent-model-defaults"),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            engine: selectedEngine,
            model: selectedModel.trim(),
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      const next = body as AppModelDefaultsResponse;
      setSettings(next);
      setSelectedEngine(next.engine ?? selectedEngine);
      setSelectedModel(next.model ?? selectedModel.trim());
      setSaved(true);
      notifyChanged();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!settings?.canUpdate || !hasAppDefault) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/agent-model-defaults"),
        { method: "DELETE" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body?.error ?? `Reset failed (${res.status})`);
      const next = body as AppModelDefaultsResponse;
      setSettings(next);
      const fallback = next.engines.find((engine) => engine.configured);
      setSelectedEngine(next.engine ?? fallback?.name ?? selectedEngine);
      setSelectedModel(next.model ?? fallback?.defaultModel ?? selectedModel);
      notifyChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      id={settingsSectionDomId("app-models")}
      icon={<IconApps size={14} />}
      title="App Default Model"
      subtitle="Choose the default model for this app/template when no one-off composer model is selected."
      connected={loading ? undefined : hasAppDefault}
      open={open}
      onToggle={onToggle}
    >
      {loading ? (
        <SettingsSkeleton lines={2} />
      ) : settings ? (
        <div className="space-y-2">
          <div
            className={cn(
              "rounded-md border border-border bg-accent/20",
              isPage ? "px-3.5 py-3" : "px-2.5 py-2",
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p
                  className={cn(
                    "truncate font-medium text-foreground",
                    subTextClass(isPage),
                  )}
                >
                  {friendlyAppName(settings.appId) || "This app"}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-muted-foreground",
                    noteTextClass(isPage),
                  )}
                >
                  {hasAppDefault
                    ? `Applies to ${scopeLabel}.`
                    : "Using the global LLM default."}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full bg-background px-2 py-0.5 font-medium text-muted-foreground",
                  noteTextClass(isPage),
                )}
              >
                {settings.source}
              </span>
            </div>

            <div className="space-y-2">
              <SettingsSelect
                label="Provider"
                value={selectedEngine}
                options={engineOptions}
                onValueChange={(value) => {
                  setSelectedEngine(value);
                  const info = settings.engines.find(
                    (engine) => engine.name === value,
                  );
                  setSelectedModel(info?.defaultModel ?? "");
                  setError(null);
                }}
              />

              <AppDefaultModelField
                engine={selectedEngine}
                models={selectedEngineInfo?.supportedModels ?? []}
                value={selectedModel}
                defaultModel={selectedEngineInfo?.defaultModel}
                disabled={!settings.canUpdate || saving}
                onValueChange={(value) => {
                  setSelectedModel(value);
                  setError(null);
                }}
                onEnter={() => {
                  if (hasPendingChange) void save();
                }}
              />

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={save}
                  disabled={!hasPendingChange || saving}
                  className={pillButtonClass(isPage, "solid")}
                >
                  {saving ? (
                    <IconLoader2
                      size={isPage ? 14 : 10}
                      className="animate-spin"
                    />
                  ) : saved ? (
                    <IconCheck size={isPage ? 14 : 10} />
                  ) : (
                    "Save"
                  )}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  disabled={!settings.canUpdate || !hasAppDefault || saving}
                  className={pillButtonClass(isPage, "outline")}
                >
                  Reset
                </button>
              </div>
            </div>

            {!settings.canUpdate && (
              <p
                className={cn(
                  "mt-2 text-muted-foreground",
                  noteTextClass(isPage),
                )}
              >
                Only organization owners and admins can change app model
                defaults.
              </p>
            )}
            {selectedEngineInfo?.packageInstalled === false ? (
              <p
                className={cn(
                  "mt-2 text-muted-foreground",
                  noteTextClass(isPage),
                )}
              >
                This app does not include the optional runtime packages for this
                provider.
              </p>
            ) : selectedEngineInfo && !selectedEngineInfo.configured ? (
              <p
                className={cn(
                  "mt-2 text-muted-foreground",
                  noteTextClass(isPage),
                )}
              >
                Credentials for this provider were not detected; runtime will
                fall back if the model cannot be used.
              </p>
            ) : null}
            {error && (
              <p className={cn("mt-2 text-destructive", noteTextClass(isPage))}>
                {error}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className={cn("text-muted-foreground", noteTextClass(isPage))}>
          App model defaults are unavailable.
        </p>
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
  const isPage = useSettingsSurface() === "page";
  const emailInputCls = cn(textInputClass(isPage), "flex-1");
  const emailBtnCls = pillButtonClass(isPage, "solid");
  const emailIconSize = isPage ? 14 : 10;
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
      id={settingsSectionDomId("email")}
      icon={<IconMail size={14} />}
      title="Email"
      subtitle="Needed before deploy for password resets, team invitations, share notifications, and dashboard email reports. Local development can run without it."
      connected={!envLoaded ? undefined : anyConfigured}
      open={open}
      onToggle={onToggle}
    >
      {!envLoaded ? (
        <SettingsSkeleton lines={2} />
      ) : (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span
              className={cn(
                "uppercase tracking-wide text-muted-foreground",
                noteTextClass(isPage),
              )}
            >
              Provider
            </span>
            <select
              value={emailProvider}
              onChange={(e) =>
                setEmailProvider(e.target.value as "resend" | "sendgrid")
              }
              className={cn(textInputClass(isPage), "w-full")}
              style={isPage ? CONTROL_STYLE_PAGE : undefined}
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
                <div
                  className={cn(
                    "mb-1 flex items-center gap-1.5 text-green-500",
                    noteTextClass(isPage),
                  )}
                >
                  <IconCheck size={emailIconSize} />
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
                    className={emailInputCls}
                  />
                  <button
                    onClick={saveResend}
                    disabled={!resendKey.trim() || saving}
                    className={emailBtnCls}
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
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-green-500",
                    noteTextClass(isPage),
                  )}
                >
                  <IconCheck size={emailIconSize} />
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
                    className={emailInputCls}
                  />
                  {!resendConfigured ? null : (
                    <button
                      onClick={saveResend}
                      disabled={!fromAddr.trim() || saving}
                      className={emailBtnCls}
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
                <div
                  className={cn(
                    "mb-1 flex items-center gap-1.5 text-green-500",
                    noteTextClass(isPage),
                  )}
                >
                  <IconCheck size={emailIconSize} />
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
                    className={emailInputCls}
                  />
                  <button
                    onClick={saveSendgrid}
                    disabled={!sendgridKey.trim() || saving}
                    className={emailBtnCls}
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
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-green-500",
                    noteTextClass(isPage),
                  )}
                >
                  <IconCheck size={emailIconSize} />
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
                    className={emailInputCls}
                  />
                  {!sendgridConfigured ? null : (
                    <button
                      onClick={saveSendgrid}
                      disabled={!fromAddr.trim() || saving}
                      className={emailBtnCls}
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

// ─── Agent Limits Section ──────────────────────────────────────────────────

interface AgentLoopSettingsResponse {
  maxIterations: number;
  defaultMaxIterations: number;
  minMaxIterations: number;
  maxMaxIterations: number;
  scope: "org" | "user" | "default";
  source: "org" | "user" | "env" | "default";
  canUpdate: boolean;
  orgName?: string | null;
  role?: string | null;
}

function AgentLimitsSectionInner({
  open,
  onToggle,
}: {
  open?: boolean;
  onToggle?: () => void;
}) {
  const isPage = useSettingsSurface() === "page";
  const [settings, setSettings] = useState<AgentLoopSettingsResponse | null>(
    null,
  );
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    fetch(agentNativePath("/_agent-native/agent-loop-settings"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AgentLoopSettingsResponse | null) => {
        if (cancelled || !data) return;
        setSettings(data);
        setValue(String(data.maxIterations));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | AgentLoopSettingsResponse
        | undefined;
      if (!detail?.maxIterations) return;
      setSettings(detail);
      setValue(String(detail.maxIterations));
    };
    window.addEventListener("agent-loop-settings:changed", handler);
    return () =>
      window.removeEventListener("agent-loop-settings:changed", handler);
  }, []);

  const numericValue = Number(value);
  const hasPendingChange =
    !!settings &&
    settings.canUpdate &&
    Number.isInteger(numericValue) &&
    numericValue !== settings.maxIterations;
  const scopeLabel =
    settings?.scope === "org"
      ? settings.orgName
        ? `${settings.orgName} organization`
        : "organization"
      : "your account";

  const save = async () => {
    if (!settings?.canUpdate) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/agent-loop-settings"),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maxIterations: numericValue }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      setSettings(body as AgentLoopSettingsResponse);
      setValue(String((body as AgentLoopSettingsResponse).maxIterations));
      setSaved(true);
      window.dispatchEvent(
        new CustomEvent("agent-loop-settings:changed", { detail: body }),
      );
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!settings?.canUpdate) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/agent-loop-settings"),
        { method: "DELETE" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? `Reset failed (${res.status})`);
      }
      setSettings(body as AgentLoopSettingsResponse);
      setValue(String((body as AgentLoopSettingsResponse).maxIterations));
      window.dispatchEvent(
        new CustomEvent("agent-loop-settings:changed", { detail: body }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      id={settingsSectionDomId("limits")}
      icon={<IconGauge size={14} />}
      title="Agent Limits"
      subtitle="Control how long a single agent response can work before pausing."
      connected={
        loading
          ? undefined
          : settings
            ? settings.maxIterations !== settings.defaultMaxIterations
            : false
      }
      open={open}
      onToggle={onToggle}
    >
      {loading ? (
        <SettingsSkeleton lines={2} />
      ) : settings ? (
        <div className="space-y-2">
          <div
            className={cn(
              "rounded-md border border-border bg-accent/20",
              isPage ? "px-3.5 py-3" : "px-2.5 py-2",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p
                  className={cn(
                    "font-medium text-foreground",
                    subTextClass(isPage),
                  )}
                >
                  Max iterations
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-muted-foreground",
                    noteTextClass(isPage),
                  )}
                >
                  Applies to {scopeLabel}. Default is{" "}
                  {settings.defaultMaxIterations.toLocaleString()}.
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full bg-background px-2 py-0.5 font-medium text-muted-foreground",
                  noteTextClass(isPage),
                )}
              >
                {settings.source}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <input
                type="number"
                min={settings.minMaxIterations}
                max={settings.maxMaxIterations}
                value={value}
                disabled={!settings.canUpdate || saving}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && hasPendingChange) void save();
                }}
                className={cn(
                  textInputClass(isPage),
                  "min-w-0 flex-1 disabled:opacity-60",
                )}
                style={isPage ? CONTROL_STYLE_PAGE : undefined}
              />
              <button
                type="button"
                onClick={save}
                disabled={!hasPendingChange || saving}
                className={pillButtonClass(isPage, "solid")}
              >
                {saving ? (
                  <IconLoader2
                    size={isPage ? 14 : 10}
                    className="animate-spin"
                  />
                ) : saved ? (
                  <IconCheck size={isPage ? 14 : 10} />
                ) : (
                  "Save"
                )}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={
                  !settings.canUpdate ||
                  saving ||
                  settings.maxIterations === settings.defaultMaxIterations
                }
                className={pillButtonClass(isPage, "outline")}
              >
                Reset
              </button>
            </div>
            {!settings.canUpdate && (
              <p
                className={cn(
                  "mt-2 text-muted-foreground",
                  noteTextClass(isPage),
                )}
              >
                Only organization owners and admins can change this limit.
              </p>
            )}
            {error && (
              <p className={cn("mt-2 text-destructive", noteTextClass(isPage))}>
                {error}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className={cn("text-muted-foreground", noteTextClass(isPage))}>
          Agent limit settings are unavailable.
        </p>
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
  initialSection?: string | null;
  sectionRequestKey?: number;
}

type SettingsSectionId =
  | "account"
  | "llm"
  | "app-models"
  | "limits"
  | "voice"
  | "demo-mode"
  | "automations"
  | "secrets"
  | "hosting"
  | "database"
  | "uploads"
  | "auth"
  | "email"
  | "browser"
  | "background"
  | "integrations"
  | "usage"
  | "a2a";

const SETTINGS_SECTION_IDS = new Set<SettingsSectionId>([
  "account",
  "llm",
  "app-models",
  "limits",
  "voice",
  "demo-mode",
  "automations",
  "secrets",
  "hosting",
  "database",
  "uploads",
  "auth",
  "email",
  "browser",
  "background",
  "integrations",
  "usage",
  "a2a",
]);

const ALL_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "account",
  "llm",
  "app-models",
  "limits",
  "voice",
  "demo-mode",
  "automations",
  "secrets",
  "hosting",
  "database",
  "uploads",
  "auth",
  "email",
  "browser",
  "background",
  "integrations",
  "usage",
  "a2a",
];

const AGENT_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "llm",
  "app-models",
  "limits",
  "voice",
  "automations",
  "background",
  "a2a",
];

const CONNECTION_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "secrets",
  "integrations",
  "email",
  "browser",
  "usage",
];

const WORKSPACE_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "account",
  "demo-mode",
  "hosting",
  "database",
  "uploads",
  "auth",
];

// Search metadata for each section so settings search can deep-link straight
// to a section from any tab. Labels mirror the section headers; keywords add
// synonyms and provider names the header doesn't spell out.
const SETTINGS_SECTION_SEARCH_META: Record<
  SettingsSectionId,
  { label: string; keywords: string; description?: string }
> = {
  account: {
    label: "Account",
    keywords: "profile photo avatar identity signed in email name",
  },
  llm: {
    label: "LLM",
    keywords:
      "model claude gpt openai anthropic gemini api key provider ai engine llm",
  },
  "app-models": {
    label: "App Default Model",
    keywords: "default model provider app template composer",
  },
  limits: {
    label: "Agent Limits",
    keywords: "max iterations budget loop timeout runtime",
  },
  voice: {
    label: "Voice Transcription",
    keywords: "microphone dictation speech to text whisper",
  },
  "demo-mode": {
    label: "Demo mode",
    keywords: "fake data anonymize redact screenshot privacy mask",
  },
  automations: {
    label: "Automations",
    keywords: "triggers scheduled events cron jobs",
  },
  secrets: {
    label: "API Keys & Connections",
    keywords: "secrets credentials tokens api keys environment variables",
  },
  hosting: {
    label: "Hosting",
    keywords: "deploy netlify vercel cloudflare builder nitro",
  },
  database: {
    label: "Database",
    keywords: "postgres sqlite neon supabase turso storage sql pglite",
  },
  uploads: {
    label: "File uploads",
    keywords: "files storage s3 avatars attachments bucket blob",
  },
  auth: {
    label: "Authentication",
    keywords: "login signup oauth google github better auth access sso",
  },
  email: {
    label: "Email",
    keywords: "resend sendgrid smtp transactional notifications reports",
  },
  browser: {
    label: "Browser Automation",
    keywords: "web scraping playwright chrome headless",
  },
  background: {
    label: "Background Agent",
    keywords: "code changes branches builder production async",
  },
  integrations: {
    label: "Integrations",
    keywords: "slack telegram whatsapp discord messaging connect",
  },
  usage: {
    label: "Usage",
    keywords: "tokens cost spend billing consumption",
  },
  a2a: {
    label: "Connected Agents (A2A)",
    keywords: "remote agents protocol a2a connected",
  },
};

function buildSectionSearchEntries(
  sections: readonly SettingsSectionId[],
): SettingsSearchEntry[] {
  return sections.map((section) => {
    const meta = SETTINGS_SECTION_SEARCH_META[section];
    return {
      id: `section:${section}`,
      label: meta.label,
      keywords: meta.keywords,
      description: meta.description,
      hash: section,
    };
  });
}

function normalizeSettingsSection(
  value?: string | null,
): SettingsSectionId | null {
  const normalized = value?.replace(/^#/, "").toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized.startsWith("secrets")) return "secrets";
  if (
    normalized === "workspace" ||
    normalized === "workspace-settings" ||
    normalized === "organization" ||
    normalized === "org"
  ) {
    return "secrets";
  }
  if (normalized === "agent-engine") return "llm";
  if (
    normalized === "agent-model-defaults" ||
    normalized === "app-model-defaults" ||
    normalized === "models"
  ) {
    return "app-models";
  }
  if (normalized === "agent-limits" || normalized === "loop-settings") {
    return "limits";
  }
  return SETTINGS_SECTION_IDS.has(normalized as SettingsSectionId)
    ? (normalized as SettingsSectionId)
    : null;
}

function settingsSectionDomId(section: SettingsSectionId): string {
  return `agent-settings-section-${section}`;
}

function initialOpenSection(): SettingsSectionId {
  if (typeof window === "undefined") return "llm";
  return normalizeSettingsSection(window.location.hash) ?? "llm";
}

function firstVisibleSection(
  sections: readonly SettingsSectionId[],
): SettingsSectionId {
  return sections[0] ?? "llm";
}

// Agent capability modes. The internal values ("production"/"development") are
// kept for back-compat with the AGENT_MODE wiring; only the visible labels
// changed to "App mode" / "Code mode" so this control reads as the agent
// capability it is — not the deployment environment (NODE_ENV).
const agentModeOptions: SettingsSelectOption[] = [
  {
    value: "production",
    label: "App mode",
    description:
      "App tools only; code, bash, and files require Builder or a local clone.",
  },
  {
    value: "development",
    label: "Code mode",
    description: "Full access to code editing, bash, and files.",
  },
];

function CapabilityStatusRow({
  label,
  value,
  active,
}: {
  label: string;
  value: React.ReactNode;
  active: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[10px]">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span
          className={`h-1.5 w-1.5 rounded-full ${active ? "bg-green-500" : "bg-muted-foreground/30"}`}
          aria-hidden="true"
        />
        {label}
      </span>
      <span className="min-w-0 truncate text-end text-foreground">{value}</span>
    </div>
  );
}

function CapabilityStatusStrip({
  isDevMode,
  builderConnected,
  builderLoading,
  builderBranchesAvailable,
  onOpenLlm,
}: {
  isDevMode: boolean;
  builderConnected: boolean;
  builderLoading: boolean;
  builderBranchesAvailable: boolean;
  onOpenLlm: () => void;
}) {
  const codeAvailable =
    isDevMode || (builderConnected && builderBranchesAvailable);
  const codeLabel = isDevMode
    ? "Local tools"
    : builderConnected && builderBranchesAvailable
      ? "Builder branches"
      : "Desktop/local";

  return (
    <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2">
      <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">
        Available now
      </div>
      <div className="space-y-1.5">
        <CapabilityStatusRow label="App" value="Chat + actions" active />
        <CapabilityStatusRow
          label="Code"
          value={codeLabel}
          active={codeAvailable}
        />
        <CapabilityStatusRow
          label="Builder"
          active={builderConnected}
          value={
            builderLoading ? (
              "Checking..."
            ) : builderConnected ? (
              "Connected"
            ) : (
              <button
                type="button"
                onClick={onOpenLlm}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                Connect
              </button>
            )
          }
        />
      </div>
    </div>
  );
}

function AccountSectionInner({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const isPage = useSettingsSurface() === "page";
  const { session, isLoading } = useSession();
  const email = session?.email;
  const avatarUrl = useAvatarUrl(email);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  const displayName = session?.name || email || "Signed out";
  const initials = (session?.name || email || "?")
    .split(/[ @._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  const handleAvatarChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !email) return;
    setUploading(true);
    setStatus("idle");
    try {
      await uploadAvatar(file, email);
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <SettingsSection
      id={settingsSectionDomId("account")}
      icon={<IconUserCircle size={14} />}
      title="Account"
      subtitle="Your profile photo and signed-in identity."
      open={open}
      onToggle={onToggle}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-accent font-semibold text-muted-foreground",
            isPage ? "h-14 w-14 text-[15px]" : "h-12 w-12 text-[13px]",
          )}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate font-medium text-foreground",
              isPage ? "text-sm" : "text-[12px]",
            )}
          >
            {isLoading ? "Loading..." : displayName}
          </p>
          {email && (
            <p
              className={cn(
                "truncate text-muted-foreground",
                subTextClass(isPage),
              )}
            >
              {email}
            </p>
          )}
          {status === "saved" && (
            <p
              className={cn(
                "mt-1 text-green-600 dark:text-green-400",
                subTextClass(isPage),
              )}
            >
              Photo updated
            </p>
          )}
          {status === "error" && (
            <p className={cn("mt-1 text-destructive", subTextClass(isPage))}>
              Could not update photo
            </p>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarChange}
        />
        <button
          type="button"
          disabled={!email || uploading}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            pillButtonClass(isPage, "outline"),
            "shrink-0 justify-center",
          )}
        >
          {uploading ? "Uploading..." : "Change photo"}
        </button>
      </div>
    </SettingsSection>
  );
}

interface SettingsPanelContentProps extends SettingsPanelProps {
  sections?: readonly SettingsSectionId[];
  showCapabilityStrip?: boolean;
  className?: string;
  surface?: SettingsSurface;
}

function SettingsPanelContent({
  isDevMode,
  onToggleDevMode,
  showDevToggle,
  devAppUrl,
  initialSection,
  sectionRequestKey,
  sections = ALL_SETTINGS_SECTIONS,
  showCapabilityStrip = true,
  className,
  surface = "sidebar",
}: SettingsPanelContentProps) {
  const { status: builder, loading: builderLoading } = useBuilderStatus();
  const connected = builder?.configured ?? false;
  const connectUrl = builder?.cliAuthUrl ?? builder?.connectUrl;
  const orgName = builder?.orgName;
  const envManaged = !!builder?.envManaged;
  const credentialSource = builder?.credentialSource;
  const builderBranchesAvailable = !!builder?.builderEnabled;
  const builderFlow = useBuilderConnectFlow({
    popupUrl: connectUrl,
    trackingSource: "settings_panel_builder_card",
  });

  // When opened via a `#secrets:<KEY>` hash, focus that specific secret input
  // inside the "API Keys & Connections" section.
  const [focusSecretKey, setFocusSecretKey] = useState<string | undefined>(
    undefined,
  );
  const visibleSections = useMemo(() => new Set(sections), [sections]);
  const shouldShowSection = useCallback(
    (section: SettingsSectionId) => visibleSections.has(section),
    [visibleSections],
  );

  // Accordion: only one section open at a time (null = all closed)
  const [openSection, setOpenSection] = useState<string | null>(() => {
    const initial = initialOpenSection();
    return visibleSections.has(initial)
      ? initial
      : firstVisibleSection(sections);
  });
  const toggle = (id: string) =>
    setOpenSection((prev) => (prev === id ? null : id));

  const scrollSectionIntoView = useCallback((section: SettingsSectionId) => {
    window.requestAnimationFrame(() => {
      document.getElementById(settingsSectionDomId(section))?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }, []);

  const openSettingsSection = useCallback(
    (section: SettingsSectionId, scroll = false) => {
      setOpenSection(section);
      if (scroll) scrollSectionIntoView(section);
    },
    [scrollSectionIntoView],
  );

  useEffect(() => {
    const section = normalizeSettingsSection(initialSection);
    if (!section || !shouldShowSection(section)) return;
    if (section !== "secrets") setFocusSecretKey(undefined);
    openSettingsSection(section, true);
  }, [
    initialSection,
    sectionRequestKey,
    openSettingsSection,
    shouldShowSection,
  ]);

  // Support `#secrets:<KEY>` hash fragments from the onboarding CTA — opens
  // the section and focuses the matching input.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHash = () => {
      const hash = window.location.hash?.replace(/^#/, "") ?? "";
      const section = normalizeSettingsSection(hash);
      if (!section || !shouldShowSection(section)) return;
      if (hash.startsWith("secrets:") || hash === "secrets") {
        const key = hash.slice("secrets:".length);
        setFocusSecretKey(key || undefined);
      } else {
        setFocusSecretKey(undefined);
      }
      openSettingsSection(section, true);
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, [openSettingsSection, shouldShowSection]);

  const isPage = surface === "page";

  return (
    <SettingsSurfaceProvider surface={surface}>
      <div
        className={cn(
          isPage ? "space-y-3" : "flex-1 min-h-0 overflow-y-auto p-3 space-y-2",
          className,
        )}
        style={isPage ? undefined : { overflowY: "auto" }}
      >
        {/* Agent capability mode (App vs Code) + app link */}
        {(showDevToggle || devAppUrl) && (
          <div className="space-y-2 pb-2 border-b border-border mb-2">
            {showDevToggle && (
              <SettingsSelect
                label="Agent mode"
                labelAdornment={
                  devAppUrl ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={devAppUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open app in new tab"
                          className="flex items-center text-muted-foreground hover:text-foreground"
                        >
                          <IconExternalLink size={14} />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent>Open app in new tab</TooltipContent>
                    </Tooltip>
                  ) : undefined
                }
                value={isDevMode ? "development" : "production"}
                options={agentModeOptions}
                onValueChange={(next) => {
                  const nextIsDev = next === "development";
                  if (nextIsDev !== isDevMode) onToggleDevMode();
                }}
              />
            )}
          </div>
        )}

        {showCapabilityStrip && (
          <CapabilityStatusStrip
            isDevMode={isDevMode}
            builderConnected={connected}
            builderLoading={builderLoading}
            builderBranchesAvailable={builderBranchesAvailable}
            onOpenLlm={() => openSettingsSection("llm", true)}
          />
        )}

        {/* Account */}
        {shouldShowSection("account") && (
          <AccountSectionInner
            open={openSection === "account"}
            onToggle={() => toggle("account")}
          />
        )}

        {/* LLM */}
        {shouldShowSection("llm") && (
          <LLMSectionInner
            builderFlow={builderFlow}
            builderLoading={builderLoading}
            connectUrl={connectUrl}
            connected={connected}
            orgName={orgName}
            envManaged={envManaged}
            credentialSource={credentialSource}
            open={openSection === "llm"}
            onToggle={() => toggle("llm")}
          />
        )}

        {/* App default model */}
        {shouldShowSection("app-models") && (
          <AppModelDefaultsSectionInner
            open={openSection === "app-models"}
            onToggle={() => toggle("app-models")}
          />
        )}

        {/* Agent limits */}
        {shouldShowSection("limits") && (
          <AgentLimitsSectionInner
            open={openSection === "limits"}
            onToggle={() => toggle("limits")}
          />
        )}

        {/* Voice transcription */}
        {shouldShowSection("voice") && (
          <SettingsSection
            id={settingsSectionDomId("voice")}
            icon={<IconMicrophone size={14} />}
            title="Voice Transcription"
            subtitle="How the composer microphone turns your voice into text."
            open={openSection === "voice"}
            onToggle={() => toggle("voice")}
          >
            <VoiceTranscriptionSection />
          </SettingsSection>
        )}

        {/* Demo mode */}
        {shouldShowSection("demo-mode") && (
          <SettingsSection
            id={settingsSectionDomId("demo-mode")}
            icon={<IconEyeOff size={14} />}
            title="Demo mode"
            subtitle="Replace contact/free-text names, emails, and numbers with realistic fake data everywhere — in the UI and what the agent sees. Labels, IDs, and structure are preserved so the app keeps working."
            open={openSection === "demo-mode"}
            onToggle={() => toggle("demo-mode")}
          >
            <DemoModeSection />
          </SettingsSection>
        )}

        {/* Automations */}
        {shouldShowSection("automations") && (
          <SettingsSection
            id={settingsSectionDomId("automations")}
            icon={<IconBolt size={14} />}
            title="Automations"
            subtitle="Event-triggered and scheduled automations."
            open={openSection === "automations"}
            onToggle={() => toggle("automations")}
          >
            <AutomationsSection />
          </SettingsSection>
        )}

        {/* API Keys & Connections */}
        {shouldShowSection("secrets") && (
          <SettingsSection
            id={settingsSectionDomId("secrets")}
            icon={<IconKey size={14} />}
            title="API Keys & Connections"
            subtitle="Service credentials and automation keys."
            open={openSection === "secrets"}
            onToggle={() => toggle("secrets")}
          >
            <SecretsSection focusKey={focusSecretKey} />
          </SettingsSection>
        )}

        {/* Hosting */}
        {shouldShowSection("hosting") && (
          <SettingsSection
            id={settingsSectionDomId("hosting")}
            icon={<IconCloud size={14} />}
            title="Hosting"
            subtitle="Deploy your app to the cloud."
            connected={connected}
            open={openSection === "hosting"}
            onToggle={() => toggle("hosting")}
          >
            <div className="space-y-2">
              <UseBuilderCard
                builderFlow={builderFlow}
                connectUrl={connectUrl}
                connected={connected}
                orgName={orgName}
                envManaged={envManaged}
                credentialSource={credentialSource}
                trackingSource="hosting_settings"
                trackingFlow="hosting"
              />
              <ManualSetupCard
                hint="Deploy manually to Netlify, Vercel, Cloudflare, or any Nitro-supported target."
                docsUrl="https://www.builder.io/c/docs/agent-native-deployment"
                dim={connected}
              />
            </div>
          </SettingsSection>
        )}

        {/* Database */}
        {shouldShowSection("database") && (
          <SettingsSection
            id={settingsSectionDomId("database")}
            icon={<IconDatabase size={14} />}
            title="Database"
            subtitle="Connect a cloud database for persistent storage."
            connected={connected}
            open={openSection === "database"}
            onToggle={() => toggle("database")}
          >
            <div className="space-y-2">
              <UseBuilderCard
                builderFlow={builderFlow}
                connectUrl={connectUrl}
                connected={connected}
                orgName={orgName}
                envManaged={envManaged}
                credentialSource={credentialSource}
                trackingSource="database_settings"
                trackingFlow="database"
              />
              <ManualSetupCard
                hint="Set DATABASE_URL in your .env to connect Neon, Supabase, Turso, any Postgres/SQLite database, or local PGlite with pglite:./data/pglite."
                docsUrl="https://www.builder.io/c/docs/agent-native-database"
                dim={connected}
              />
            </div>
          </SettingsSection>
        )}

        {/* File uploads */}
        {shouldShowSection("uploads") && (
          <SettingsSection
            id={settingsSectionDomId("uploads")}
            icon={<IconUpload size={14} />}
            title="File uploads"
            subtitle="Where user-uploaded files (avatars, chat attachments) are stored."
            connected={connected}
            open={openSection === "uploads"}
            onToggle={() => toggle("uploads")}
          >
            <div className="space-y-2">
              <UseBuilderCard
                builderFlow={builderFlow}
                connectUrl={connectUrl}
                connected={connected}
                orgName={orgName}
                envManaged={envManaged}
                credentialSource={credentialSource}
                trackingSource="file_upload_settings"
                trackingFlow="file_upload"
              />
              <ManualSetupCard
                hint="Without a provider, files are stored as base64 in your database. Fine for dev, not recommended for production."
                docsUrl="https://www.builder.io/c/docs/agent-native-file-uploads"
                dim={connected}
              />
            </div>
          </SettingsSection>
        )}

        {/* Authentication */}
        {shouldShowSection("auth") && (
          <SettingsSection
            id={settingsSectionDomId("auth")}
            icon={<IconShield size={14} />}
            title="Authentication"
            subtitle="Set up user authentication and access control."
            connected={connected}
            open={openSection === "auth"}
            onToggle={() => toggle("auth")}
          >
            <div className="space-y-2">
              <UseBuilderCard
                builderFlow={builderFlow}
                connectUrl={connectUrl}
                connected={connected}
                orgName={orgName}
                envManaged={envManaged}
                credentialSource={credentialSource}
                trackingSource="auth_settings"
                trackingFlow="auth"
              />
              <ManualSetupCard
                hint="Configure Better Auth with BETTER_AUTH_SECRET and optional Google/GitHub OAuth providers."
                docsUrl="https://www.builder.io/c/docs/agent-native-authentication"
                dim={connected}
              />
            </div>
          </SettingsSection>
        )}

        {/* Email */}
        {shouldShowSection("email") && (
          <EmailSectionInner
            open={openSection === "email"}
            onToggle={() => toggle("email")}
          />
        )}

        {/* Browser Automation */}
        {shouldShowSection("browser") && (
          <SettingsSection
            id={settingsSectionDomId("browser")}
            icon={<IconBrowser size={14} />}
            title="Browser Automation"
            subtitle="Let agents control a real browser for web tasks."
            connected={connected}
            open={openSection === "browser"}
            onToggle={() => toggle("browser")}
          >
            <UseBuilderCard
              builderFlow={builderFlow}
              connectUrl={connectUrl}
              connected={connected}
              orgName={orgName}
              envManaged={envManaged}
              credentialSource={credentialSource}
              trackingSource="browser_settings"
              trackingFlow="browser_automation"
            />
          </SettingsSection>
        )}

        {builderBranchesAvailable && shouldShowSection("background") && (
          <SettingsSection
            id={settingsSectionDomId("background")}
            icon={<IconGitBranch size={14} />}
            title="Background Agent"
            subtitle="Make code changes from production mode via Builder."
            connected={connected}
            open={openSection === "background"}
            onToggle={() => toggle("background")}
          >
            <UseBuilderCard
              builderFlow={builderFlow}
              connectUrl={connectUrl}
              connected={connected}
              orgName={orgName}
              envManaged={envManaged}
              credentialSource={credentialSource}
              trackingSource="background_agent_settings"
              trackingFlow="background_agent"
            />
          </SettingsSection>
        )}

        {/* Integrations */}
        {shouldShowSection("integrations") && (
          <SettingsSection
            id={settingsSectionDomId("integrations")}
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
        )}

        {/* Usage & spend */}
        {shouldShowSection("usage") && (
          <SettingsSection
            id={settingsSectionDomId("usage")}
            icon={<IconCoin size={14} />}
            title="Usage"
            subtitle="Track token consumption and estimated cost — broken down by chat, automations, and background jobs."
            open={openSection === "usage"}
            onToggle={() => toggle("usage")}
          >
            <UsageSection />
          </SettingsSection>
        )}

        {/* A2A Agents */}
        {shouldShowSection("a2a") && (
          <SettingsSection
            id={settingsSectionDomId("a2a")}
            icon={<IconTopologyRing2 size={14} />}
            title="Connected Agents (A2A)"
            subtitle="Manage remote agents connected via the A2A protocol."
            open={openSection === "a2a"}
            onToggle={() => toggle("a2a")}
          >
            <AgentsSection />
          </SettingsSection>
        )}
      </div>
    </SettingsSurfaceProvider>
  );
}

export function SettingsPanel(props: SettingsPanelProps) {
  return <SettingsPanelContent {...props} />;
}

export function useAgentSettingsTabs(): SettingsTabItem[] {
  const { isDevMode, canToggle, setDevMode } = useDevMode();
  const baseProps = useMemo<SettingsPanelProps>(
    () => ({
      isDevMode,
      onToggleDevMode: () => {
        void setDevMode(!isDevMode);
      },
      showDevToggle: canToggle,
    }),
    [canToggle, isDevMode, setDevMode],
  );

  return useMemo<SettingsTabItem[]>(
    () => [
      {
        id: "agent",
        label: "Agent",
        icon: IconBrain,
        group: "agent",
        keywords: "agent model llm limits voice automations",
        searchEntries: buildSectionSearchEntries(AGENT_SETTINGS_SECTIONS),
        content: (
          <SettingsPanelContent
            {...baseProps}
            surface="page"
            sections={AGENT_SETTINGS_SECTIONS}
            showCapabilityStrip={false}
            className="mx-auto w-full max-w-2xl"
          />
        ),
      },
      {
        id: "connections",
        label: "Connections",
        icon: IconPlugConnected,
        group: "agent",
        keywords: "connections secrets integrations email browser usage",
        searchEntries: buildSectionSearchEntries(CONNECTION_SETTINGS_SECTIONS),
        content: (
          <SettingsPanelContent
            {...baseProps}
            surface="page"
            sections={CONNECTION_SETTINGS_SECTIONS}
            showCapabilityStrip={false}
            className="mx-auto w-full max-w-2xl"
          />
        ),
      },
      {
        id: "organization",
        label: "Organization",
        icon: IconUsersGroup,
        group: "workspace",
        keywords: "organization org team members invites collaborators",
        content: (
          <div className="mx-auto w-full max-w-2xl">
            <TeamPage showTitle={false} />
          </div>
        ),
      },
      {
        id: "workspace",
        label: "Workspace",
        icon: IconCloud,
        group: "workspace",
        keywords: "workspace account hosting database uploads auth",
        searchEntries: buildSectionSearchEntries(WORKSPACE_SETTINGS_SECTIONS),
        content: (
          <SettingsPanelContent
            {...baseProps}
            surface="page"
            sections={WORKSPACE_SETTINGS_SECTIONS}
            showCapabilityStrip={false}
            className="mx-auto w-full max-w-2xl"
          />
        ),
      },
    ],
    [baseProps],
  );
}
