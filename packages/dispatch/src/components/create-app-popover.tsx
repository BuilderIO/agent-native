import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PromptComposer,
  agentNativePath,
  appBasePath,
  isInBuilderFrame,
  sendToAgentChat,
  useDevMode,
} from "@agent-native/core/client";
import { getWorkspaceAppIdValidationError } from "@agent-native/core/shared";
import {
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface VaultSecretOption {
  id: string;
  name: string;
  credentialKey: string;
  provider?: string | null;
  description?: string | null;
}

interface WorkspaceResourceOption {
  id: string;
  kind: "skill" | "instruction" | "agent" | "knowledge";
  name: string;
  description?: string | null;
  path: string;
  scope: "all" | "selected";
  updatedAt?: number;
}

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

function buildAppCreationPrompt(input: {
  appId: string;
  prompt: string;
  selectedKeys: string[];
  selectedResources: WorkspaceResourceOption[];
}): string {
  const keyList = input.selectedKeys.join(", ");
  const grantRequest = keyList
    ? `Requested Dispatch vault key grants for this app: ${keyList}`
    : `Requested Dispatch vault key grants for this app: none`;
  const resourceList = input.selectedResources.length
    ? input.selectedResources
        .map(
          (resource) =>
            `- ${resource.name} (${resource.kind}, ${resource.path})`,
        )
        .join("\n")
    : "none";

  return [
    `Create a new agent-native app in this workspace.`,
    `This is a new workspace app request, not a feature request for the current app.`,
    ``,
    `Suggested app name: ${input.appId} (you may adjust the slug if it conflicts)`,
    `User prompt: ${input.prompt.trim()}`,
    grantRequest,
    `Requested Dispatch workspace resources for this app:\n${resourceList}`,
    ``,
    `Pick a starter template that fits the user's prompt — analytics, calendar, content, design, dispatch, forms, mail, slides, clips, or starter when none of the others fit.`,
    `Use the workspace app layout: create it under apps/${input.appId}, mount it at /${input.appId}, keep it on the shared workspace database/hosting model, and avoid table-name collisions by namespacing any new domain tables to the app.`,
    `Important routing rule: from outside the app, link to /${input.appId}; inside apps/${input.appId}, React Router routes are app-local. Use <Link to="/review"> and navigate("/review"), not "/${input.appId}/review"; APP_BASE_PATH supplies the mounted prefix, and hardcoding it causes doubled URLs like /${input.appId}/${input.appId}/review.`,
    `Prefer useActionQuery/useActionMutation for actions. If you must raw-fetch framework endpoints, wrap them with agentNativePath("/_agent-native/actions/<name>") so mounted apps call the right URL.`,
    `Use relative workspace links like /${input.appId}. Do not hardcode localhost, 127.0.0.1, 8080, 8100, or any dev port; the active workspace gateway/browser origin owns the port.`,
    `Use the framework/template UI stack: shadcn/ui components and @tabler/icons-react. Do not add lucide-react or another icon library for standard UI.`,
    `Existing first-party apps are neighbors, not implementation details for this app. If the user's prompt mentions Mail, Calendar, Analytics, Dispatch, or other templates, treat them as existing hosted/connected apps that this app can link to or call through A2A/default connected agents. For example, Mail, Calendar, and Analytics already exist at https://mail.agent-native.com, https://calendar.agent-native.com, and https://analytics.agent-native.com.`,
    `Do not clone first-party templates, create wrapper apps, or scaffold child apps/routes for Mail, Calendar, Analytics, etc. inside apps/${input.appId} just so this app can access them. If the request is a cross-app dashboard or overview, build only the new dashboard/overview app and delegate to the existing apps for domain work.`,
    `Only create another first-party app copy when the user explicitly asks for a customized fork/copy of that app; otherwise keep using the hosted/shared app so improvements to the base template keep flowing to users.`,
    `Do not satisfy this by adding a route, page, component, or file inside apps/starter or another existing app unless the user explicitly asks to modify that existing app.`,
    keyList
      ? `After the app exists, grant the selected Dispatch vault keys to appId "${input.appId}" and sync them once the app server is available. Treat these as requested grants, not active grants before creation succeeds.`
      : `Do not grant any Dispatch vault keys unless the user asks later.`,
    input.selectedResources.length
      ? `After the app exists, grant the selected Dispatch workspace resources to appId "${input.appId}" and sync them once the app server is available. Add a short note to apps/${input.appId}/AGENTS.md telling the app agent to read relevant shared resources under context/ or the selected resource paths before doing GTM/domain work.`
      : `Do not grant any Dispatch workspace resources unless the user asks later.`,
    ``,
    `App readiness requirements before handing off:`,
    `- Ensure apps/${input.appId}/package.json exists; Dispatch discovers workspace apps from apps/<app-id>/package.json, not a separate app registry.`,
    `- Update the app manifest/package/deploy metadata needed by the existing workspace deployment model.`,
    `- Ensure the React Router client entry preserves APP_BASE_PATH/VITE_APP_BASE_PATH via appBasePath() so /${input.appId} hydrates correctly.`,
    `- Verify the app's agent card/A2A metadata is ready so Dispatch can discover and delegate to the app after deployment.`,
    `When it is ready, start or update the workspace dev server and navigate the user to /${input.appId}.`,
  ].join("\n");
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

/**
 * Inline two-step app-creation flow: prompt → optional access picker → submit.
 * Used both in the popover form and in the dedicated `/new-app` page so the
 * same UX shows up everywhere a teammate kicks off a new workspace app.
 */
export function CreateAppFlow({
  onClose,
  className = "",
}: {
  onClose?: () => void;
  className?: string;
}) {
  const [step, setStep] = useState<"prompt" | "access">("prompt");
  const [prompt, setPrompt] = useState("");
  const [selectedSecretIds, setSelectedSecretIds] = useState<string[]>([]);
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [secrets, setSecrets] = useState<VaultSecretOption[]>([]);
  const [resources, setResources] = useState<WorkspaceResourceOption[]>([]);
  const [secretsError, setSecretsError] = useState<string | null>(null);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [branchUrl, setBranchUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isDevMode } = useDevMode();

  const basePath = useMemo(() => defaultDispatchBasePath(), []);

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
    selectedSecretIds.length === 0
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
    const appId = titleFromPrompt(trimmed);
    const validationError = getWorkspaceAppIdValidationError(appId);
    if (validationError) {
      setStatusMessage(validationError);
      return;
    }

    const message = buildAppCreationPrompt({
      appId,
      prompt: trimmed,
      selectedKeys: selectedSecrets.map((s) => s.credentialKey),
      selectedResources,
    });
    setIsSubmitting(true);
    setStatusMessage(null);
    setBranchUrl(null);

    try {
      if (isInBuilderFrame()) {
        sendToAgentChat({ message, submit: true, type: "code" });
        setStatusMessage("Sent to Builder chat.");
        onClose?.();
      } else if (isDevMode) {
        sendToAgentChat({ message, submit: true, type: "code", newTab: true });
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
              secretIds: selectedSecretIds.length > 0 ? selectedSecretIds : [],
              resourceIds:
                selectedResourceIds.length > 0 ? selectedResourceIds : [],
            }),
          },
        );
        if (result?.mode === "builder") {
          setBranchUrl(result?.url || null);
          setStatusMessage("Builder branch created.");
        } else {
          setStatusMessage(
            result?.message ||
              "Builder app creation is coming soon. Open this workspace in Builder to create an app from this prompt.",
          );
        }
      }
    } catch (err: any) {
      setStatusMessage(err?.message || "Could not start the new app flow.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const submitWithSelectedAccess = () => submit(prompt);

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
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
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
  );
}

export function CreateAppPopover({
  trigger,
  align = "center",
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
        <CreateAppFlow onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
