import React, { Suspense, lazy } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import {
  IconChevronDown,
  IconCheck,
  IconExternalLink,
  IconCloud,
  IconDatabase,
  IconShield,
  IconPlugConnected,
} from "@tabler/icons-react";
import { LLMSection } from "./LLMSection.js";
import { BrowserSection } from "./BrowserSection.js";
import { BackgroundAgentSection } from "./BackgroundAgentSection.js";
import { ComingSoonSection } from "./ComingSoonSection.js";
import { AgentsSection } from "./AgentsSection.js";
import { SettingsSection } from "./SettingsSection.js";

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
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
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

      {/* Core setup sections */}
      <LLMSection />
      <BrowserSection />
      <BackgroundAgentSection />

      {/* Coming soon sections */}
      <ComingSoonSection
        icon={<IconCloud size={14} />}
        title="Hosting"
        description="Deploy your app to the cloud with one click."
        docsUrl="https://www.builder.io/c/docs/agent-native-deploy"
        manualHint="Deploy manually to Netlify, Vercel, Cloudflare, or any Nitro-supported target."
      />
      <ComingSoonSection
        icon={<IconDatabase size={14} />}
        title="Database"
        description="Connect a cloud database for persistent storage."
        docsUrl="https://www.builder.io/c/docs/agent-native-database"
        manualHint="Set DATABASE_URL in your .env to connect Neon, Supabase, Turso, or any Postgres/SQLite database."
      />
      <ComingSoonSection
        icon={<IconShield size={14} />}
        title="Authentication"
        description="Set up user authentication and access control."
        docsUrl="https://www.builder.io/c/docs/agent-native-auth"
        manualHint="Configure Better Auth with BETTER_AUTH_SECRET and optional Google/GitHub OAuth providers."
      />

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
