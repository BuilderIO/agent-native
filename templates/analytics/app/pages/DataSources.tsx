import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconLoader2,
  IconCircle,
  IconCopy,
  IconAlertCircle,
  IconUpload,
} from "@tabler/icons-react";
import { getIdToken } from "@/lib/auth";
import {
  dataSources,
  categoryLabels,
  categoryOrder,
  type DataSource,
  type DataSourceCategory,
  type WalkthroughStep,
} from "@/lib/data-sources";

interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

async function fetchEnvStatus(): Promise<EnvKeyStatus[]> {
  const token = await getIdToken();
  const res = await fetch("/api/credential-status", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  return res.json();
}

async function saveEnvVars(
  vars: Array<{ key: string; value: string }>,
): Promise<void> {
  const token = await getIdToken();
  const res = await fetch("/api/credentials", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ vars }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to save");
  }
}

async function testConnection(
  source: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getIdToken();
  const res = await fetch("/api/test-connection", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ source }),
  });
  return res.json();
}

function isSourceConnected(
  source: DataSource,
  envStatus: EnvKeyStatus[],
): boolean {
  const statusMap = new Map(envStatus.map((s) => [s.key, s.configured]));
  return source.envKeys.every((key) => statusMap.get(key) === true);
}

function StepItem({
  step,
  index,
  isComplete,
  isActive,
  inputValues,
  onInputChange,
}: {
  step: WalkthroughStep;
  index: number;
  isComplete: boolean;
  isActive: boolean;
  inputValues: Record<string, string>;
  onInputChange: (key: string, value: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !step.inputKey) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onInputChange(step.inputKey!, reader.result);
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  return (
    <div className="flex gap-3 py-3">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
            isComplete
              ? "bg-emerald-500/20 text-emerald-500"
              : isActive
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {isComplete ? <IconCheck className="h-3.5 w-3.5" /> : index + 1}
        </div>
      </div>
      <div className="flex-1 space-y-2">
        <p
          className={`text-sm font-medium ${isComplete ? "text-muted-foreground" : ""}`}
        >
          {step.title}
        </p>
        <p className="text-xs text-muted-foreground whitespace-pre-line">
          {step.description}
        </p>
        {step.url && (
          <a
            href={step.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            {step.linkText || "Open"} <IconExternalLink className="h-3 w-3" />
          </a>
        )}
        {step.inputKey && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                {step.inputLabel || step.inputKey}
              </label>
              {step.inputAcceptFile && (
                <label className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 cursor-pointer">
                  <IconUpload className="h-3 w-3" />
                  Upload file
                  <input
                    type="file"
                    accept={step.inputAcceptFile}
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            {step.inputType === "textarea" ? (
              <textarea
                value={inputValues[step.inputKey] || ""}
                onChange={(e) => onInputChange(step.inputKey!, e.target.value)}
                placeholder={step.inputPlaceholder}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 min-h-[80px] resize-y font-mono"
              />
            ) : (
              <input
                type={step.inputType || "text"}
                value={inputValues[step.inputKey] || ""}
                onChange={(e) => onInputChange(step.inputKey!, e.target.value)}
                placeholder={step.inputPlaceholder}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DataSourceCard({
  source,
  connected,
  onSaved,
}: {
  source: DataSource;
  connected: boolean;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);
  const totalSteps = source.walkthroughSteps.length;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const vars = Object.entries(inputValues)
        .filter(([, v]) => v.trim())
        .map(([key, value]) => ({ key, value: value.trim() }));
      if (vars.length === 0) return;
      await saveEnvVars(vars);
    },
    onSuccess: () => {
      setInputValues({});
      onSaved();
    },
  });

  const testMutation = useMutation({
    mutationFn: () => testConnection(source.id),
    onSuccess: (result) => setTestResult(result),
  });

  const Icon = source.icon;
  const hasInputValues = Object.values(inputValues).some((v) => v.trim());

  return (
    <Card className="bg-card border-border/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-sm font-medium">
                  {source.name}
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {source.description}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {connected ? (
                <span className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium">
                  <IconCheck className="h-3.5 w-3.5" />
                  Connected
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IconCircle className="h-3 w-3" />
                  Not connected
                </span>
              )}
              {expanded ? (
                <IconChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <IconChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent className="pt-0 border-t border-border/50">
          {/* Step progress */}
          <div className="flex items-center gap-1.5 py-3">
            {source.walkthroughSteps.map((_, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentStep(i);
                }}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i < currentStep
                    ? "bg-emerald-500/60"
                    : i === currentStep
                      ? "bg-primary"
                      : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* Current step */}
          {(() => {
            const step = source.walkthroughSteps[currentStep];
            const isComplete =
              step.inputKey && connected && !inputValues[step.inputKey];
            return (
              <StepItem
                key={currentStep}
                step={step}
                index={currentStep}
                isComplete={!!isComplete}
                isActive={!isComplete}
                inputValues={inputValues}
                onInputChange={(key, value) =>
                  setInputValues((prev) => ({ ...prev, [key]: value }))
                }
              />
            );
          })()}

          {/* Step navigation */}
          <div className="flex items-center gap-2 pt-2 pb-4">
            {currentStep > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentStep((s) => s - 1);
                }}
                className="text-xs"
              >
                Back
              </Button>
            )}
            {currentStep < totalSteps - 1 && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentStep((s) => s + 1);
                }}
                className="text-xs"
              >
                Continue
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 pt-4 border-t border-border/30">
            {hasInputValues && (
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  saveMutation.mutate();
                }}
                disabled={saveMutation.isPending}
                className="text-xs"
              >
                {saveMutation.isPending ? (
                  <>
                    <IconLoader2 className="h-3 w-3 animate-spin mr-1.5" />
                    Saving...
                  </>
                ) : (
                  "Save Credentials"
                )}
              </Button>
            )}
            {connected && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setTestResult(null);
                  testMutation.mutate();
                }}
                disabled={testMutation.isPending}
                className="text-xs"
              >
                {testMutation.isPending ? (
                  <>
                    <IconLoader2 className="h-3 w-3 animate-spin mr-1.5" />
                    Testing...
                  </>
                ) : (
                  "Test Connection"
                )}
              </Button>
            )}
            {source.docsUrl && (
              <a
                href={source.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 ml-auto"
                onClick={(e) => e.stopPropagation()}
              >
                Docs <IconExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {saveMutation.isError && (
            <div className="mt-3 flex items-center gap-2 text-xs text-destructive">
              <IconAlertCircle className="h-3.5 w-3.5" />
              {(saveMutation.error as Error).message}
            </div>
          )}
          {saveMutation.isSuccess && (
            <div className="mt-3 flex items-center gap-2 text-xs text-emerald-500">
              <IconCheck className="h-3.5 w-3.5" />
              Credentials saved.
            </div>
          )}
          {testResult && (
            <div
              className={`mt-3 flex items-center gap-2 text-xs ${testResult.ok ? "text-emerald-500" : "text-destructive"}`}
            >
              {testResult.ok ? (
                <>
                  <IconCheck className="h-3.5 w-3.5" />
                  Connection successful
                </>
              ) : (
                <>
                  <IconAlertCircle className="h-3.5 w-3.5" />
                  {testResult.error || "Connection failed"}
                </>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function DataSources() {
  const queryClient = useQueryClient();

  const { data: envStatus = [] } = useQuery({
    queryKey: ["env-status"],
    queryFn: fetchEnvStatus,
    staleTime: 10_000,
  });

  const connectedCount = dataSources.filter((s) =>
    isSourceConnected(s, envStatus),
  ).length;

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["env-status"] });
  };

  return (
    <Layout>
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Data Sources</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your data sources, then ask the agent to create dashboards.{" "}
            {connectedCount > 0 && (
              <span className="text-emerald-500 font-medium">
                {connectedCount} connected
              </span>
            )}
          </p>
        </div>

        {categoryOrder.map((category) => {
          const sources = dataSources.filter((s) => s.category === category);
          if (sources.length === 0) return null;
          return (
            <div key={category} className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {categoryLabels[category]}
              </h3>
              <div className="grid gap-3">
                {sources.map((source) => (
                  <DataSourceCard
                    key={source.id}
                    source={source}
                    connected={isSourceConnected(source, envStatus)}
                    onSaved={handleSaved}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
