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
  IconTopologyRing2,
  IconLoader2,
  IconUpload,
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

// ─── "Connect Builder.io" card (shared across all sections) ─────────────────

function UseBuilderCard({
  connectUrl,
  connected,
  orgName,
  comingSoon,
  builderEnabled,
  label = "Connect Builder.io",
  dim,
}: {
  connectUrl?: string;
  connected: boolean;
  orgName?: string;
  comingSoon?: boolean;
  builderEnabled?: boolean;
  label?: string;
  dim?: boolean;
}) {
  const showComingSoon = comingSoon && !builderEnabled;
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
        {connectUrl && (
          <a
            href={connectUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2.5 rounded border border-border px-2 py-0.5 text-[10px] no-underline text-muted-foreground hover:text-foreground hover:bg-accent/40"
          >
            Reconnect
            <IconExternalLink size={10} />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-md border border-border px-2.5 py-2 ${bgClass}`}>
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium text-foreground">
          Connect Builder.io
        </div>
        {showComingSoon && (
          <span className="rounded-full bg-accent/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Coming soon
          </span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        Includes LLM, DB, Auth, hosting, & more
      </p>
      {showComingSoon ? (
        <a
          href="https://forms.gle/WGpRR5ENCwEppFWL7"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-2.5 rounded bg-foreground px-2.5 py-1 text-[10px] font-medium no-underline text-background hover:opacity-90"
        >
          Join the waitlist
          <IconExternalLink size={10} />
        </a>
      ) : (
        connectUrl && (
          <a
            href={connectUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2.5 rounded bg-foreground px-2.5 py-1 text-[10px] font-medium no-underline text-background hover:opacity-90"
          >
            {label}
            <IconExternalLink size={10} />
          </a>
        )
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
  dim,
}: {
  hint?: string;
  docsUrl?: string;
  docsLabel?: string;
  children?: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <div
      className={`rounded-md border border-border px-2.5 py-2 ${dim ? "" : "bg-accent/30"}`}
    >
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
          className="inline-flex items-center gap-1 mt-1.5 rounded border border-border px-2.5 py-1 text-[10px] font-medium no-underline text-muted-foreground hover:text-foreground hover:bg-accent/40"
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
  builderEnabled,
  connectUrl,
  connected,
  orgName,
  open,
  onToggle,
}: {
  builderEnabled: boolean;
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
      subtitle="Connect any major LLM — Claude, GPT, Gemini, and more."
      required
      connected={anthropicConfigured || connected}
      open={open}
      onToggle={onToggle}
    >
      <div className="space-y-2">
        <UseBuilderCard
          connectUrl={connectUrl}
          connected={connected}
          orgName={orgName}
          comingSoon
          builderEnabled={builderEnabled}
          label="Connect Builder.io"
        />
        <ManualSetupCard
          hint="Paste your Anthropic API key to power the agent chat."
          docsUrl="https://console.anthropic.com/settings/keys"
          docsLabel="Get an API key"
          dim={connected}
        >
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

  // ENABLE_BUILDER flag — read from env-status (always available)
  const [builderEnabled, setBuilderEnabled] = useState(false);
  useEffect(() => {
    fetch("/_agent-native/env-status")
      .then((r) => (r.ok ? r.json() : []))
      .then((keys: Array<{ key: string; configured: boolean }>) => {
        if (keys.find((k) => k.key === "ENABLE_BUILDER")?.configured) {
          setBuilderEnabled(true);
        }
      })
      .catch(() => {});
  }, []);

  // Accordion: only one section open at a time (null = all closed)
  const [openSection, setOpenSection] = useState<string | null>("llm");
  const toggle = (id: string) =>
    setOpenSection((prev) => (prev === id ? null : id));

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
        builderEnabled={builderEnabled}
        connectUrl={connectUrl}
        connected={connected}
        orgName={orgName}
        open={openSection === "llm"}
        onToggle={() => toggle("llm")}
      />

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
            comingSoon
            builderEnabled={builderEnabled}
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
            comingSoon
            builderEnabled={builderEnabled}
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
            comingSoon
            builderEnabled={builderEnabled}
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
            comingSoon
            builderEnabled={builderEnabled}
          />
          <ManualSetupCard
            hint="Configure Better Auth with BETTER_AUTH_SECRET and optional Google/GitHub OAuth providers."
            docsUrl="https://www.builder.io/c/docs/agent-native-authentication"
            dim={connected}
          />
        </div>
      </SettingsSection>

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
          comingSoon
          builderEnabled={builderEnabled}
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
          comingSoon
          builderEnabled={builderEnabled}
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
