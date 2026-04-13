import React, { Suspense, lazy, useState, useEffect } from "react";
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
  IconLoader2,
} from "@tabler/icons-react";
import { SettingsSection } from "./SettingsSection.js";
import { useBuilderStatus } from "./useBuilderStatus.js";
import { AgentsSection } from "./AgentsSection.js";

const IntegrationsPanel = lazy(() =>
  import("../integrations/IntegrationsPanel.js").then((m) => ({
    default: m.IntegrationsPanel,
  })),
);

// ─── Shared helpers ─────────────────────────────────────────────────────────

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
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: SettingsSelectOption[];
  onValueChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-foreground">{label}</p>
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

// ─── "Use Builder" card (shared across all sections) ────────────────────────

function UseBuilderCard({
  connectUrl,
  connected,
  orgName,
  comingSoon,
  demoMode,
  label = "Connect Builder.io",
}: {
  connectUrl?: string;
  connected: boolean;
  orgName?: string;
  comingSoon?: boolean;
  demoMode?: boolean;
  label?: string;
}) {
  // In demo mode, never show "Coming soon"
  const showComingSoon = comingSoon && !demoMode;

  if (connected) {
    return (
      <div className="rounded-md border border-border px-2.5 py-2">
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
        {connectUrl && (
          <a
            href={connectUrl}
            className="inline-flex items-center gap-1 mt-1.5 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40"
          >
            Reconnect
            <IconExternalLink size={10} />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border px-2.5 py-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium text-foreground">
          Use Builder
        </div>
        {showComingSoon && (
          <span className="rounded-full bg-accent/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Coming soon
          </span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        One-click setup via Builder.io
      </p>
      {connectUrl && !showComingSoon && (
        <a
          href={connectUrl}
          className="inline-flex items-center gap-1 mt-1.5 rounded bg-foreground px-2.5 py-1 text-[10px] font-medium text-background hover:opacity-90"
        >
          {label}
          <IconExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

// ─── Manual setup card ──────────────────────────────────────────────────────

function ManualSetupCard({
  hint,
  docsUrl,
  docsLabel = "Read the docs",
  children,
}: {
  hint?: string;
  docsUrl?: string;
  docsLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border px-2.5 py-2">
      <div className="text-[11px] font-medium text-foreground mb-1">
        Set up manually
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
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {docsLabel}
          <IconExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

// ─── LLM Section ────────────────────────────────────────────────────────────

function LLMSectionInner({
  demoMode,
  connectUrl,
  connected,
  orgName,
}: {
  demoMode: boolean;
  connectUrl?: string;
  connected: boolean;
  orgName?: string;
}) {
  const [envKeys, setEnvKeys] = useState<
    Array<{ key: string; configured: boolean }>
  >([]);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/_agent-native/env-status")
      .then((r) => (r.ok ? r.json() : []))
      .then(setEnvKeys)
      .catch(() => {});
  }, [saved]);

  const anthropicConfigured =
    envKeys.find((k) => k.key === "ANTHROPIC_API_KEY")?.configured ?? false;

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/_agent-native/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vars: [{ key: "ANTHROPIC_API_KEY", value: apiKey.trim() }],
        }),
      });
      if (res.ok) {
        setSaved(true);
        setApiKey("");
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      icon={<IconBrain size={14} />}
      title="LLM"
      subtitle="AI model for the agent chat."
      connected={anthropicConfigured || connected}
    >
      <div className="space-y-2">
        <UseBuilderCard
          connectUrl={connectUrl}
          connected={connected}
          orgName={orgName}
          comingSoon
          demoMode={demoMode}
          label="Connect Builder.io"
        />
        <ManualSetupCard>
          {anthropicConfigured ? (
            <div className="flex items-center gap-1.5 text-[10px] text-green-500 mb-1">
              <IconCheck size={10} />
              ANTHROPIC_API_KEY configured
            </div>
          ) : (
            <div className="flex gap-1.5 mb-1">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                placeholder="sk-ant-..."
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
          )}
        </ManualSetupCard>
      </div>
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
  const { status: builder } = useBuilderStatus();
  const connected = builder?.configured ?? false;
  const connectUrl = builder?.connectUrl;
  const orgName = builder?.orgName;

  // Demo mode: driven by DEMO_MODE env var, exposed via env-status or a dedicated endpoint.
  // For now, check at load time.
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => {
    fetch("/_agent-native/env-status")
      .then((r) => (r.ok ? r.json() : []))
      .then((keys: Array<{ key: string; configured: boolean }>) => {
        const dm = keys.find((k) => k.key === "DEMO_MODE");
        if (dm?.configured) setDemoMode(true);
      })
      .catch(() => {});
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
              value={isDevMode ? "development" : "production"}
              options={environmentOptions}
              onValueChange={(next) => {
                const nextIsDev = next === "development";
                if (nextIsDev !== isDevMode) onToggleDevMode();
              }}
            />
          )}
          {devAppUrl && (
            <a
              href={devAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <IconExternalLink size={12} />
              Open app in new tab
            </a>
          )}
        </div>
      )}

      {/* LLM */}
      <LLMSectionInner
        demoMode={demoMode}
        connectUrl={connectUrl}
        connected={connected}
        orgName={orgName}
      />

      {/* Browser Automation */}
      <SettingsSection
        icon={<IconBrowser size={14} />}
        title="Browser Automation"
        subtitle="Let agents control a real browser for web tasks."
        connected={connected}
      >
        <UseBuilderCard
          connectUrl={connectUrl}
          connected={connected}
          orgName={orgName}
          demoMode={demoMode}
        />
      </SettingsSection>

      {/* Background Agent */}
      <SettingsSection
        icon={<IconGitBranch size={14} />}
        title="Background Agent"
        subtitle="Make code changes from production mode via Builder."
        connected={connected}
      >
        <UseBuilderCard
          connectUrl={connectUrl}
          connected={connected}
          orgName={orgName}
          demoMode={demoMode}
        />
      </SettingsSection>

      {/* Hosting */}
      <SettingsSection
        icon={<IconCloud size={14} />}
        title="Hosting"
        subtitle="Deploy your app to the cloud."
      >
        <div className="space-y-2">
          <UseBuilderCard
            connectUrl={connectUrl}
            connected={connected}
            orgName={orgName}
            comingSoon
            demoMode={demoMode}
          />
          <ManualSetupCard
            hint="Deploy manually to Netlify, Vercel, Cloudflare, or any Nitro-supported target."
            docsUrl="https://www.builder.io/c/docs/agent-native-deploy"
          />
        </div>
      </SettingsSection>

      {/* Database */}
      <SettingsSection
        icon={<IconDatabase size={14} />}
        title="Database"
        subtitle="Connect a cloud database for persistent storage."
      >
        <div className="space-y-2">
          <UseBuilderCard
            connectUrl={connectUrl}
            connected={connected}
            orgName={orgName}
            comingSoon
            demoMode={demoMode}
          />
          <ManualSetupCard
            hint="Set DATABASE_URL in your .env to connect Neon, Supabase, Turso, or any Postgres/SQLite database."
            docsUrl="https://www.builder.io/c/docs/agent-native-database"
          />
        </div>
      </SettingsSection>

      {/* Authentication */}
      <SettingsSection
        icon={<IconShield size={14} />}
        title="Authentication"
        subtitle="Set up user authentication and access control."
      >
        <div className="space-y-2">
          <UseBuilderCard
            connectUrl={connectUrl}
            connected={connected}
            orgName={orgName}
            comingSoon
            demoMode={demoMode}
          />
          <ManualSetupCard
            hint="Configure Better Auth with BETTER_AUTH_SECRET and optional Google/GitHub OAuth providers."
            docsUrl="https://www.builder.io/c/docs/agent-native-auth"
          />
        </div>
      </SettingsSection>

      {/* Integrations */}
      <SettingsSection
        icon={<IconPlugConnected size={14} />}
        title="Integrations"
        subtitle="Connect messaging platforms and external services."
      >
        <Suspense fallback={null}>
          <IntegrationsPanel />
        </Suspense>
      </SettingsSection>

      {/* A2A Agents */}
      <SettingsSection
        icon={<IconPlugConnected size={14} />}
        title="Connected Agents (A2A)"
        subtitle="Manage remote agents connected via the A2A protocol."
      >
        <AgentsSection />
      </SettingsSection>
    </div>
  );
}
