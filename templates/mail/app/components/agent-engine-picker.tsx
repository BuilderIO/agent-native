import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  IconCheck,
  IconLoader2,
  IconCircleCheck,
  IconAlertCircle,
  IconPlayerPlay,
  IconCpu,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EngineCapabilities {
  thinking: boolean;
  promptCaching: boolean;
  vision: boolean;
  computerUse: boolean;
  parallelToolCalls: boolean;
}

interface EngineEntry {
  name: string;
  label: string;
  description: string;
  defaultModel: string;
  supportedModels: readonly string[];
  capabilities: EngineCapabilities;
  requiredEnvVars: string[];
  installPackage?: string;
}

interface EnginesResponse {
  engines: EngineEntry[];
  current: { engine: string; model: string };
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function postAction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/_agent-native/actions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || `Request failed (${res.status})`);
  }
  const text = await res.text();
  try {
    // The script returns a JSON string as the result
    const outer = JSON.parse(text);
    if (typeof outer === "string") return JSON.parse(outer) as T;
    return outer as T;
  } catch {
    return text as unknown as T;
  }
}

// ─── Capability badge ─────────────────────────────────────────────────────────

function CapBadge({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        enabled
          ? "bg-emerald-500/15 text-emerald-400"
          : "bg-muted/30 text-muted-foreground/30 line-through",
      )}
    >
      {label}
    </span>
  );
}

// ─── Engine card ──────────────────────────────────────────────────────────────

function EngineCard({
  engine,
  isSelected,
  selectedModel,
  onSelect,
}: {
  engine: EngineEntry;
  isSelected: boolean;
  selectedModel: string;
  onSelect: (model: string) => void;
}) {
  const caps = engine.capabilities;
  const missingEnv = engine.requiredEnvVars.filter(
    (v) => !import.meta.env?.[v],
  );

  return (
    <button
      onClick={() => onSelect(selectedModel || engine.defaultModel)}
      className={cn(
        "w-full rounded-lg border text-left p-4 transition-colors",
        isSelected
          ? "border-indigo-500/50 bg-indigo-500/5"
          : "border-border/30 bg-card hover:border-border/60",
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[13px] font-semibold text-foreground">
              {engine.label}
            </span>
            {isSelected && (
              <IconCheck className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/60 font-mono">
            {engine.name}
          </p>
        </div>
      </div>

      <p className="text-[12px] text-muted-foreground mb-3 line-clamp-2">
        {engine.description}
      </p>

      <div className="flex flex-wrap gap-1 mb-3">
        <CapBadge label="thinking" enabled={caps.thinking} />
        <CapBadge label="caching" enabled={caps.promptCaching} />
        <CapBadge label="vision" enabled={caps.vision} />
        <CapBadge label="parallel tools" enabled={caps.parallelToolCalls} />
      </div>

      {engine.requiredEnvVars.length > 0 && (
        <p className="text-[11px] text-muted-foreground/40 font-mono">
          Requires: {engine.requiredEnvVars.join(", ")}
        </p>
      )}

      {engine.installPackage && (
        <p className="text-[11px] text-muted-foreground/30 font-mono mt-0.5">
          Install: pnpm add {engine.installPackage}
        </p>
      )}
    </button>
  );
}

// ─── AgentEnginePicker ────────────────────────────────────────────────────────

export function AgentEnginePicker() {
  const qc = useQueryClient();
  const [localEngine, setLocalEngine] = useState<string | null>(null);
  const [localModel, setLocalModel] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    error?: string;
  } | null>(null);

  // Fetch engine list
  const { data, isLoading, error } = useQuery<EnginesResponse>({
    queryKey: ["agent-engines"],
    queryFn: () => postAction<EnginesResponse>("list-agent-engines", {}),
    staleTime: 30_000,
  });

  // Set engine mutation
  const setEngine = useMutation({
    mutationFn: ({ engine, model }: { engine: string; model: string }) =>
      postAction("set-agent-engine", { engine, model }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-engines"] });
      setLocalEngine(null);
      setLocalModel(null);
      setTestResult(null);
    },
  });

  // Test engine mutation
  const testEngine = useMutation({
    mutationFn: ({ engine, model }: { engine: string; model: string }) =>
      postAction<{ ok: boolean; latencyMs?: number; error?: string }>(
        "test-agent-engine",
        { engine, model },
      ),
    onSuccess: (result) => {
      setTestResult(result);
    },
    onError: (err: Error) => {
      setTestResult({ ok: false, error: err.message });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground/50">
        <IconLoader2 className="h-4 w-4 animate-spin" />
        <span className="text-[13px]">Loading engines…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-[13px] text-destructive/70">
        Failed to load engine list. Make sure the server is running.
      </div>
    );
  }

  const { engines, current } = data;
  const activeEngine = localEngine ?? current.engine;
  const engineEntry = engines.find((e) => e.name === activeEngine);
  const activeModel =
    localModel ??
    (activeEngine === current.engine
      ? current.model
      : (engineEntry?.defaultModel ?? ""));

  const isDirty =
    activeEngine !== current.engine || activeModel !== current.model;

  const handleEngineSelect = (name: string, model?: string) => {
    const entry = engines.find((e) => e.name === name);
    setLocalEngine(name);
    setLocalModel(model ?? entry?.defaultModel ?? "");
    setTestResult(null);
  };

  const handleSave = () => {
    setEngine.mutate({ engine: activeEngine, model: activeModel });
  };

  const handleTest = () => {
    testEngine.mutate({ engine: activeEngine, model: activeModel });
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* Current status */}
      <div className="flex items-center gap-3 rounded-lg border border-border/30 bg-muted/30 px-4 py-3">
        <IconCpu className="h-4 w-4 text-indigo-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-foreground">
            Active engine
          </p>
          <p className="text-[11px] text-muted-foreground font-mono">
            {current.engine} / {current.model}
          </p>
        </div>
        {isDirty && (
          <Badge
            variant="outline"
            className="text-[10px] text-amber-400 border-amber-500/30"
          >
            unsaved
          </Badge>
        )}
      </div>

      {/* Engine cards */}
      <div>
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Select engine
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {engines.map((engine) => (
            <EngineCard
              key={engine.name}
              engine={engine}
              isSelected={activeEngine === engine.name}
              selectedModel={
                activeEngine === engine.name ? activeModel : engine.defaultModel
              }
              onSelect={(model) => handleEngineSelect(engine.name, model)}
            />
          ))}
        </div>
      </div>

      {/* Model picker */}
      {engineEntry && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Model
          </p>
          <Select
            value={activeModel}
            onValueChange={(v) => {
              setLocalModel(v);
              setTestResult(null);
            }}
          >
            <SelectTrigger className="w-full max-w-xs text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {engineEntry.supportedModels.map((m) => (
                <SelectItem key={m} value={m} className="text-[13px] font-mono">
                  {m}
                  {m === engineEntry.defaultModel && (
                    <span className="ml-2 text-[10px] text-muted-foreground/50">
                      default
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Test result */}
      {testResult && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border px-4 py-3 text-[13px]",
            testResult.ok
              ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
              : "border-destructive/20 bg-destructive/5 text-destructive/70",
          )}
        >
          {testResult.ok ? (
            <IconCircleCheck className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <IconAlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <div>
            {testResult.ok ? (
              <p>Connected — {testResult.latencyMs}ms response time</p>
            ) : (
              <p>{testResult.error ?? "Connection failed"}</p>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isDirty || setEngine.isPending}
        >
          {setEngine.isPending && (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          {setEngine.isSuccess && !isDirty ? (
            <>
              <IconCheck className="h-3.5 w-3.5" />
              Saved
            </>
          ) : (
            "Save"
          )}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testEngine.isPending}
        >
          {testEngine.isPending ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <IconPlayerPlay className="h-3.5 w-3.5" />
          )}
          Test connection
        </Button>
      </div>

      {setEngine.isSuccess && !isDirty && (
        <p className="text-[12px] text-emerald-400">
          Engine saved. Takes effect on the next conversation.
        </p>
      )}

      {setEngine.error && (
        <p className="text-[12px] text-destructive/70">
          {(setEngine.error as Error).message}
        </p>
      )}
    </div>
  );
}
