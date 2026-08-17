import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useDevMode } from "@agent-native/core/client/agent-chat";
import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import { PromptComposer } from "@agent-native/core/client/composer";
import { isInBuilderFrame } from "@agent-native/core/client/host";
import { useBuilderConnectFlow } from "@agent-native/core/client/settings/useBuilderStatus";
import {
  buildChatFirstAppCreationPrompt,
  docsUrl,
  getWorkspaceAppIdValidationError,
  titleFromChatFirstAppPrompt,
} from "@agent-native/core/shared";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowUpRight,
  IconBook,
  IconCheck,
  IconChevronDown,
  IconFileText,
  IconKey,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

interface VaultSecretOption {
  id: string;
  name: string;
  credentialKey: string;
  provider?: string | null;
  description?: string | null;
}

interface WorkspaceResourceOption {
  id: string;
  kind: "skill" | "instruction" | "agent" | "knowledge" | "mcp-server";
  name: string;
  description?: string | null;
  path: string;
  scope: "all" | "selected";
  updatedAt?: number;
}

type VaultAccessMode = "all-apps" | "manual";

interface CreateAppPopoverProps {
  /**
   * Custom trigger element. Defaults to a dashed-border tile that matches the
   * apps grid empty state.
   */
  trigger?: ReactNode;
  /**
   * Override the popover alignment. Defaults to "center" with a 10px offset.
   */
  align?: "start" | "center" | "end";
  /**
   * Called after the server accepts a Builder app creation request.
   */
  onCreated?: () => void;
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

function defaultDispatchBasePath(): string | null {
  const base = appBasePath();
  if (base === "/dispatch") return null;
  return null;
}

function actionUrl(basePath: string | null, action: string): string {
  const path = `/_agent-native/actions/${action}`;
  if (basePath === null) return agentNativePath(path);
  const normalized = basePath.replace(/\/+$/, "");
  return `${normalized}${path}`;
}

const ERROR_FAILURE_REASONS = new Set([
  "builder-error",
  "builder-not-connected",
  "credential-store-unavailable",
  "settings-management-required",
]);
const LOCAL_APP_DOCS_URL = docsUrl("multi-app-workspace", {
  hash: "adding-a-new-app",
});

function isErrorFailureReason(reason: string | null): boolean {
  return !!reason && ERROR_FAILURE_REASONS.has(reason);
}

/**
 * Inline two-step app-creation flow: prompt → optional access picker → submit.
 * Used both in the popover form and in the dedicated `/new-app` page so the
 * same UX shows up everywhere a teammate kicks off a new workspace app.
 */
export function CreateAppFlow({
  onClose,
  onCreated,
  className = "",
}: {
  onClose?: () => void;
  onCreated?: () => void;
  className?: string;
}) {
  const [step, setStep] = useState<"prompt" | "access">("prompt");
  const [prompt, setPrompt] = useState("");
  const [selectedSecretIds, setSelectedSecretIds] = useState<string[]>([]);
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [secrets, setSecrets] = useState<VaultSecretOption[]>([]);
  const [resources, setResources] = useState<WorkspaceResourceOption[]>([]);
  const [vaultAccessMode, setVaultAccessMode] =
    useState<VaultAccessMode>("all-apps");
  const [secretsError, setSecretsError] = useState<string | null>(null);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [branchUrl, setBranchUrl] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isDevMode } = useDevMode();

  const basePath = useMemo(() => defaultDispatchBasePath(), []);

  // Enabled only while the connect CTA is on screen. Left always-on, the hook
  // would poll Builder status on every popover mount and fire onConnected on
  // its first status read for anyone already connected.
  const connectFlow = useBuilderConnectFlow({
    enabled: failureReason === "builder-not-connected",
    trackingSource: "dispatch_create_app",
    trackingFlow: "create_app",
    onConnected: () => {
      setFailureReason(null);
      setStatusMessage("Builder connected. Press Create app to try again.");
    },
  });

  // Fetch access options eagerly so step 2 has them ready immediately.
  useEffect(() => {
    let cancelled = false;
    fetchJson(actionUrl(basePath, "list-vault-secret-options"))
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
    fetchJson(actionUrl(basePath, "get-vault-access-settings"))
      .then((data) => {
        if (cancelled) return;
        setVaultAccessMode(data?.mode === "manual" ? "manual" : "all-apps");
      })
      .catch(() => {
        if (cancelled) return;
        setVaultAccessMode("manual");
      });
    fetchJson(actionUrl(basePath, "list-workspace-resource-options"))
      .then((data) => {
        if (cancelled) return;
        setResources(Array.isArray(data) ? data : []);
        setResourcesError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setResources([]);
        setResourcesError(err?.message || "Could not load Dispatch resources");
      });
    return () => {
      cancelled = true;
    };
  }, [basePath]);

  const selectedSecrets = useMemo(
    () => secrets.filter((s) => selectedSecretIds.includes(s.id)),
    [secrets, selectedSecretIds],
  );
  const selectedResources = useMemo(
    () => resources.filter((r) => selectedResourceIds.includes(r.id)),
    [resources, selectedResourceIds],
  );
  const selectedSecretLabel =
    vaultAccessMode === "all-apps"
      ? "all keys"
      : selectedSecretIds.length === 0
        ? "no keys"
        : `${selectedSecretIds.length} key${selectedSecretIds.length === 1 ? "" : "s"}`;
  const selectedResourceLabel =
    selectedResourceIds.length === 0
      ? "no resources"
      : `${selectedResourceIds.length} resource${selectedResourceIds.length === 1 ? "" : "s"}`;
  const selectedAccessLabel = [selectedSecretLabel, selectedResourceLabel].join(
    " · ",
  );

  function toggleSecret(id: string) {
    setSelectedSecretIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  function toggleResource(id: string) {
    setSelectedResourceIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  async function submit(rawPrompt: string) {
    const trimmed = rawPrompt.trim();
    if (!trimmed || isSubmitting) return;
    const appId = titleFromChatFirstAppPrompt(trimmed);
    const validationError = getWorkspaceAppIdValidationError(appId);
    if (validationError) {
      setStatusMessage(validationError);
      return;
    }

    const message = buildChatFirstAppCreationPrompt({
      appId,
      prompt: trimmed,
      selectedKeys:
        vaultAccessMode === "manual"
          ? selectedSecrets.map((s) => s.credentialKey)
          : [],
      selectedResources,
      vaultAccessMode,
    });
    setIsSubmitting(true);
    setStatusMessage(null);
    setBranchUrl(null);
    setFailureReason(null);

    try {
      if (isInBuilderFrame()) {
        sendToAgentChat({ message, submit: true, type: "code" });
        setStatusMessage("Sent to Builder chat.");
        onClose?.();
      } else if (isDevMode) {
        sendToAgentChat({
          message,
          submit: true,
          type: "code",
          newTab: true,
          reuseEmptyTab: true,
        });
        setStatusMessage("Sent to the local agent.");
        onClose?.();
      } else {
        const result = await fetchJson(
          actionUrl(basePath, "start-workspace-app-creation"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: trimmed,
              appId,
              secretIds:
                vaultAccessMode === "manual" && selectedSecretIds.length > 0
                  ? selectedSecretIds
                  : [],
              resourceIds:
                selectedResourceIds.length > 0 ? selectedResourceIds : [],
            }),
          },
        );
        if (result?.mode === "builder") {
          onCreated?.();
          setBranchUrl(result?.url || null);
          setStatusMessage("Builder branch created.");
        } else if (result?.mode === "local-agent") {
          sendToAgentChat({
            message: result.prompt ?? message,
            submit: true,
            type: "code",
            newTab: true,
            reuseEmptyTab: true,
          });
          setStatusMessage("Sent to the local agent.");
          onClose?.();
        } else {
          setStatusMessage(
            result?.message ||
              "This requires a code change. Edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way you like.",
          );
          setFailureReason(
            result?.mode === "builder-unavailable" ? result.reason : null,
          );
        }
      }
    } catch (err: any) {
      setStatusMessage(err?.message || "Could not start the new app flow.");
      setFailureReason(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  const submitWithSelectedAccess = () => submit(prompt);
  const isCreatingBuilderBranch =
    isSubmitting && !isInBuilderFrame() && !isDevMode;

  if (branchUrl) {
    return (
      <div
        className={`flex min-h-[260px] flex-col items-center justify-center gap-5 px-6 py-8 text-center ${className}`}
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <IconCheck className="size-5" aria-hidden="true" />
        </span>
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            Your Builder branch is ready
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Continue building and editing your app in Builder.
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <a href={branchUrl} target="_blank" rel="noreferrer">
            Open in Builder <IconArrowUpRight aria-hidden="true" />
          </a>
        </Button>
      </div>
    );
  }

  if (isCreatingBuilderBranch) {
    return (
      <div
        className={`flex min-h-[260px] flex-col items-center justify-center gap-4 px-6 py-8 text-center ${className}`}
        aria-live="polite"
      >
        <IconLoader2
          className="size-7 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            Creating your Builder branch
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            This usually takes a few seconds.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {step === "prompt" ? (
        <>
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-sm font-semibold text-foreground">Create app</p>
            <button
              type="button"
              onClick={() => setStep("access")}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background/40 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              <IconKey size={11} />
              {selectedAccessLabel}
            </button>
          </div>
          <PromptComposer
            autoFocus
            disabled={isSubmitting}
            placeholder="Describe the app your teammate should be able to use..."
            draftScope="dispatch:create-app"
            preserveDraftOnSubmit
            onSubmit={(text) => {
              setPrompt(text);
              submit(text);
            }}
          />
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 px-1">
            <button
              type="button"
              onClick={() => setStep("prompt")}
              className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <IconArrowLeft size={12} />
              Back
            </button>
            <span className="text-[11px] text-muted-foreground/70">
              {selectedAccessLabel}
            </span>
          </div>
          <div className="max-h-[180px] space-y-2 overflow-y-auto rounded-md border border-border bg-card p-2">
            <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-medium text-muted-foreground">
              <IconKey size={12} />
              Dispatch keys
            </div>
            {vaultAccessMode === "all-apps" ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                Every saved Dispatch vault key is available to new apps.
              </p>
            ) : secretsError ? (
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
                    className={`group rounded-md border text-sm ${
                      selected
                        ? "border-primary/45 bg-primary/5"
                        : "border-border hover:border-muted-foreground/40 hover:bg-accent/35"
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleSecret(secret.id)}
                      className="flex w-full cursor-pointer items-start gap-3 rounded-md px-3 py-2 text-left"
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          selected
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-muted-foreground/35 text-transparent"
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
                    {(secret.provider || secret.name) && (
                      <details className="group/details border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground/75">
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
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="max-h-[180px] space-y-2 overflow-y-auto rounded-md border border-border bg-card p-2">
            <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-medium text-muted-foreground">
              <IconBook size={12} />
              Resource packs
            </div>
            {resourcesError ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                {resourcesError}
              </p>
            ) : resources.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                No Dispatch resource packs found yet.
              </p>
            ) : (
              resources.map((resource) => {
                const selected = selectedResourceIds.includes(resource.id);
                return (
                  <div
                    key={resource.id}
                    className={`group rounded-md border text-sm ${
                      selected
                        ? "border-primary/45 bg-primary/5"
                        : "border-border hover:border-muted-foreground/40 hover:bg-accent/35"
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleResource(resource.id)}
                      className="flex w-full cursor-pointer items-start gap-3 rounded-md px-3 py-2 text-left"
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          selected
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-muted-foreground/35 text-transparent"
                        }`}
                      >
                        {selected ? <IconCheck className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <IconFileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                          <span className="block truncate font-medium">
                            {resource.name}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground/70">
                          {resource.kind} · {resource.path}
                        </span>
                      </span>
                    </button>
                    <details className="group/details border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground/75">
                      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] hover:text-muted-foreground [&::-webkit-details-marker]:hidden">
                        <IconChevronDown className="h-3 w-3 transition-transform group-open/details:rotate-180" />
                        Details
                      </summary>
                      <div className="mt-1.5 space-y-1 pb-0.5 pl-4">
                        <div className="truncate">
                          Scope:{" "}
                          {resource.scope === "all"
                            ? "All apps"
                            : "Selected apps"}
                        </div>
                        {resource.description ? (
                          <div className="line-clamp-2">
                            {resource.description}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              onClick={submitWithSelectedAccess}
              disabled={!prompt.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <IconPlus className="h-3.5 w-3.5" />
              )}
              Create app
            </Button>
          </div>
          {!prompt.trim() ? (
            <p className="px-1 text-[11px] text-muted-foreground/70">
              Add a prompt on the previous step before creating the app.
            </p>
          ) : null}
        </>
      )}

      {statusMessage ? (
        <div
          className={`flex flex-col gap-2 rounded-md border px-3 py-2 text-xs ${
            isErrorFailureReason(failureReason)
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-muted/40 text-muted-foreground"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {isErrorFailureReason(failureReason) ? (
              <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
            ) : null}
            <span>{statusMessage}</span>
            {branchUrl ? (
              <a
                href={branchUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-foreground underline"
              >
                Open in Builder <IconArrowUpRight className="h-3 w-3" />
              </a>
            ) : null}
          </div>
          {failureReason === "builder-not-connected" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => connectFlow.start()}
                disabled={connectFlow.connecting}
                className="w-fit"
              >
                {connectFlow.connecting ? "Connecting..." : "Connect Builder"}
              </Button>
              <a
                href={LOCAL_APP_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                data-create-app-local-link
                className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-2"
              >
                Create locally <IconArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          ) : null}
          {failureReason === "credential-store-unavailable" ||
          failureReason === "builder-error" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={submitWithSelectedAccess}
              disabled={isSubmitting}
              className="w-fit"
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CreateAppPopover({
  trigger,
  align = "center",
  onCreated,
}: CreateAppPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="flex min-h-32 cursor-pointer items-center justify-center rounded-lg border border-dashed bg-card p-4 text-sm font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <IconPlus size={16} />
              Create app
            </span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={10}
        className="w-[calc(100vw-2rem)] rounded-xl p-3 shadow-xl sm:w-[460px]"
      >
        <CreateAppFlow onClose={() => setOpen(false)} onCreated={onCreated} />
      </PopoverContent>
    </Popover>
  );
}
