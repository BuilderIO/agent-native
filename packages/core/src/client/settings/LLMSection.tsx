import { useState, useEffect, useCallback } from "react";
import {
  IconBrain,
  IconCheck,
  IconLoader2,
  IconExternalLink,
} from "@tabler/icons-react";
import { SettingsSection } from "./SettingsSection.js";
import { useBuilderStatus } from "./useBuilderStatus.js";

interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

export function LLMSection() {
  const { status: builder } = useBuilderStatus();
  const [envKeys, setEnvKeys] = useState<EnvKeyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchEnvStatus = useCallback(async () => {
    try {
      const res = await fetch("/_agent-native/env-status");
      if (!res.ok) return;
      setEnvKeys(await res.json());
    } catch {
      // env-status not configured
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEnvStatus();
  }, [fetchEnvStatus]);

  const anthropicKey = envKeys.find((k) => k.key === "ANTHROPIC_API_KEY");
  const isConfigured = anthropicKey?.configured ?? false;
  const builderConnected = builder?.configured ?? false;

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setSaved(false);
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
        fetchEnvStatus();
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
      subtitle="Provide an Anthropic API key or connect Builder to use their LLM proxy."
      connected={isConfigured || builderConnected}
    >
      <div className="space-y-3">
        {/* Builder path */}
        <div className="rounded-md border border-border px-2.5 py-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium text-foreground">
              Builder LLM Proxy
            </div>
            {builderConnected ? (
              <span className="flex items-center gap-1 text-[10px] text-green-500">
                <IconCheck size={10} />
                Connected
              </span>
            ) : builder?.connectUrl ? (
              <a
                href={builder.connectUrl}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium bg-accent text-foreground hover:bg-accent/80"
              >
                Connect Builder
                <IconExternalLink size={10} />
              </a>
            ) : null}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {builderConnected
              ? `Using Builder's LLM proxy${builder?.orgName ? ` (${builder.orgName})` : ""}`
              : "Use Builder's managed Anthropic proxy — no API key needed"}
          </p>
        </div>

        {/* Manual path */}
        <div className="rounded-md border border-border px-2.5 py-2">
          <div className="text-[11px] font-medium text-foreground mb-1.5">
            Own API Key
          </div>
          {loading ? (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <IconLoader2 size={10} className="animate-spin" />
              Checking...
            </div>
          ) : isConfigured ? (
            <div className="flex items-center gap-1.5 text-[10px] text-green-500">
              <IconCheck size={10} />
              ANTHROPIC_API_KEY configured
            </div>
          ) : (
            <div className="flex gap-1.5">
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
        </div>
      </div>
    </SettingsSection>
  );
}
