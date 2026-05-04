import { useEffect, useMemo, useState } from "react";
import {
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconKey,
} from "@tabler/icons-react";
import { agentNativePath, appBasePath } from "./api-path.js";
import { sendToAgentChat } from "./agent-chat.js";
import { isInBuilderFrame } from "./builder-frame.js";
import { useDevMode } from "./use-dev-mode.js";
import { getWorkspaceAppIdValidationError } from "../shared/workspace-app-id.js";
import { PromptComposer } from "./composer/PromptComposer.js";

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
  selectedKeys: string[];
}): string {
  const keyList = input.selectedKeys.join(", ");
  const grantRequest = keyList
    ? `Requested Dispatch vault key grants for this app: ${keyList}`
    : `Requested Dispatch vault key grants for this app: none`;

  return [
    `Create a new agent-native app in this workspace.`,
    ``,
    `Suggested app name: ${input.appId} (you may adjust the slug if it conflicts)`,
    `User prompt: ${input.prompt.trim()}`,
    grantRequest,
    ``,
    `Pick a starter template that fits the user's prompt — analytics, calendar, content, design, dispatch, forms, mail, slides, videos, clips, or starter when none of the others fit.`,
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

  const selectedSecrets = useMemo(
    () => secrets.filter((secret) => selectedSecretIds.includes(secret.id)),
    [secrets, selectedSecretIds],
  );
  const selectedSecretLabel =
    selectedSecretIds.length === 0
      ? "No keys selected"
      : `${selectedSecretIds.length} key${selectedSecretIds.length === 1 ? "" : "s"} selected`;

  async function submit(rawPrompt: string) {
    const prompt = rawPrompt.trim();
    if (!prompt || isSubmitting) return;
    const appId = titleFromPrompt(prompt);
    const validationError = getWorkspaceAppIdValidationError(appId);
    if (validationError) {
      setStatusMessage(validationError);
      return;
    }

    const message = buildNewWorkspaceAppPrompt({
      appId,
      prompt,
      selectedKeys: selectedSecrets.map((s) => s.credentialKey),
    });
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
              prompt,
              appId,
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
        <div className="flex flex-col gap-3">
          <PromptComposer
            autoFocus
            disabled={isSubmitting}
            placeholder="Describe the app your teammate should be able to use..."
            draftScope="dispatch:new-app"
            onSubmit={(text) => submit(text)}
          />

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
                      className="flex w-full cursor-pointer items-start gap-3 rounded-md px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
