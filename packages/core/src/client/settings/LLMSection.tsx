import { useState, useEffect, useCallback } from "react";
import {
  IconBrain,
  IconCheck,
  IconLoader2,
  IconExternalLink,
  IconChevronDown,
} from "@tabler/icons-react";
import { SettingsSection } from "./SettingsSection.js";
import { useBuilderStatus } from "./useBuilderStatus.js";

interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

interface EngineInfo {
  name: string;
  label: string;
  description: string;
  defaultModel: string;
  supportedModels: string[];
  requiredEnvVars: string[];
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  "ai-sdk:openai": "OpenAI",
  "ai-sdk:google": "Google Gemini",
};

const KEY_PLACEHOLDERS: Record<string, string> = {
  ANTHROPIC_API_KEY: "sk-ant-...",
  OPENAI_API_KEY: "sk-...",
  GOOGLE_GENERATIVE_AI_API_KEY: "AI...",
};

const PROVIDER_DOCS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  "ai-sdk:openai": "https://platform.openai.com/api-keys",
  "ai-sdk:google": "https://aistudio.google.com/apikey",
};

const PRIMARY_PROVIDERS = ["anthropic", "ai-sdk:openai", "ai-sdk:google"];

const selectStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1,
};

export function LLMSection() {
  const { status: builder } = useBuilderStatus();
  const [envKeys, setEnvKeys] = useState<EnvKeyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [currentEngine, setCurrentEngine] = useState("anthropic");
  const [currentModel, setCurrentModel] = useState("");
  const [selectedEngine, setSelectedEngine] = useState("anthropic");
  const [selectedModel, setSelectedModel] = useState("");
  const [applyNote, setApplyNote] = useState(false);

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

  useEffect(() => {
    fetch("/_agent-native/actions/list-agent-engines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
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
      .catch(() => {});
  }, []);

  const builderConnected = builder?.configured ?? false;
  const selectedEngineInfo = engines.find((e) => e.name === selectedEngine);
  const envVar = selectedEngineInfo?.requiredEnvVars?.[0];
  const envConfigured = envVar
    ? (envKeys.find((k) => k.key === envVar)?.configured ?? false)
    : false;
  const anyKeyConfigured = envConfigured || builderConnected;
  const engineChanged =
    selectedEngine !== currentEngine || selectedModel !== currentModel;

  // Build provider options
  const providerOptions = PRIMARY_PROVIDERS.filter((name) =>
    engines.some((e) => e.name === name),
  );
  // Ensure selected engine is visible even if not in the current list
  if (
    !providerOptions.includes(selectedEngine) &&
    engines.some((e) => e.name === selectedEngine)
  ) {
    providerOptions.push(selectedEngine);
  }

  const modelOptions = selectedEngineInfo?.supportedModels ?? [];

  const handleSave = async () => {
    if (!apiKey.trim() || !envVar) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/_agent-native/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vars: [{ key: envVar, value: apiKey.trim() }],
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

  const handleApply = async () => {
    try {
      const res = await fetch("/_agent-native/actions/set-agent-engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine: selectedEngine,
          model: selectedModel,
        }),
      });
      if (res.ok) {
        setCurrentEngine(selectedEngine);
        setCurrentModel(selectedModel);
        setApplyNote(true);
        setTimeout(() => setApplyNote(false), 4000);
      }
    } catch {
      // ignore
    }
  };

  const docsUrl = PROVIDER_DOCS[selectedEngine];

  return (
    <SettingsSection
      icon={<IconBrain size={14} />}
      title="LLM"
      subtitle="Connect any major LLM — Claude, GPT, Gemini, and more."
      connected={anyKeyConfigured}
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
                target="_blank"
                rel="noopener noreferrer"
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
          <div className="text-[11px] font-medium text-foreground mb-1">
            Set up manually
          </div>
          <p className="text-[10px] text-muted-foreground mb-2">
            Choose your AI provider and model.
          </p>

          <div className="space-y-2">
            {/* Provider dropdown */}
            <div className="space-y-1.5">
              <p className="text-[12px] font-medium text-foreground">
                Provider
              </p>
              <div className="relative">
                <select
                  value={selectedEngine}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedEngine(val);
                    const info = engines.find((eng) => eng.name === val);
                    setSelectedModel(info?.defaultModel ?? "");
                    setApiKey("");
                  }}
                  className="flex h-9 w-full appearance-none items-center rounded-md border border-border bg-background px-3 pr-8 text-left text-[12px] text-foreground outline-none hover:bg-accent/40"
                  style={selectStyle}
                >
                  {providerOptions.map((name) => (
                    <option key={name} value={name}>
                      {PROVIDER_LABELS[name] ?? name}
                    </option>
                  ))}
                </select>
                <IconChevronDown
                  size={14}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
              </div>
            </div>

            {/* Model dropdown */}
            {modelOptions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[12px] font-medium text-foreground">Model</p>
                <div className="relative">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="flex h-9 w-full appearance-none items-center rounded-md border border-border bg-background px-3 pr-8 text-left text-[12px] text-foreground outline-none hover:bg-accent/40"
                    style={selectStyle}
                  >
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <IconChevronDown
                    size={14}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                </div>
              </div>
            )}

            {/* API key / status */}
            {loading ? (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <IconLoader2 size={10} className="animate-spin" />
                Checking...
              </div>
            ) : envVar && envConfigured ? (
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
                  placeholder={KEY_PLACEHOLDERS[envVar] ?? "..."}
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

            {/* Apply engine/model change */}
            {engineChanged && (
              <button
                onClick={handleApply}
                className="rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-foreground hover:bg-accent/80"
              >
                Apply
              </button>
            )}
            {applyNote && (
              <p className="text-[10px] text-muted-foreground">
                Changes take effect on next conversation
              </p>
            )}
          </div>

          {/* Docs link */}
          {docsUrl && (
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1.5 rounded border border-border px-2.5 py-1 text-[10px] font-medium no-underline text-muted-foreground hover:text-foreground hover:bg-accent/40"
            >
              Get an API key
              <IconExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
