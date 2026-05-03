import { useEffect, useMemo, useState } from "react";
import {
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconCode,
  IconKey,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { agentNativePath, appBasePath } from "./api-path.js";
import { sendToAgentChat } from "./agent-chat.js";
import { isInBuilderFrame } from "./builder-frame.js";
import { useDevMode } from "./use-dev-mode.js";
import { getWorkspaceAppIdValidationError } from "../shared/workspace-app-id.js";

export interface VaultSecretOption {
  id: string;
  name: string;
  credentialKey: string;
  provider?: string | null;
  description?: string | null;
}

export interface NewWorkspaceAppFlowProps {
  sourceApp?: string;
  className?: string;
  dispatchBasePath?: string | null;
}

const TEMPLATE_OPTIONS = [
  { value: "starter", label: "Starter" },
  { value: "analytics", label: "Analytics" },
  { value: "calendar", label: "Calendar" },
  { value: "content", label: "Content" },
  { value: "design", label: "Design" },
  { value: "dispatch", label: "Dispatch" },
  { value: "forms", label: "Forms" },
  { value: "mail", label: "Mail" },
  { value: "slides", label: "Slides" },
  { value: "videos", label: "Videos" },
  { value: "clips", label: "Clips" },
] as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 48);
}

function titleFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/\b(build|create|make|an?|the|app|tool|dashboard)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return slugify(cleaned || "new-app") || "new-app";
}

function actionUrl(basePath: string | null, action: string): string {
  const path = `/_agent-native/actions/${action}`;
  if (basePath === null) return agentNativePath(path);
  const normalized = basePath.replace(/\/+$/, "");
  return `${normalized}${path}`;
}

function defaultDispatchBasePath(sourceApp?: string): string | null {
  if (sourceApp === "dispatch") return null;
  const base = appBasePath();
  if (base === "/dispatch") return null;
  return "/dispatch";
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      data?.error || data?.message || `Request failed ${res.status}`,
    );
  }
  return data;
}

function buildNewWorkspaceAppPrompt(input: {
  appId: string;
  prompt: string;
  template: string;
  selectedKeys: string[];
}): string {
  const keyList = input.selectedKeys.join(", ");
  const grantRequest = keyList
    ? `Requested Dispatch vault key grants for this app: ${keyList}`
    : `Requested Dispatch vault key grants for this app: none`;

  return [
    `Create a new agent-native app in this workspace.`,
    ``,
    `App name: ${input.appId}`,
    `Template to start from: ${input.template}`,
    `User prompt: ${input.prompt.trim()}`,
    grantRequest,
    ``,
    `Use the workspace app layout: create it under apps/${input.appId}, mount it at /${input.appId}, keep it on the shared workspace database/hosting model, and avoid table-name collisions by namespacing any new domain tables to the app.`,
    keyList
      ? `After the app exists, grant the selected Dispatch vault keys to appId "${input.appId}" and sync them once the app server is available. Treat these as requested grants, not active grants before creation succeeds.`
      : `Do not grant any Dispatch vault keys unless the user asks later.`,
    ``,
    `App readiness requirements before handing off:`,
    `- Update the workspace app registry metadata for "${input.appId}" (workspace-apps.json or .agent-native/workspace-apps.json, whichever this workspace uses) so Dispatch lists the app at /${input.appId} after merge/deploy.`,
    `- Update the app manifest/package/deploy metadata needed by the existing workspace deployment model; do not leave the app relying only on local discovery.`,
    `- Verify the app's agent card/A2A metadata is ready so Dispatch can discover and delegate to the app after deployment.`,
    `- Include a final verification note covering the registry entry, manifest/deploy metadata, and agent-card readiness.`,
    `When it is ready, start or update the workspace dev server and navigate the user to /${input.appId}.`,
  ].join("\n");
}

export function NewWorkspaceAppFlow({
  sourceApp = "starter",
  className = "",
  dispatchBasePath,
}: NewWorkspaceAppFlowProps) {
  const [prompt, setPrompt] = useState("");
  const [appName, setAppName] = useState("");
  const [template, setTemplate] =
    useState<(typeof TEMPLATE_OPTIONS)[number]["value"]>("starter");
  const [selectedSecretIds, setSelectedSecretIds] = useState<string[]>([]);
  const [secrets, setSecrets] = useState<VaultSecretOption[]>([]);
  const [secretsError, setSecretsError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [branchUrl, setBranchUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isDevMode } = useDevMode();

  const effectiveDispatchBasePath =
    dispatchBasePath === undefined
      ? defaultDispatchBasePath(sourceApp)
      : dispatchBasePath;

  useEffect(() => {
    let cancelled = false;
    const url = actionUrl(
      effectiveDispatchBasePath,
      "list-vault-secret-options",
    );
    fetchJson(url)
      .then((data) => {
        if (cancelled) return;
        setSecrets(Array.isArray(data) ? data : []);
        setSecretsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setSecrets([]);
        setSecretsError(err?.message || "Could not load Dispatch keys");
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveDispatchBasePath]);

  useEffect(() => {
    if (appName || !prompt.trim()) return;
    setAppName(titleFromPrompt(prompt));
  }, [prompt, appName]);

  const selectedSecrets = useMemo(
    () => secrets.filter((secret) => selectedSecretIds.includes(secret.id)),
    [secrets, selectedSecretIds],
  );
  const selectedSecretLabel =
    selectedSecretIds.length === 0
      ? "No keys selected"
      : `${selectedSecretIds.length} key${selectedSecretIds.length === 1 ? "" : "s"} selected`;
  const hasAppNameCandidate =
    appName.trim().length > 0 || prompt.trim().length > 0;
  const safeAppName = slugify(appName) || titleFromPrompt(prompt);
  const appNameError = hasAppNameCandidate
    ? getWorkspaceAppIdValidationError(safeAppName)
    : null;

  const canSubmit =
    prompt.trim().length > 0 && safeAppName.length > 0 && !appNameError;
  const submitShortcut =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
      ? "⌘"
      : "Ctrl";

  function buildMessage(): string {
    return buildNewWorkspaceAppPrompt({
      appId: safeAppName,
      prompt,
      template,
      selectedKeys: selectedSecrets.map((s) => s.credentialKey),
    });
  }

  async function submit() {
    if (!canSubmit || isSubmitting) return;
    const validationError = getWorkspaceAppIdValidationError(safeAppName);
    if (validationError) {
      setStatusMessage(validationError);
      return;
    }
    const message = buildMessage();
    setIsSubmitting(true);
    setStatusMessage(null);
    setBranchUrl(null);

    try {
      if (isInBuilderFrame()) {
        sendToAgentChat({ message, submit: true, type: "code" });
        setStatusMessage("Sent to Builder chat.");
      } else if (isDevMode) {
        sendToAgentChat({ message, submit: true, type: "code", newTab: true });
        setStatusMessage("Sent to the local agent.");
      } else {
        const result = await fetchJson(
          actionUrl(effectiveDispatchBasePath, "start-workspace-app-creation"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: prompt.trim(),
              appId: safeAppName,
              template,
              secretIds: selectedSecretIds,
            }),
          },
        );
        if (result?.mode === "builder") {
          setBranchUrl(result?.url || null);
          setStatusMessage("Builder branch created.");
        } else {
          setStatusMessage(
            result?.message ||
              "Builder app creation is coming soon here. Open this workspace in Builder to create an app from this prompt.",
          );
        }
      }
    } catch (err: any) {
      setStatusMessage(err?.message || "Could not start the new app flow.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleSecret(id: string) {
    setSelectedSecretIds((current) =>
      current.includes(id)
        ? current.filter((existing) => existing !== id)
        : [...current, id],
    );
  }

  return (
    <section
      className={`mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 ${className}`}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <IconPlus className="h-4 w-4" />
              New app
            </div>
          </div>
          <div className="space-y-4 p-4">
            <label className="block space-y-2">
              <span className="text-xs font-medium text-muted-foreground">
                Prompt
              </span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Describe the app your teammate should be able to use..."
                rows={6}
                className="min-h-36 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-xs font-medium text-muted-foreground">
                  App path
                </span>
                <input
                  value={appName}
                  onChange={(e) => setAppName(slugify(e.target.value))}
                  placeholder="customer-health"
                  className={`h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring ${
                    appNameError ? "border-destructive" : "border-input"
                  }`}
                />
                {appNameError ? (
                  <span className="block text-xs text-destructive">
                    {appNameError}
                  </span>
                ) : null}
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Starter template
                </span>
                <select
                  value={template}
                  onChange={(e) =>
                    setTemplate(e.target.value as typeof template)
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                >
                  {TEMPLATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3">
              <span className="text-[11px] text-muted-foreground/75">
                {submitShortcut}+Enter to submit
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit || isSubmitting}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSubmitting ? (
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <IconCode className="h-4 w-4" />
                )}
                Create app
              </button>
            </div>

            {statusMessage ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {statusMessage}
                {branchUrl ? (
                  <a
                    href={branchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 inline-flex items-center gap-1 font-medium text-foreground underline"
                  >
                    Open branch <IconArrowUpRight className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <IconKey className="h-4 w-4" />
                Dispatch keys
              </div>
              <span className="shrink-0 rounded border border-border bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                {selectedSecretLabel}
              </span>
            </div>
          </div>
          <div className="max-h-[440px] space-y-2 overflow-y-auto p-3">
            {secretsError ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                {secretsError}
              </p>
            ) : secrets.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                No Dispatch vault keys found yet.
              </p>
            ) : (
              secrets.map((secret) => {
                const selected = selectedSecretIds.includes(secret.id);
                return (
                  <div
                    key={secret.id}
                    className={`group rounded-md border text-sm transition ${
                      selected
                        ? "border-primary/45 bg-primary/5 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.08)]"
                        : "border-border bg-background/25 text-foreground hover:border-muted-foreground/40 hover:bg-accent/35"
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleSecret(secret.id)}
                      className="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                          selected
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-muted-foreground/35 text-transparent group-hover:border-muted-foreground/60"
                        }`}
                      >
                        {selected ? <IconCheck className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {secret.credentialKey}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground/70">
                          {selected
                            ? "Will be requested for this app"
                            : "Click to request"}
                        </span>
                      </span>
                    </button>
                    <details className="group/details border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground/75 open:bg-background/10">
                      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] hover:text-muted-foreground [&::-webkit-details-marker]:hidden">
                        <IconChevronDown className="h-3 w-3 transition-transform group-open/details:rotate-180" />
                        Details
                      </summary>
                      <div className="mt-1.5 space-y-1 pb-0.5 pl-4">
                        <div className="truncate">
                          Provider: {secret.provider || "Not specified"}
                        </div>
                        <div className="truncate">Name: {secret.name}</div>
                      </div>
                    </details>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
