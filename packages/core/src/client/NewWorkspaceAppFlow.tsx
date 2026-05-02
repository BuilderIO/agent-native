import { useEffect, useMemo, useState } from "react";
import {
  IconArrowUpRight,
  IconCheck,
  IconCode,
  IconKey,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { agentNativePath, appBasePath } from "./api-path.js";
import { sendToAgentChat } from "./agent-chat.js";
import { isInBuilderFrame } from "./builder-frame.js";
import { useDevMode } from "./use-dev-mode.js";

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

  const canSubmit = prompt.trim().length > 0 && slugify(appName).length > 0;
  const submitShortcut =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
      ? "⌘"
      : "Ctrl";

  function buildMessage(): string {
    const safeAppName = slugify(appName) || titleFromPrompt(prompt);
    const keyList = selectedSecrets.map((s) => s.credentialKey).join(", ");
    return [
      `Create a new agent-native app in this workspace.`,
      ``,
      `App name: ${safeAppName}`,
      `Template to start from: ${template}`,
      `User prompt: ${prompt.trim()}`,
      keyList
        ? `Dispatch vault keys selected for this app: ${keyList}`
        : `Dispatch vault keys selected for this app: none`,
      ``,
      `Use the workspace app layout: create it under apps/${safeAppName}, mount it at /${safeAppName}, keep it on the shared workspace database/hosting model, and avoid table-name collisions by namespacing any new domain tables to the app.`,
      keyList
        ? `Grant the selected Dispatch vault keys to appId "${safeAppName}" and sync them once the app server is available.`
        : `Do not grant any Dispatch vault keys unless the user asks later.`,
      `When it is ready, start or update the dev server and navigate the user to /${safeAppName}.`,
    ].join("\n");
  }

  async function grantSelectedSecrets(safeAppName: string) {
    if (selectedSecretIds.length === 0) return;
    try {
      await fetchJson(
        actionUrl(effectiveDispatchBasePath, "grant-vault-secrets-to-app"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appId: safeAppName,
            secretIds: selectedSecretIds,
          }),
        },
      );
    } catch (err: any) {
      setStatusMessage(
        `The app request was prepared, but Dispatch grants could not be saved yet: ${err?.message || "unknown error"}`,
      );
    }
  }

  async function submit() {
    if (!canSubmit || isSubmitting) return;
    const safeAppName = slugify(appName) || titleFromPrompt(prompt);
    const message = buildMessage();
    setIsSubmitting(true);
    setStatusMessage(null);
    setBranchUrl(null);

    try {
      await grantSelectedSecrets(safeAppName);

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
              preparedPrompt: message,
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
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                />
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
            <div className="flex items-center gap-2 text-sm font-medium">
              <IconKey className="h-4 w-4" />
              Dispatch keys
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
                  <button
                    key={secret.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleSecret(secret.id)}
                    className={`group flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${
                      selected
                        ? "border-ring/60 bg-muted/70 text-foreground"
                        : "border-border bg-background/30 text-foreground hover:border-muted-foreground/40 hover:bg-accent/45"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                        selected
                          ? "border-ring bg-background text-foreground"
                          : "border-muted-foreground/35 text-transparent group-hover:border-muted-foreground/60"
                      }`}
                    >
                      {selected ? <IconCheck className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {secret.credentialKey}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {secret.provider || secret.name}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
