import {
  Checkbox,
  Picker,
  Skeleton,
  TextField,
} from "@agent-native/toolkit/design-system";
import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@agent-native/toolkit/ui/command";
import {
  IconChevronDown,
  IconChevronRight,
  IconCheck,
  IconExternalLink,
  IconBrain,
  IconHierarchy2,
  IconBrowser,
  IconGitBranch,
  IconCloud,
  IconDatabase,
  IconFolder,
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
  IconApps,
  IconUsersGroup,
  IconTool,
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
import { buildSettingsRoute } from "../../navigation/index.js";
import {
  saveAgentEngineProviderSettings,
  setAgentEngineProvider,
} from "../agent-engine-key.js";
import { AgentWorkspaceContent } from "../agent-page/AgentWorkspaceContent.js";
import {
  AGENT_PROVIDER_CATALOG,
  getAgentProviderOption,
  providerIdForEngine,
  type AgentProviderId,
} from "../agent-provider-catalog.js";
import { agentNativePath } from "../api-path.js";
import { BuilderBMark } from "../builder-mark.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { useOrg } from "../org/hooks.js";
import { TeamPage } from "../org/TeamPage.js";
import { BuilderConnectCard } from "../setup-connections/BuilderConnectCard.js";
import { callAction } from "../use-action.js";
import { useDevMode } from "../use-dev-mode.js";
import { cn } from "../utils.js";
import {
  AGENT_SETTINGS_SECTIONS,
  ALL_SETTINGS_SECTIONS,
  INTEGRATION_SETTINGS_SECTIONS,
  WORKSPACE_SETTINGS_SECTIONS,
  getAgentSettingsSearchTabs,
  type SettingsSectionId,
} from "./agent-settings-search.js";
import { AgentsSection } from "./AgentsSection.js";
import { AutomationsSection } from "./AutomationsSection.js";
import { DemoModeSection } from "./DemoModeSection.js";
import { ExtensionsSettingsContent } from "./ExtensionsSettingsContent.js";
import { FileStorageSettingsForm } from "./FileStorageSettingsForm.js";
import { AgentProviderPicker } from "./ProviderSetupForm.js";
import { SecretsSection } from "./SecretsSection.js";
import { SettingsGroup, SettingsRow } from "./SettingsRow.js";
import {
  SettingsSection,
  SettingsSurfaceProvider,
  useSettingsSurface,
  type SettingsSurface,
} from "./SettingsSection.js";
import { SettingsLoadingRow, SettingsSkeleton } from "./SettingsSkeleton.js";
import type { SettingsTabItem } from "./SettingsTabsPage.js";
import { UsageSection } from "./UsageSection.js";
import {
  type BuilderConnectFlow,
  useBuilderConnectFlow,
  useBuilderStatus,
} from "./useBuilderStatus.js";
import {
  settingsSectionDomId,
  useSettingsPanelController,
} from "./useSettingsPanelController.js";
import { VoiceTranscriptionSection } from "./VoiceTranscriptionSection.js";

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof ToolkitButton>
>(({ className, ...props }, ref) => (
  <ToolkitButton
    ref={ref}
    variant="ghost"
    className={cn(
      "h-auto p-0 hover:bg-transparent hover:text-inherit active:scale-100 [&_svg]:!size-auto",
      className,
    )}
    {...props}
  />
));
Button.displayName = "SettingsPrimitiveButton";

const ManageButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof ToolkitButton>
>(({ children = "Manage", className, ...props }, ref) => (
  <ToolkitButton
    ref={ref}
    type="button"
    variant="ghost"
    intent="neutral"
    emphasis="outline"
    className={cn(
      "inline-flex h-9 min-h-9 items-center justify-center gap-1 rounded-md border border-border px-3 text-sm font-medium leading-none text-foreground hover:bg-accent/40 active:scale-100 [&_svg]:!size-4",
      className,
    )}
    {...props}
  >
    {children}
  </ToolkitButton>
));
ManageButton.displayName = "SettingsManageButton";

const IntegrationsPanel = lazy(() =>
  import("../integrations/IntegrationsPanel.js").then((m) => ({
    default: m.IntegrationsPanel,
  })),
);

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

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className={fieldLabelClass(isPage)}>{label}</p>
        {labelAdornment}
      </div>
      <Picker
        mode="select"
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          description: option.description,
          textValue: option.label,
        }))}
        value={value}
        onChange={(next) => {
          if (next != null) onValueChange(String(next));
        }}
        disabled={disabled}
        aria-label={label}
        placeholder={value}
        style={controlStyle}
        className={cn(
          "w-full text-start text-foreground",
          isPage ? "text-sm" : "text-[12px]",
        )}
      />
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
        <Button
          type="button"
          intent="danger"
          emphasis="solid"
          onClick={handleDisconnectClick}
          className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20"
        >
          Confirm disconnect
        </Button>
        <Button
          type="button"
          intent="neutral"
          emphasis="outline"
          onClick={handleCancel}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40"
        >
          Cancel
        </Button>
      </>
    );
  }

  return (
    <>
      <Button
        type="button"
        intent="danger"
        emphasis="outline"
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
      </Button>
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
  subtitle = "Builder.io free credits to start - no API key needed.",
  dim,
  compact = false,
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
  /** Use a Codex-style row when this card is the primary action in a page section. */
  compact?: boolean;
}) {
  const isPage = useSettingsSurface() === "page";
  const effectiveConnected = connected || builderFlow.configured;
  const effectiveOrgName = builderFlow.orgName ?? orgName;
  const bgClass = dim ? "" : "bg-accent/30";
  const titleCls = isPage ? "text-sm" : "text-[11px]";
  const bodyCls = isPage ? "text-xs" : "text-[10px]";

  if (compact && effectiveConnected) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-sm text-primary">
        <IconCheck size={14} />
        Connected
        {effectiveOrgName ? ` · ${effectiveOrgName}` : ""}
      </span>
    );
  }

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
              <Button
                type="button"
                intent="neutral"
                emphasis="ghost"
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
              </Button>
            )}
            {credentialSource !== "env" ? <DisconnectBuilderButton /> : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (compact) {
    return (
      <Button
        type="button"
        intent="primary"
        emphasis="solid"
        onClick={() => builderFlow.start({ trackingSource, trackingFlow })}
        disabled={builderFlow.connecting}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
      >
        {builderFlow.connecting ? "Connecting…" : "Connect Builder.io"}
        {builderFlow.connecting ? (
          <IconLoader2 size={14} className="animate-spin" />
        ) : null}
      </Button>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card text-start transition-colors",
        isPage ? "px-4 py-3.5" : "px-3 py-3",
        builderFlow.error && "border-destructive/40",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
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
      </div>
      <Button
        type="button"
        intent="neutral"
        emphasis="outline"
        onClick={() => builderFlow.start({ trackingSource, trackingFlow })}
        disabled={builderFlow.connecting}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-accent/40 disabled:cursor-wait disabled:opacity-70",
          isPage ? "text-sm" : "text-[11px]",
        )}
      >
        {builderFlow.connecting ? "Connecting…" : "Connect Builder.io"}
        {builderFlow.connecting ? (
          <IconLoader2 size={isPage ? 14 : 12} className="animate-spin" />
        ) : null}
      </Button>
    </div>
  );
}

// ─── Manual setup card ──────────────────────────────────────────────────────

function ManualSetupCard({
  id,
  title = "Set up manually",
  hint,
  docsUrl,
  docsLabel = "Read the docs",
  children,
  dim,
  sourceBadge,
  bare = false,
  popover = false,
  popoverLabel = "Manage",
  summaryContent,
}: {
  id?: string;
  title?: string;
  hint?: string;
  docsUrl?: string;
  docsLabel?: string;
  children?: React.ReactNode;
  dim?: boolean;
  /** Optional "Connected via X" badge shown in the header row. */
  sourceBadge?: string;
  /** Render the form without another card surface when used in a popover. */
  bare?: boolean;
  /** Show only a Manage trigger and progressively disclose the form. */
  popover?: boolean;
  /** Label for the trigger when the form is shown in a popover. */
  popoverLabel?: string;
  /** Optional connection summary shown above the setup content. */
  summaryContent?: React.ReactNode;
}) {
  const isPage = useSettingsSurface() === "page";
  const titleCls = isPage ? "text-sm" : "text-[11px]";
  const bodyCls = isPage ? "text-xs" : "text-[10px]";
  const content = (
    <div
      id={id}
      className={cn(
        bare
          ? "space-y-2"
          : cn(
              "rounded-md border border-border",
              isPage ? "px-3.5 py-3" : "px-2.5 py-2",
              dim ? "" : "bg-accent/30",
            ),
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <div className={cn("font-medium text-foreground", titleCls)}>
          {title}
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

  if (!popover) return content;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ManageButton>{popoverLabel}</ManageButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="max-h-[min(640px,calc(100vh-2rem))] w-[min(420px,calc(100vw-2rem))] overflow-y-auto p-4"
      >
        <div className="space-y-3">
          {summaryContent}
          {content}
        </div>
      </PopoverContent>
    </Popover>
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
  source: "env" | "settings" | "app_secrets";
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
    if (settingsStatus?.source === "app_secrets") {
      return "Connected via saved key";
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
      <TextField
        value={value}
        onChange={onValueChange}
        disabled={disabled}
        list={`app-model-suggestions-${engine}`}
        onKeyDown={(event) => {
          if (event.key === "Enter") onEnter?.();
        }}
        placeholder={defaultModel ?? "model-id"}
        autoComplete="off"
        aria-label="Model"
        className={cn(
          "w-full disabled:opacity-60",
          isPage ? "text-sm" : "text-[12px]",
        )}
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
  grouped = false,
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
  grouped?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const isPage = useSettingsSurface() === "page";
  const t = useT();
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
  const [applyError, setApplyError] = useState<string | null>(null);
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
          (data.source === "env" ||
            data.source === "settings" ||
            data.source === "app_secrets")
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
  const selectedProvider = providerIdForEngine(selectedEngine) ?? "anthropic";
  const selectedProviderOption = getAgentProviderOption(selectedProvider);
  const envVar = selectedProviderOption.key;
  const selectedEnginePackageInstalled =
    selectedEngineInfo?.packageInstalled !== false;
  const envConfigured = envVar
    ? (envKeys.find((k) => k.key === envVar)?.configured ?? false)
    : false;
  const settingsConfigured =
    settingsStatus != null &&
    (settingsStatus.engine === selectedEngine ||
      (!!envVar && settingsStatus.envVar === envVar));
  const configuredProviderIds = useMemo(() => {
    const configured = new Set<AgentProviderId>();
    for (const option of AGENT_PROVIDER_CATALOG) {
      if (
        option.key &&
        envKeys.some((entry) => entry.key === option.key && entry.configured)
      ) {
        configured.add(option.id);
      }
    }
    if (settingsStatus) {
      const statusProvider = providerIdForEngine(settingsStatus.engine);
      if (statusProvider) configured.add(statusProvider);
      if (settingsStatus.envVar) {
        const statusOption = AGENT_PROVIDER_CATALOG.find(
          (option) => option.key === settingsStatus.envVar,
        );
        if (statusOption) configured.add(statusOption.id);
      }
    }
    return configured;
  }, [envKeys, settingsStatus]);
  const builderConnected = connected || builderFlow.configured;
  const anyKeyConfigured =
    builderConnected ||
    (selectedEnginePackageInstalled &&
      (envConfigured || settingsConfigured || configuredProviderIds.size > 0));
  const sourceBadge = computeSourceBadge({
    settingsConfigured,
    settingsStatus,
    envConfigured,
    envVar,
    builderConnected,
  });
  const manualSetupHint = "Select a provider.";

  const engineChanged =
    selectedEngine !== currentEngine || selectedModel !== currentModel;
  const isEndpointProvider = selectedProviderOption.supportsEndpoint === true;
  const endpointChanged =
    isEndpointProvider && (!!baseUrl.trim() || clearBaseUrl);
  const providerSettingsChanged = !!apiKey.trim() || endpointChanged;

  const modelOptions: SettingsSelectOption[] = latestModelsOnly(
    selectedEngineInfo?.supportedModels ?? [],
  ).map((m) => ({ value: m, label: friendlyModelName(m) }));

  const handleSave = async () => {
    if (!providerSettingsChanged || (!envVar && !isEndpointProvider)) return;
    setSaving(true);
    try {
      const nextBaseUrl = isEndpointProvider ? baseUrl.trim() : "";
      await saveAgentEngineProviderSettings({
        provider: selectedProvider,
        ...(envVar ? { key: envVar } : {}),
        ...(apiKey.trim() ? { apiKey } : {}),
        ...(nextBaseUrl ? { baseUrl: nextBaseUrl } : {}),
        ...(isEndpointProvider && clearBaseUrl ? { clearBaseUrl: true } : {}),
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
    setApplyError(null);
    try {
      await setAgentEngineProvider({
        provider: selectedProvider,
        model: selectedModel,
      });
      setCurrentEngine(selectedEngine);
      setCurrentModel(selectedModel);
      setApplyNote(true);
      refreshSettingsStatus();
      notifyConfigChanged();
      setTimeout(() => setApplyNote(false), 4000);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <SettingsSection
      id={settingsSectionDomId("llm")}
      icon={<IconBrain size={14} />}
      title="LLM"
      required
      connected={initialLoading ? undefined : anyKeyConfigured}
      subtitle={
        isPage
          ? undefined
          : t("agentPanel.builderOrOwnKeys", {
              defaultValue: "Choose Builder.io or custom keys.",
            })
      }
      grouped={isPage && grouped}
      open={open}
      onToggle={onToggle}
    >
      {initialLoading ? (
        <SettingsLoadingRow controlCount={2} />
      ) : (
        <div
          className={cn(
            isPage
              ? "flex items-center justify-between gap-4 px-5 py-4 sm:px-6"
              : "flex items-center justify-between gap-2",
          )}
        >
          {isPage && (
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">AI provider</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("agentPanel.builderOrOwnKeys", {
                  defaultValue: "Choose Builder.io or custom keys.",
                })}
              </p>
            </div>
          )}
          <div className={cn("flex flex-wrap items-center justify-end gap-2")}>
            {!anyKeyConfigured && (
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
                compact
              />
            )}
            <ManualSetupCard
              id="llm-manual-setup"
              title="Custom keys"
              hint={manualSetupHint}
              sourceBadge={builderConnected ? undefined : sourceBadge}
              bare={isPage}
              popover
              popoverLabel={
                settingsConfigured
                  ? "Manage"
                  : t("agentPanel.addOwnKeys", {
                      defaultValue: "Custom keys",
                    })
              }
              summaryContent={
                anyKeyConfigured ? (
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
                ) : undefined
              }
            >
              <div className="space-y-2 mb-1">
                <AgentProviderPicker
                  value={selectedProvider}
                  configuredProviders={configuredProviderIds}
                  layout={isPage ? "page" : "compact"}
                  onChange={(provider) => {
                    const option = getAgentProviderOption(provider);
                    setSelectedEngine(option.engine);
                    setSelectedModel(option.defaultModel);
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

                {isEndpointProvider && (
                  <div className="border-t border-border/70 pt-2">
                    <Button
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
                        {selectedProvider === "ollama"
                          ? "Local Ollama endpoint"
                          : "OpenAI-compatible endpoint"}
                      </span>
                    </Button>

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
                              : selectedProvider === "ollama"
                                ? "http://localhost:11434"
                                : "https://gateway.example/v1"
                          }
                          disabled={clearBaseUrl}
                          spellCheck={false}
                          autoComplete="off"
                          className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none transition-colors hover:bg-accent/40 focus:ring-1 focus:ring-accent disabled:opacity-50 placeholder:text-muted-foreground/50"
                          style={CONTROL_STYLE}
                        />
                        {baseUrlConfigured && (
                          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <Checkbox
                              checked={clearBaseUrl}
                              onChange={(checked) => {
                                setClearBaseUrl(checked);
                                if (checked) setBaseUrl("");
                              }}
                              aria-label="Clear saved endpoint override"
                              className="shrink-0"
                            />
                            Clear saved endpoint override
                          </label>
                        )}
                        {endpointChanged && (
                          <Button
                            type="button"
                            intent="neutral"
                            emphasis="solid"
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
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {envVar && (envConfigured || settingsConfigured) ? (
                  <div
                    className={cn(
                      "flex items-center gap-1.5 text-primary",
                      isPage ? "text-xs" : "text-[10px]",
                    )}
                  >
                    <IconCheck size={isPage ? 14 : 10} />
                    {settingsStatus?.source === "app_secrets" &&
                    settingsConfigured
                      ? "Saved key configured"
                      : `${envVar} configured`}
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
                    <Button
                      intent="primary"
                      emphasis="solid"
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
                    </Button>
                  </div>
                ) : null}

                <div className="flex items-center gap-2">
                  <Button
                    intent="neutral"
                    emphasis="outline"
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
                  </Button>
                  {PROVIDER_DOCS[selectedEngine] ? (
                    <a
                      href={PROVIDER_DOCS[selectedEngine]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        pillButtonClass(isPage, "outline"),
                        "no-underline",
                      )}
                    >
                      Get an API key
                      <IconExternalLink size={isPage ? 14 : 10} />
                    </a>
                  ) : null}
                  {engineChanged && (
                    <Button
                      intent="primary"
                      emphasis="solid"
                      onClick={handleApply}
                      className={pillButtonClass(isPage, "solid")}
                    >
                      Apply
                    </Button>
                  )}
                  {settingsStatus != null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          intent="danger"
                          emphasis="outline"
                          onClick={handleDisconnect}
                          className={cn(
                            pillButtonClass(isPage, "outline"),
                            "ms-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40",
                          )}
                        >
                          Disconnect
                        </Button>
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
                      "flex items-center gap-1 text-primary",
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
                {applyError && (
                  <p
                    className={cn(
                      "text-destructive",
                      isPage ? "text-xs" : "text-[10px]",
                    )}
                  >
                    Apply failed: {applyError}
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
          </div>
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

function AppDefaultModelPicker({
  engines,
  value,
  disabled,
  onChange,
}: {
  engines: AppModelDefaultEngine[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const visibleEngines = engines.filter(
    (engine) => engine.name !== "ai-sdk:anthropic",
  );
  const selectedModel = value.includes("::")
    ? value.slice(value.indexOf("::") + 2)
    : null;
  const selectedEngine = value.includes("::")
    ? visibleEngines.find((engine) => engine.name === value.split("::", 1)[0])
    : null;
  const selectedLabel = selectedModel
    ? `${selectedEngine?.label ?? selectedEngine?.name ?? "Provider"} · ${friendlyModelName(selectedModel)}`
    : "Global default";

  const openIntegrations = () => {
    setOpen(false);
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", buildSettingsRoute("integrations"));
      window.dispatchEvent(new Event("popstate"));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          disabled={disabled}
          aria-label="Default model"
          className="inline-flex h-10 min-w-[230px] max-w-[320px] items-center justify-between gap-3 rounded-md border border-border bg-background px-3 text-start text-sm text-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="truncate">{selectedLabel}</span>
          <IconChevronDown
            size={15}
            className="shrink-0 text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(380px,calc(100vw-2rem))] p-0"
      >
        <Command
          filter={(candidate, search) =>
            candidate.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Search providers or models..." />
          <CommandList className="max-h-[min(420px,calc(100vh-8rem))]">
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup heading="Default">
              <CommandItem
                value="global default shared llm"
                onSelect={() => {
                  onChange("__global__");
                  setOpen(false);
                }}
                className="items-start gap-2"
              >
                <IconCheck
                  size={15}
                  className={cn(
                    "mt-0.5 shrink-0",
                    value === "__global__" ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex min-w-0 flex-col">
                  <span>Global default</span>
                  <span className="text-xs text-muted-foreground">
                    Use the shared LLM default
                  </span>
                </span>
              </CommandItem>
            </CommandGroup>
            {visibleEngines.length > 0 && <CommandSeparator />}
            {visibleEngines.map((engine) => {
              const providerLabel =
                engine.name === "builder"
                  ? "Builder.io"
                  : engine.label || engine.name;
              const modelIds = latestModelsOnly(engine.supportedModels);
              const models = modelIds.length
                ? modelIds
                : engine.defaultModel
                  ? [engine.defaultModel]
                  : [];
              const configured =
                engine.configured && engine.packageInstalled !== false;
              return (
                <CommandGroup key={engine.name} heading={providerLabel}>
                  {models.map((model) => {
                    const optionValue = `${engine.name}::${model}`;
                    return (
                      <CommandItem
                        key={optionValue}
                        value={`${providerLabel} ${model} ${friendlyModelName(model)}`}
                        disabled={!configured}
                        onSelect={() => {
                          onChange(optionValue);
                          setOpen(false);
                        }}
                        className="items-start gap-2"
                      >
                        <IconCheck
                          size={15}
                          className={cn(
                            "mt-0.5 shrink-0",
                            value === optionValue ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="truncate">
                          {friendlyModelName(model)}
                        </span>
                      </CommandItem>
                    );
                  })}
                  {!configured && (
                    <CommandItem
                      value={`configure ${providerLabel} in integrations api keys`}
                      onSelect={openIntegrations}
                      className="gap-2 text-muted-foreground"
                    >
                      <IconExternalLink size={14} />
                      Configure in Integrations
                    </CommandItem>
                  )}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AppModelDefaultsSectionInner({
  grouped = false,
  open,
  onToggle,
}: {
  grouped?: boolean;
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

  if (!loading && !settings) return null;

  const selectedEngineInfo =
    settings?.engines.find((engine) => engine.name === selectedEngine) ?? null;
  const engineOptions: SettingsSelectOption[] = (settings?.engines ?? [])
    .filter(
      (engine) =>
        engine.name === selectedEngine || engine.name !== "ai-sdk:anthropic",
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

  const save = async (next?: { engine: string; model: string }) => {
    const targetEngine = next?.engine ?? selectedEngine;
    const targetModel = (next?.model ?? selectedModel).trim();
    const targetPendingChange =
      !!settings &&
      settings.canUpdate &&
      !!targetEngine &&
      !!targetModel &&
      (targetEngine !== settings.engine || targetModel !== settings.model);
    if (!targetPendingChange) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    setSelectedEngine(targetEngine);
    setSelectedModel(targetModel);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/agent-model-defaults"),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            engine: targetEngine,
            model: targetModel,
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
      subtitle="Choose the model used by this app by default."
      connected={loading ? undefined : hasAppDefault}
      grouped={isPage && grouped}
      open={open}
      onToggle={onToggle}
    >
      {loading ? (
        <SettingsLoadingRow />
      ) : settings ? (
        isPage ? (
          <SettingsRow
            className={grouped ? undefined : "-mx-5 sm:-mx-6"}
            label="Default model"
            description={
              hasAppDefault
                ? `Used by ${friendlyAppName(settings.appId) || "this app"} · ${scopeLabel}.`
                : "Uses the global LLM default."
            }
            status={
              <span className="text-xs text-muted-foreground">
                {settings.source}
              </span>
            }
            control={
              <AppDefaultModelPicker
                engines={settings.engines}
                value={
                  hasAppDefault
                    ? `${selectedEngine}::${selectedModel}`
                    : "__global__"
                }
                disabled={!settings.canUpdate || saving}
                onChange={(next) => {
                  const value = next;
                  if (value === "__global__") {
                    void reset();
                    return;
                  }
                  const separator = value.indexOf("::");
                  if (separator < 1) return;
                  void save({
                    engine: value.slice(0, separator),
                    model: value.slice(separator + 2),
                  });
                }}
              />
            }
          >
            {!settings.canUpdate && (
              <p className="text-xs text-muted-foreground">
                Only organization owners and admins can change this setting.
              </p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </SettingsRow>
        ) : (
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
                  <Button
                    type="button"
                    intent="primary"
                    emphasis="solid"
                    onClick={() => void save()}
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
                  </Button>
                  <Button
                    type="button"
                    intent="neutral"
                    emphasis="outline"
                    onClick={reset}
                    disabled={!settings.canUpdate || !hasAppDefault || saving}
                    className={pillButtonClass(isPage, "outline")}
                  >
                    Reset
                  </Button>
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
                  This app does not include the optional runtime packages for
                  this provider.
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
                <p
                  className={cn("mt-2 text-destructive", noteTextClass(isPage))}
                >
                  {error}
                </p>
              )}
            </div>
          </div>
        )
      ) : null}
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
          <SettingsSelect
            label="Provider"
            value={emailProvider}
            options={[
              { value: "resend", label: "Resend" },
              { value: "sendgrid", label: "SendGrid" },
            ]}
            onValueChange={(value) =>
              setEmailProvider(value as "resend" | "sendgrid")
            }
          />

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
                  <Button
                    intent="primary"
                    emphasis="solid"
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
                  </Button>
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
                    <Button
                      intent="primary"
                      emphasis="solid"
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
                    </Button>
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
                  <Button
                    intent="primary"
                    emphasis="solid"
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
                  </Button>
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
                    <Button
                      intent="primary"
                      emphasis="solid"
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
                    </Button>
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
  grouped = false,
  open,
  onToggle,
}: {
  grouped?: boolean;
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

  if (!loading && !settings) return null;

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
      subtitle="Set how long a response can work before pausing."
      connected={
        loading
          ? undefined
          : settings
            ? settings.maxIterations !== settings.defaultMaxIterations
            : false
      }
      grouped={isPage && grouped}
      open={open}
      onToggle={onToggle}
    >
      {loading ? (
        <SettingsLoadingRow />
      ) : settings ? (
        isPage ? (
          <SettingsRow
            className={grouped ? undefined : "-mx-5 sm:-mx-6"}
            label="Max iterations"
            description={`Default ${settings.defaultMaxIterations.toLocaleString()} · applies to ${scopeLabel}.`}
            status={
              <span className="text-xs text-muted-foreground">
                {settings.source}
              </span>
            }
            control={
              <Popover>
                <PopoverTrigger asChild>
                  <ManageButton />
                </PopoverTrigger>
                <PopoverContent align="end" sideOffset={6} className="w-80 p-4">
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Max iterations
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Choose how long a response can work before pausing.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={settings.minMaxIterations}
                        max={settings.maxMaxIterations}
                        value={value}
                        disabled={!settings.canUpdate || saving}
                        onChange={(event) => {
                          setValue(event.target.value);
                          setError(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && hasPendingChange) {
                            void save();
                          }
                        }}
                        className={cn(
                          textInputClass(true),
                          "min-w-0 flex-1 disabled:opacity-60",
                        )}
                        style={CONTROL_STYLE_PAGE}
                      />
                      <Button
                        type="button"
                        intent="primary"
                        emphasis="solid"
                        onClick={save}
                        disabled={!hasPendingChange || saving}
                        className={pillButtonClass(true, "solid")}
                      >
                        {saving ? (
                          <IconLoader2 size={14} className="animate-spin" />
                        ) : saved ? (
                          <IconCheck size={14} />
                        ) : (
                          "Save"
                        )}
                      </Button>
                      <Button
                        type="button"
                        intent="neutral"
                        emphasis="outline"
                        onClick={reset}
                        disabled={
                          !settings.canUpdate ||
                          saving ||
                          settings.maxIterations ===
                            settings.defaultMaxIterations
                        }
                        className={pillButtonClass(true, "outline")}
                      >
                        Reset
                      </Button>
                    </div>
                    {!settings.canUpdate && (
                      <p className="text-xs text-muted-foreground">
                        Only organization owners and admins can change this
                        limit.
                      </p>
                    )}
                    {error && (
                      <p className="text-xs text-destructive">{error}</p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            }
          />
        ) : (
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
                <Button
                  type="button"
                  intent="primary"
                  emphasis="solid"
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
                </Button>
                <Button
                  type="button"
                  intent="neutral"
                  emphasis="outline"
                  onClick={reset}
                  disabled={
                    !settings.canUpdate ||
                    saving ||
                    settings.maxIterations === settings.defaultMaxIterations
                  }
                  className={pillButtonClass(isPage, "outline")}
                >
                  Reset
                </Button>
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
                <p
                  className={cn("mt-2 text-destructive", noteTextClass(isPage))}
                >
                  {error}
                </p>
              )}
            </div>
          </div>
        )
      ) : null}
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

export interface AgentSettingsTabsOptions {
  /**
   * Include the shared Extensions management tab. Extensions are an optional
   * app capability and stay hidden unless the host opts in.
   */
  extensionTools?: boolean;
  /** Optional page-level settings to show in the Agent section. */
  agentAdditionalContent?: React.ReactNode;
  /** Optional app-owned tabs that share the Agent settings scope. */
  agentAdditionalTabFactories?: AgentSettingsTabFactory[];
  /** App identity used to scope the shared Usage tab. */
  usageAppId?: string | null;
  /** Optional progressive-disclosure link to the app's full metrics view. */
  usageViewAllHref?: string;
}

export interface AgentSettingsTabFactoryContext {
  scope: "user";
  canManageOrg?: boolean;
  scopeControl: React.ReactNode;
}

export type AgentSettingsTabFactory = (
  context: AgentSettingsTabFactoryContext,
) => SettingsTabItem;

export function areExtensionSettingsEnabled(
  options: AgentSettingsTabsOptions = {},
): boolean {
  return options.extensionTools === true;
}

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
              <Skeleton className="h-3 w-16" />
            ) : builderConnected ? (
              "Connected"
            ) : (
              <Button
                type="button"
                intent="neutral"
                emphasis="outline"
                onClick={onOpenLlm}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                Connect
              </Button>
            )
          }
        />
      </div>
    </div>
  );
}

interface SettingsPanelContentProps extends SettingsPanelProps {
  sections?: readonly SettingsSectionId[];
  showCapabilityStrip?: boolean;
  className?: string;
  surface?: SettingsSurface;
  builderConnectionOwnedExternally?: boolean;
  agentAdditionalContent?: React.ReactNode;
}

function SettingsPanelContent({
  isDevMode,
  initialSection,
  sectionRequestKey,
  sections = ALL_SETTINGS_SECTIONS,
  showCapabilityStrip = true,
  className,
  surface = "sidebar",
  builderConnectionOwnedExternally = false,
  agentAdditionalContent,
}: SettingsPanelContentProps) {
  const { status: builder, loading: builderLoading } = useBuilderStatus({
    enabled: !builderConnectionOwnedExternally,
  });
  const connected = builder?.configured ?? false;
  const connectUrl = builder?.cliAuthUrl ?? builder?.connectUrl;
  const orgName = builder?.orgName;
  const envManaged = !!builder?.envManaged;
  const credentialSource = builder?.credentialSource;
  const builderBranchesAvailable = !!builder?.builderEnabled;
  const builderFlow = useBuilderConnectFlow({
    enabled: !builderConnectionOwnedExternally,
    popupUrl: connectUrl,
    trackingSource: "settings_panel_builder_card",
  });

  const scrollSectionIntoView = useCallback((section: SettingsSectionId) => {
    window.requestAnimationFrame(() => {
      document.getElementById(settingsSectionDomId(section))?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }, []);
  const {
    focusSecretKey,
    isSectionVisible: shouldShowSection,
    openSection,
    toggleSection: toggle,
    openSettingsSection: openControllerSection,
  } = useSettingsPanelController({
    sections,
    initialSection,
    sectionRequestKey,
    onScrollToSection: scrollSectionIntoView,
  });
  const openSettingsSection = useCallback(
    (section: SettingsSectionId, scroll = false) =>
      openControllerSection(section, { scroll }),
    [openControllerSection],
  );

  const isPage = surface === "page";
  const isWorkspacePage = isPage && sections.includes("hosting");

  return (
    <SettingsSurfaceProvider surface={surface}>
      <div
        className={cn(
          isPage ? "space-y-8" : "flex-1 min-h-0 overflow-y-auto p-3 space-y-2",
          className,
        )}
        style={isPage ? undefined : { overflowY: "auto" }}
      >
        {showCapabilityStrip && (
          <CapabilityStatusStrip
            isDevMode={isDevMode}
            builderConnected={connected}
            builderLoading={builderLoading}
            builderBranchesAvailable={builderBranchesAvailable}
            onOpenLlm={() => openSettingsSection("llm", true)}
          />
        )}

        {isPage &&
          ["llm", "app-models", "limits", "voice"].some((section) =>
            shouldShowSection(section as SettingsSectionId),
          ) && (
            <SettingsGroup title="Agent">
              {shouldShowSection("llm") && (
                <LLMSectionInner
                  builderFlow={builderFlow}
                  builderLoading={builderLoading}
                  connectUrl={connectUrl}
                  connected={connected}
                  orgName={orgName}
                  envManaged={envManaged}
                  credentialSource={credentialSource}
                  grouped
                  open={openSection === "llm"}
                  onToggle={() => toggle("llm")}
                />
              )}
              {shouldShowSection("app-models") && (
                <AppModelDefaultsSectionInner
                  grouped
                  open={openSection === "app-models"}
                  onToggle={() => toggle("app-models")}
                />
              )}
              {shouldShowSection("limits") && (
                <AgentLimitsSectionInner
                  grouped
                  open={openSection === "limits"}
                  onToggle={() => toggle("limits")}
                />
              )}
              {shouldShowSection("voice") && (
                <SettingsSection
                  id={settingsSectionDomId("voice")}
                  icon={<IconMicrophone size={14} />}
                  title="Voice Transcription"
                  subtitle="Choose how voice input is transcribed."
                  grouped
                  flat
                  open={openSection === "voice"}
                  onToggle={() => toggle("voice")}
                >
                  <VoiceTranscriptionSection compact />
                </SettingsSection>
              )}
            </SettingsGroup>
          )}

        {isPage && agentAdditionalContent ? (
          <SettingsGroup title="Notifications">
            {agentAdditionalContent}
          </SettingsGroup>
        ) : null}

        {isPage &&
          ["automations", "background"].some((section) =>
            shouldShowSection(section as SettingsSectionId),
          ) && (
            <SettingsGroup title="Agent workflows">
              {shouldShowSection("automations") && (
                <SettingsSection
                  id={settingsSectionDomId("automations")}
                  icon={<IconBolt size={14} />}
                  title="Automations"
                  subtitle="Scheduled and event-triggered agent tasks."
                  grouped
                  flat
                  open={openSection === "automations"}
                  onToggle={() => toggle("automations")}
                >
                  <SettingsRow
                    label="Automations"
                    description="Schedule agent tasks or run them from events."
                    control={
                      <a
                        href="/settings/agent/automations"
                        className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground no-underline transition-colors hover:bg-accent/40"
                      >
                        Open automations
                        <IconExternalLink size={14} />
                      </a>
                    }
                  />
                </SettingsSection>
              )}
              {shouldShowSection("background") && (
                <SettingsSection
                  id={settingsSectionDomId("background")}
                  icon={<IconGitBranch size={14} />}
                  title="Background Agent"
                  subtitle="Make code changes from production mode via Builder."
                  grouped
                  flat
                  connected={connected}
                  open={openSection === "background"}
                  onToggle={() => toggle("background")}
                >
                  <SettingsRow
                    label="Background agent"
                    description="Make code changes from production mode via Builder."
                    control={
                      <UseBuilderCard
                        builderFlow={builderFlow}
                        connectUrl={connectUrl}
                        connected={connected}
                        orgName={orgName}
                        envManaged={envManaged}
                        credentialSource={credentialSource}
                        trackingSource="background_agent_settings"
                        trackingFlow="background_agent"
                        compact
                      />
                    }
                  />
                </SettingsSection>
              )}
            </SettingsGroup>
          )}

        {isWorkspacePage && (
          <SettingsGroup title="Workspace">
            {shouldShowSection("demo-mode") && (
              <SettingsRow
                id={settingsSectionDomId("demo-mode")}
                label="Demo mode"
                description="Use sample data in this browser for presentations."
                control={<DemoModeSection compact />}
              />
            )}
            {shouldShowSection("hosting") && (
              <SettingsRow
                id={settingsSectionDomId("hosting")}
                label="Hosting"
                description="Deploy the app to the cloud."
                control={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!connected && (
                      <UseBuilderCard
                        builderFlow={builderFlow}
                        connectUrl={connectUrl}
                        connected={connected}
                        orgName={orgName}
                        envManaged={envManaged}
                        credentialSource={credentialSource}
                        trackingSource="hosting_settings"
                        trackingFlow="hosting"
                        compact
                      />
                    )}
                    <ManualSetupCard
                      title="Set up manually"
                      hint="Deploy manually to Netlify, Vercel, Cloudflare, or any Nitro-supported target."
                      docsUrl="https://www.builder.io/c/docs/agent-native-deployment?utm_source=agent-native&utm_medium=product&utm_campaign=onboarding&utm_content=deployment_settings"
                      dim={connected}
                      bare
                      popover
                      popoverLabel="Manage"
                      summaryContent={
                        connected ? (
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
                        ) : undefined
                      }
                    />
                  </div>
                }
              />
            )}
            {shouldShowSection("database") && (
              <SettingsRow
                id={settingsSectionDomId("database")}
                label="Database"
                description="Connect persistent app storage."
                control={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!connected && (
                      <UseBuilderCard
                        builderFlow={builderFlow}
                        connectUrl={connectUrl}
                        connected={connected}
                        orgName={orgName}
                        envManaged={envManaged}
                        credentialSource={credentialSource}
                        trackingSource="database_settings"
                        trackingFlow="database"
                        compact
                      />
                    )}
                    <ManualSetupCard
                      title="Set up manually"
                      hint="Set DATABASE_URL in your .env to connect a supported database."
                      docsUrl="https://www.builder.io/c/docs/agent-native-database?utm_source=agent-native&utm_medium=product&utm_campaign=onboarding&utm_content=database_settings"
                      dim={connected}
                      bare
                      popover
                      popoverLabel="Manage"
                      summaryContent={
                        connected ? (
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
                        ) : undefined
                      }
                    />
                  </div>
                }
              />
            )}
            {shouldShowSection("uploads") && (
              <SettingsRow
                id={settingsSectionDomId("uploads")}
                label="File uploads"
                description="Store avatars and chat attachments."
                control={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!connected && (
                      <UseBuilderCard
                        builderFlow={builderFlow}
                        connectUrl={connectUrl}
                        connected={connected}
                        orgName={orgName}
                        envManaged={envManaged}
                        credentialSource={credentialSource}
                        trackingSource="file_upload_settings"
                        trackingFlow="file_upload"
                        compact
                      />
                    )}
                    <ManualSetupCard
                      title="Set up manually"
                      hint="Use an S3-compatible bucket with a stable public URL for durable chat attachments."
                      docsUrl="https://www.builder.io/c/docs/agent-native-file-uploads?utm_source=agent-native&utm_medium=product&utm_campaign=onboarding&utm_content=file_upload_settings"
                      dim={connected}
                      bare
                      popover
                      popoverLabel="Manage"
                      summaryContent={
                        connected ? (
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
                        ) : undefined
                      }
                    >
                      <FileStorageSettingsForm />
                    </ManualSetupCard>
                  </div>
                }
              />
            )}
            {shouldShowSection("auth") && (
              <SettingsRow
                id={settingsSectionDomId("auth")}
                label="Authentication"
                description="Set up sign-in and access control."
                control={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!connected && (
                      <UseBuilderCard
                        builderFlow={builderFlow}
                        connectUrl={connectUrl}
                        connected={connected}
                        orgName={orgName}
                        envManaged={envManaged}
                        credentialSource={credentialSource}
                        trackingSource="auth_settings"
                        trackingFlow="auth"
                        compact
                      />
                    )}
                    <ManualSetupCard
                      title="Set up manually"
                      hint="Configure Better Auth and optional Google or GitHub providers."
                      docsUrl="https://www.builder.io/c/docs/agent-native-authentication?utm_source=agent-native&utm_medium=product&utm_campaign=onboarding&utm_content=authentication_settings"
                      dim={connected}
                      bare
                      popover
                      popoverLabel="Manage"
                      summaryContent={
                        connected ? (
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
                        ) : undefined
                      }
                    />
                  </div>
                }
              />
            )}
          </SettingsGroup>
        )}

        {!isPage && shouldShowSection("llm") && (
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

        {!isPage && shouldShowSection("app-models") && (
          <AppModelDefaultsSectionInner
            open={openSection === "app-models"}
            onToggle={() => toggle("app-models")}
          />
        )}

        {!isPage && shouldShowSection("limits") && (
          <AgentLimitsSectionInner
            open={openSection === "limits"}
            onToggle={() => toggle("limits")}
          />
        )}

        {!isPage && shouldShowSection("voice") && (
          <SettingsSection
            id={settingsSectionDomId("voice")}
            icon={<IconMicrophone size={14} />}
            title="Voice Transcription"
            subtitle="How the composer microphone turns your voice into text."
            flat
            open={openSection === "voice"}
            onToggle={() => toggle("voice")}
          >
            <VoiceTranscriptionSection />
          </SettingsSection>
        )}

        {/* Demo mode */}
        {!isPage && shouldShowSection("demo-mode") && (
          <SettingsSection
            id={settingsSectionDomId("demo-mode")}
            icon={<IconEyeOff size={14} />}
            title="Demo mode"
            subtitle="Replace displayed emails with realistic fake data in this browser and reshape supported charts for presentations. Backend, agent integrations, and agent results stay real and access-scoped."
            flat
            open={openSection === "demo-mode"}
            onToggle={() => toggle("demo-mode")}
          >
            <DemoModeSection />
          </SettingsSection>
        )}

        {/* Automations */}
        {!isPage && shouldShowSection("automations") && (
          <SettingsSection
            id={settingsSectionDomId("automations")}
            icon={<IconBolt size={14} />}
            title="Automations"
            subtitle="Scheduled and event-triggered agent tasks."
            flat
            open={openSection === "automations"}
            onToggle={() => toggle("automations")}
          >
            <AutomationsSection />
          </SettingsSection>
        )}

        {/* API keys */}
        {shouldShowSection("secrets") && (
          <SettingsSection
            id={settingsSectionDomId("secrets")}
            icon={<IconKey size={14} />}
            title="API keys"
            subtitle="Service credentials and automation keys."
            flat
            open={openSection === "secrets"}
            onToggle={() => toggle("secrets")}
          >
            <SecretsSection focusKey={focusSecretKey} />
          </SettingsSection>
        )}

        {/* Hosting */}
        {!isPage && shouldShowSection("hosting") && (
          <SettingsSection
            id={settingsSectionDomId("hosting")}
            icon={<IconCloud size={14} />}
            title="Hosting"
            subtitle="Deploy your app to the cloud."
            flat
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
                docsUrl="https://www.builder.io/c/docs/agent-native-deployment?utm_source=agent-native&utm_medium=product&utm_campaign=onboarding&utm_content=deployment_settings"
                dim={connected}
              />
            </div>
          </SettingsSection>
        )}

        {/* Database */}
        {!isPage && shouldShowSection("database") && (
          <SettingsSection
            id={settingsSectionDomId("database")}
            icon={<IconDatabase size={14} />}
            title="Database"
            subtitle="Connect a cloud database for persistent storage."
            flat
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
                docsUrl="https://www.builder.io/c/docs/agent-native-database?utm_source=agent-native&utm_medium=product&utm_campaign=onboarding&utm_content=database_settings"
                dim={connected}
              />
            </div>
          </SettingsSection>
        )}

        {/* File uploads */}
        {!isPage && shouldShowSection("uploads") && (
          <SettingsSection
            id={settingsSectionDomId("uploads")}
            icon={<IconUpload size={14} />}
            title="File uploads"
            subtitle="Where user-uploaded files (avatars, chat attachments) are stored."
            flat
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
                hint="Object storage keeps uploaded files durable and their URLs reusable throughout the thread. Connect Builder or use an S3-compatible bucket below."
                docsUrl="https://www.builder.io/c/docs/agent-native-file-uploads?utm_source=agent-native&utm_medium=product&utm_campaign=onboarding&utm_content=file_upload_settings"
                dim={connected}
              >
                <FileStorageSettingsForm />
              </ManualSetupCard>
            </div>
          </SettingsSection>
        )}

        {/* Authentication */}
        {!isPage && shouldShowSection("auth") && (
          <SettingsSection
            id={settingsSectionDomId("auth")}
            icon={<IconShield size={14} />}
            title="Authentication"
            subtitle="Set up user authentication and access control."
            flat
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
                docsUrl="https://www.builder.io/c/docs/agent-native-authentication?utm_source=agent-native&utm_medium=product&utm_campaign=onboarding&utm_content=authentication_settings"
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
            flat
            connected={builderConnectionOwnedExternally ? undefined : connected}
            open={openSection === "browser"}
            onToggle={() => toggle("browser")}
          >
            {!builderConnectionOwnedExternally ? (
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
            ) : null}
          </SettingsSection>
        )}

        {!isPage &&
          builderBranchesAvailable &&
          shouldShowSection("background") && (
            <SettingsSection
              id={settingsSectionDomId("background")}
              icon={<IconGitBranch size={14} />}
              title="Background Agent"
              subtitle="Make code changes from production mode via Builder."
              flat
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
            flat
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
            flat
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
            flat
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

export function ConnectionsSettingsContent({
  settingsPanelProps,
}: {
  settingsPanelProps: SettingsPanelProps;
}) {
  return (
    <div className="w-full space-y-8">
      <Suspense fallback={null}>
        <IntegrationsPanel />
      </Suspense>
      <BuilderConnectCard trackingSource="settings_connections" />
      <SettingsPanelContent
        {...settingsPanelProps}
        surface="page"
        sections={INTEGRATION_SETTINGS_SECTIONS.filter(
          (section) => section !== "integrations" && section !== "usage",
        )}
        showCapabilityStrip={false}
        className="w-full"
        builderConnectionOwnedExternally
      />
    </div>
  );
}

export function AgentSettingsContent({
  className,
  sections = AGENT_SETTINGS_SECTIONS,
  agentAdditionalContent,
}: {
  className?: string;
  sections?: readonly SettingsSectionId[];
  agentAdditionalContent?: React.ReactNode;
} = {}) {
  const { isDevMode, canToggle, setDevMode } = useDevMode();
  const settingsPanelProps = useMemo<SettingsPanelProps>(
    () => ({
      isDevMode,
      onToggleDevMode: () => {
        void setDevMode(!isDevMode);
      },
      showDevToggle: canToggle,
    }),
    [canToggle, isDevMode, setDevMode],
  );

  return (
    <SettingsPanelContent
      {...settingsPanelProps}
      surface="page"
      sections={sections}
      showCapabilityStrip={false}
      className={cn("w-full", className)}
      agentAdditionalContent={agentAdditionalContent}
    />
  );
}

export function useAgentSettingsTabs(
  options: AgentSettingsTabsOptions = {},
): SettingsTabItem[] {
  const { isDevMode, canToggle, setDevMode } = useDevMode();
  const { data: org } = useOrg();
  const canManageOrg =
    !org?.orgId || org.role === "owner" || org.role === "admin";
  const extensionToolsEnabled = areExtensionSettingsEnabled(options);
  const agentAdditionalContent = options.agentAdditionalContent;
  const agentAdditionalTabFactories = options.agentAdditionalTabFactories ?? [];
  const usageAppId = options.usageAppId ?? null;
  const usageViewAllHref = options.usageViewAllHref;
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
  const additionalTabs = useMemo(
    () =>
      agentAdditionalTabFactories.map((factory) =>
        factory({
          scope: "user",
          canManageOrg,
          scopeControl: null,
        }),
      ),
    [agentAdditionalTabFactories, canManageOrg],
  );

  return useMemo<SettingsTabItem[]>(() => {
    const searchTabs = getAgentSettingsSearchTabs();
    const searchTab = (
      id: "agent" | "integrations" | "usage" | "organization" | "workspace",
    ) => {
      const tab = searchTabs.find((candidate) => candidate.id === id);
      if (!tab) throw new Error(`Missing agent workspace tab: ${id}`);
      return tab;
    };
    const agent = searchTab("agent");
    const integrations = searchTab("integrations");
    const usage = searchTab("usage");
    const organization = searchTab("organization");
    const workspace = searchTab("workspace");
    const overviewSearchEntries = (agent.searchEntries ?? []).filter(
      (entry) => entry.hash !== "automations" && entry.hash !== "a2a",
    );
    const resourceSearchEntries = [
      {
        id: "agent-resource-files",
        label: "Files",
        keywords: "files uploads documents context resources",
        description: "Agent resources",
        tabId: "agent:resources",
        hash: "agent:resources:files",
        icon: IconFolder,
      },
      {
        id: "agent-resource-instructions",
        label: "Instructions",
        keywords: "instructions agents md behavior context",
        description: "Agent resources",
        tabId: "agent:resources",
        hash: "agent:resources:instructions",
        icon: IconFolder,
      },
      {
        id: "agent-resource-memory",
        label: "Memory",
        keywords: "memory personalization context",
        description: "Agent resources",
        tabId: "agent:resources",
        hash: "agent:resources:memory",
        icon: IconFolder,
      },
      {
        id: "agent-resource-agents",
        label: "Agents",
        keywords: "agents custom agents delegate",
        description: "Agent resources",
        tabId: "agent:resources",
        hash: "agent:resources:agents",
        icon: IconFolder,
      },
      {
        id: "agent-resource-skills",
        label: "Skills",
        keywords: "skills tools capabilities",
        description: "Agent resources",
        tabId: "agent:resources",
        hash: "agent:resources:skills",
        icon: IconFolder,
      },
      {
        id: "agent-resource-learnings",
        label: "Learnings",
        keywords: "learnings feedback memory",
        description: "Agent resources",
        tabId: "agent:resources",
        hash: "agent:resources:learnings",
        icon: IconFolder,
      },
      {
        id: "agent-resource-remote-agents",
        label: "Remote agents",
        keywords: "remote agents connected a2a",
        description: "Agent resources",
        tabId: "agent:resources",
        hash: "agent:resources:remote-agents",
        icon: IconFolder,
      },
    ];
    return [
      {
        ...integrations,
        icon: IconPlugConnected,
        group: "integrations",
        content: <ConnectionsSettingsContent settingsPanelProps={baseProps} />,
      },
      {
        ...usage,
        icon: IconCoin,
        group: "integrations",
        content: (
          <div className="w-full">
            <UsageSection appId={usageAppId} viewAllHref={usageViewAllHref} />
          </div>
        ),
      },
      {
        ...organization,
        icon: IconUsersGroup,
        group: "workspace",
        content: (
          <div className="w-full">
            <TeamPage showTitle={false} />
          </div>
        ),
      },
      {
        ...workspace,
        icon: IconCloud,
        group: "workspace",
        content: (
          <SettingsPanelContent
            {...baseProps}
            surface="page"
            sections={WORKSPACE_SETTINGS_SECTIONS}
            showCapabilityStrip={false}
            className="w-full"
          />
        ),
      },
      ...(extensionToolsEnabled
        ? [
            {
              id: "extensions",
              label: "Extensions",
              icon: IconTool,
              group: "workspace" as const,
              keywords: "extensions widgets mini apps tools sandboxed apps",
              content: <ExtensionsSettingsContent />,
            },
          ]
        : []),
      {
        id: "agent",
        label: "Overview",
        icon: IconHierarchy2,
        group: "agent",
        keywords: agent.keywords,
        searchEntries: overviewSearchEntries,
        content: (
          <AgentWorkspaceContent
            activeTab="overview"
            overview={
              <AgentSettingsContent
                className="w-full"
                agentAdditionalContent={agentAdditionalContent}
                sections={AGENT_SETTINGS_SECTIONS.filter(
                  (section) => section !== "automations" && section !== "a2a",
                )}
              />
            }
          />
        ),
      },
      {
        id: "agent:resources",
        label: "Resources",
        icon: IconFolder,
        group: "agent",
        keywords:
          "resources files instructions agents memory skills learnings remote agents",
        searchEntries: resourceSearchEntries,
        content: (
          <AgentWorkspaceContent activeTab="resources" overview={null} />
        ),
      },
      {
        id: "agent:automations",
        label: "Automations",
        icon: IconBolt,
        group: "agent",
        keywords: "automations scheduled events cron jobs tasks",
        searchEntries: [
          {
            id: "section:automations",
            label: "Automations",
            keywords: "scheduled events cron jobs tasks",
            description: "Agent workflows",
            tabId: "agent:automations",
            hash: "agent:automations",
            icon: IconBolt,
          },
        ],
        content: (
          <AgentWorkspaceContent activeTab="automations" overview={null} />
        ),
      },
      {
        id: "agent:agents",
        label: "Connected agents",
        icon: IconTopologyRing2,
        group: "agent",
        keywords: "connected agents remote agents a2a delegate",
        searchEntries: [
          {
            id: "section:a2a",
            label: "Connected agents",
            keywords: "remote agents a2a delegate",
            description: "Agent access",
            tabId: "agent:agents",
            hash: "agent:agents",
            icon: IconTopologyRing2,
          },
        ],
        content: <AgentWorkspaceContent activeTab="agents" overview={null} />,
      },
      ...additionalTabs,
    ];
  }, [
    agentAdditionalContent,
    additionalTabs,
    baseProps,
    extensionToolsEnabled,
    usageAppId,
    usageViewAllHref,
  ]);
}
