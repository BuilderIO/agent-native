import {
  Picker,
  Skeleton,
  TextField,
} from "@agent-native/toolkit/design-system";
import { ButtonBase as ToolkitButtonBase } from "@agent-native/toolkit/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@agent-native/toolkit/ui/collapsible";
import {
  IconPlus,
  IconTrash,
  IconX,
  IconCheck,
  IconLoader2,
  IconAlertTriangle,
  IconExternalLink,
  IconRefresh,
  IconTopologyRing2,
  IconChevronDown,
} from "@tabler/icons-react";
import { useState, useEffect, useRef, useCallback } from "react";

import {
  buildOpenRoutePath,
  buildSettingsRoute,
  STANDARD_APP_ROUTES,
  STANDARD_SETTINGS_TABS,
} from "../../navigation/index.js";
import {
  getRemoteAgentIdFromPath,
  isRemoteAgentPath,
  parseRemoteAgentKind,
  parseRemoteAgentUrl,
  REMOTE_AGENT_RESOURCE_PREFIX,
  remoteAgentResourcePath,
  type AnthropicManagedAgentsRemoteAgentKind,
  type RemoteAgentKind,
} from "../../resources/metadata.js";
import { agentNativePath, appBasePath, appMountedPath } from "../api-path.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { useOrg, useSyncA2ASecret } from "../org/hooks.js";
import { NewKeyMenu, type NewKeyOption } from "./NewKeyMenu.js";

interface AgentInfo {
  id: string;
  path: string;
  name: string;
  url: string;
  description?: string;
  cardUrl?: string;
  auth?: HostedAgentAuth;
  kind?: RemoteAgentKind;
}

type HostedAgentAuth =
  | { type: "bearer"; credentialRef: string }
  | {
      type: "oauth-client-credentials";
      tokenUrl: string;
      clientId: string;
      clientSecretRef: string;
      scope?: string;
    };

type HostedAgentAuthType = "none" | HostedAgentAuth["type"];
type HostedAgentProvider = "a2a" | "anthropic-managed-agents";

const ANTHROPIC_MANAGED_AGENT_DEFAULT_URL = "https://api.anthropic.com";

function emptyAnthropicManagedAgentKind(): AnthropicManagedAgentsRemoteAgentKind {
  return {
    provider: "anthropic-managed-agents",
    agentId: "",
    environmentId: "",
    credentialRef: "",
  };
}

interface SecretStatusOption {
  key: string;
  label: string;
  status?: string;
  source?: string;
}

interface AgentProbeResult {
  url: string;
  reachable: boolean;
  cardStatus?: "reachable" | "auth-rejected" | "no-json-rpc";
  name?: string;
  description?: string;
  securitySchemes?: string[];
  authorized?: boolean;
  authError?: string;
  publicSkills?: number;
  error?: string;
}

function probeStatus(
  result: AgentProbeResult | undefined,
): "reachable" | "auth-rejected" | "no-json-rpc" | null {
  if (!result) return null;
  if (result.cardStatus) return result.cardStatus;
  if (/json.?rpc/i.test(result.error ?? "")) return "no-json-rpc";
  if (result.authorized === false) return "auth-rejected";
  return result.reachable ? "reachable" : null;
}

function describeSkills(publicSkills: number | undefined): string | null {
  if (publicSkills === undefined) return null;
  if (publicSkills === 0) return "reads require auth";
  return `${publicSkills} public skill${publicSkills === 1 ? "" : "s"}`;
}

function describeProbeTooltip(result: AgentProbeResult): string {
  if (!result.reachable) {
    return `Unreachable${result.error ? `: ${result.error}` : ""}`;
  }
  if (result.authorized === false) {
    return "Reachable, but the peer rejected our token — calls will 401 in production";
  }
  if (result.authorized === undefined) {
    return "Reachable; couldn't verify our token";
  }
  return "Reachable and authorized";
}

function describeCheckResult(result: AgentProbeResult): string {
  if (!result.reachable) {
    return result.error ?? "Not reachable";
  }
  const scheme = result.securitySchemes?.length
    ? result.securitySchemes.join(", ")
    : "no auth scheme advertised";
  const authText =
    result.authorized === false
      ? "the peer rejected our token — calls will 401 in production"
      : result.authorized === undefined
        ? `couldn't verify our token${result.authError ? ` (${result.authError})` : ""}`
        : "our token works";
  const skills = describeSkills(result.publicSkills);
  return [`Live · ${scheme}`, authText, skills].filter(Boolean).join(" · ");
}

export function normalizeHostedAgentUrl(
  value: string,
  options: { requireHttps?: boolean } = {},
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return parseRemoteAgentUrl(trimmed, {
    ...(options.requireHttps
      ? { allowLoopbackHttp: true, requireHttps: true }
      : {}),
  })
    ? trimmed
    : undefined;
}

function normalizeHostedAuth(
  auth: HostedAgentAuth | undefined,
): HostedAgentAuth | undefined {
  if (!auth) return undefined;
  if (auth.type === "bearer") {
    const credentialRef = auth.credentialRef.trim();
    return credentialRef ? { type: "bearer", credentialRef } : undefined;
  }
  const tokenUrl = parseRemoteAgentUrl(auth.tokenUrl, {
    requireHttps: true,
  });
  const clientId = auth.clientId.trim();
  const clientSecretRef = auth.clientSecretRef.trim();
  const scope = auth.scope?.trim();
  if (!tokenUrl || !clientId || !clientSecretRef) return undefined;
  return {
    type: auth.type,
    tokenUrl,
    clientId,
    clientSecretRef,
    ...(scope ? { scope } : {}),
  };
}

export function normalizeHostedAgentCardUrl(
  value: string,
  kind?: RemoteAgentKind,
  auth?: HostedAgentAuth,
): string | undefined {
  if (kind?.provider === "anthropic-managed-agents") return undefined;
  const trimmed = value.trim();
  return trimmed
    ? normalizeHostedAgentUrl(trimmed, { requireHttps: Boolean(auth) })
    : undefined;
}

export function parseHostedAuth(value: unknown): HostedAgentAuth | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.type === "bearer" &&
    typeof candidate.credentialRef === "string"
  ) {
    return normalizeHostedAuth({
      type: "bearer",
      credentialRef: candidate.credentialRef,
    });
  }
  if (
    candidate.type === "oauth-client-credentials" &&
    typeof candidate.tokenUrl === "string" &&
    typeof candidate.clientId === "string" &&
    typeof candidate.clientSecretRef === "string" &&
    (candidate.scope === undefined || typeof candidate.scope === "string")
  ) {
    return normalizeHostedAuth({
      type: candidate.type,
      tokenUrl: candidate.tokenUrl,
      clientId: candidate.clientId,
      clientSecretRef: candidate.clientSecretRef,
      ...(typeof candidate.scope === "string"
        ? { scope: candidate.scope }
        : {}),
    });
  }
  return undefined;
}

function isRadixPortalTarget(target: EventTarget | null): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    Boolean(target.closest("[data-radix-popper-content-wrapper]"))
  );
}

function HostedAgentFields({
  url,
  onUrlChange,
  cardUrl,
  onCardUrlChange,
  auth,
  onAuthChange,
  kind,
  onKindChange,
  credentialOptions,
  openOnMount = false,
}: {
  url: string;
  onUrlChange: (value: string) => void;
  cardUrl: string;
  onCardUrlChange: (value: string) => void;
  auth?: HostedAgentAuth;
  onAuthChange: (value?: HostedAgentAuth) => void;
  kind?: RemoteAgentKind;
  onKindChange: (value?: RemoteAgentKind) => void;
  credentialOptions: NewKeyOption[];
  openOnMount?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(() =>
    Boolean(openOnMount || cardUrl.trim() || auth || kind),
  );
  const shouldOpen = Boolean(openOnMount || cardUrl.trim() || auth || kind);
  useEffect(() => setOpen(shouldOpen), [shouldOpen]);
  const provider: HostedAgentProvider =
    kind?.provider === "anthropic-managed-agents"
      ? "anthropic-managed-agents"
      : "a2a";
  const managedKind =
    kind?.provider === "anthropic-managed-agents" ? kind : undefined;
  const authType: HostedAgentAuthType = auth?.type ?? "none";
  const oauthAuth =
    auth?.type === "oauth-client-credentials" ? auth : undefined;
  const selectedCredentialRef =
    auth?.type === "bearer"
      ? auth.credentialRef
      : auth?.type === "oauth-client-credentials"
        ? auth.clientSecretRef
        : "";

  const updateAuthType = (value: string) => {
    if (value === "none") {
      onAuthChange(undefined);
    } else if (value === "bearer") {
      onAuthChange({
        type: "bearer",
        credentialRef: auth?.type === "bearer" ? auth.credentialRef : "",
      });
    } else if (value === "oauth-client-credentials") {
      onAuthChange({
        type: "oauth-client-credentials",
        tokenUrl:
          auth?.type === "oauth-client-credentials" ? auth.tokenUrl : "",
        clientId:
          auth?.type === "oauth-client-credentials" ? auth.clientId : "",
        clientSecretRef:
          auth?.type === "oauth-client-credentials" ? auth.clientSecretRef : "",
        scope:
          auth?.type === "oauth-client-credentials" ? (auth.scope ?? "") : "",
      });
    }
  };

  const updateCredentialRef = (value: string) => {
    if (auth?.type === "bearer") {
      onAuthChange({ ...auth, credentialRef: value });
    } else if (auth?.type === "oauth-client-credentials") {
      onAuthChange({ ...auth, clientSecretRef: value });
    }
  };

  const credentialLabel = selectedCredentialRef
    ? (credentialOptions.find((option) => option.key === selectedCredentialRef)
        ?.label ?? selectedCredentialRef)
    : t("agentChat.agents.chooseCredential");

  const managedCredentialLabel = managedKind?.credentialRef
    ? (credentialOptions.find(
        (option) => option.key === managedKind.credentialRef,
      )?.label ?? managedKind.credentialRef)
    : t("agentChat.agents.chooseCredential");

  const updateProvider = (value: string) => {
    if (value === "anthropic-managed-agents") {
      onKindChange(managedKind ?? emptyAnthropicManagedAgentKind());
      onAuthChange(undefined);
      onCardUrlChange("");
      onUrlChange(ANTHROPIC_MANAGED_AGENT_DEFAULT_URL);
      return;
    }
    onKindChange(undefined);
    onAuthChange(undefined);
    if (url === ANTHROPIC_MANAGED_AGENT_DEFAULT_URL) onUrlChange("");
  };

  const updateManagedKind = (
    field: "agentId" | "environmentId" | "credentialRef",
    value: string,
  ) => {
    const next = managedKind ?? emptyAnthropicManagedAgentKind();
    onKindChange({ ...next, [field]: value });
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mt-1 rounded border border-border/70 bg-accent/20 px-2 py-1.5"
    >
      <CollapsibleTrigger asChild>
        <ToolkitButtonBase
          type="button"
          variant="ghost"
          className="flex w-full items-center justify-between px-0.5 py-0.5 text-[10px] font-medium text-foreground"
        >
          {t("agentChat.agents.hostedAgent")}
          <IconChevronDown size={12} />
        </ToolkitButtonBase>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-1.5">
        <Picker
          mode="select"
          value={provider}
          onChange={(value) => {
            if (value) updateProvider(String(value));
          }}
          aria-label={t("agentChat.agents.provider")}
          options={[
            { value: "a2a", label: t("agentChat.agents.providerA2A") },
            {
              value: "anthropic-managed-agents",
              label: t("agentChat.agents.providerAnthropic"),
            },
          ]}
          className="text-[11px]"
        />
        {provider === "a2a" ? (
          <>
            <TextField
              value={cardUrl}
              onChange={onCardUrlChange}
              aria-label={t("agentChat.agents.cardUrl")}
              placeholder={t("agentChat.agents.cardUrlPlaceholder")}
              className="w-full text-[11px]"
            />
            <Picker
              mode="select"
              value={authType}
              onChange={(value) => updateAuthType(String(value))}
              aria-label={t("agentChat.agents.authType")}
              options={[
                { value: "none", label: t("agentChat.agents.authNone") },
                { value: "bearer", label: t("agentChat.agents.authBearer") },
                {
                  value: "oauth-client-credentials",
                  label: t("agentChat.agents.authClientCredentials"),
                },
              ]}
              className="text-[11px]"
            />
            {authType !== "none" && (
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                  {credentialLabel}
                </span>
                <NewKeyMenu
                  options={credentialOptions}
                  label={t("agentChat.agents.chooseCredential")}
                  onPick={(option) => updateCredentialRef(option.key)}
                  onCustom={(name) => {
                    if (name) updateCredentialRef(name);
                  }}
                  triggerClassName="shrink-0"
                />
              </div>
            )}
            {oauthAuth && (
              <>
                <TextField
                  value={oauthAuth.tokenUrl}
                  onChange={(value) =>
                    onAuthChange({ ...oauthAuth, tokenUrl: value })
                  }
                  aria-label={t("agentChat.agents.tokenUrl")}
                  placeholder={t("agentChat.agents.tokenUrl")}
                  className="w-full text-[11px]"
                />
                <TextField
                  value={oauthAuth.clientId}
                  onChange={(value) =>
                    onAuthChange({ ...oauthAuth, clientId: value })
                  }
                  aria-label={t("agentChat.agents.clientId")}
                  placeholder={t("agentChat.agents.clientId")}
                  className="w-full text-[11px]"
                />
                <TextField
                  value={oauthAuth.scope ?? ""}
                  onChange={(value) =>
                    onAuthChange({ ...oauthAuth, scope: value })
                  }
                  aria-label={t("agentChat.agents.scope")}
                  placeholder={t("agentChat.agents.scope")}
                  className="w-full text-[11px]"
                />
              </>
            )}
          </>
        ) : (
          <>
            <TextField
              value={url}
              onChange={onUrlChange}
              label={t("agentChat.agents.apiBaseUrl")}
              aria-label={t("agentChat.agents.apiBaseUrl")}
              placeholder={t("agentChat.agents.apiBaseUrlPlaceholder")}
              className="w-full text-[11px]"
            />
            <TextField
              value={managedKind?.agentId ?? ""}
              onChange={(value) => updateManagedKind("agentId", value)}
              label={t("agentChat.agents.agentId")}
              aria-label={t("agentChat.agents.agentId")}
              placeholder={t("agentChat.agents.agentIdPlaceholder")}
              className="w-full text-[11px]"
            />
            <TextField
              value={managedKind?.environmentId ?? ""}
              onChange={(value) => updateManagedKind("environmentId", value)}
              label={t("agentChat.agents.environmentId")}
              aria-label={t("agentChat.agents.environmentId")}
              placeholder={t("agentChat.agents.environmentIdPlaceholder")}
              className="w-full text-[11px]"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                {managedCredentialLabel}
              </span>
              <NewKeyMenu
                options={credentialOptions}
                label={t("agentChat.agents.chooseCredential")}
                onPick={(option) =>
                  updateManagedKind("credentialRef", option.key)
                }
                onCustom={(name) => {
                  if (name) updateManagedKind("credentialRef", name);
                }}
                triggerClassName="shrink-0"
              />
            </div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function AgentEditPopover({
  agent,
  credentialOptions,
  onSave,
  onDelete,
  onClose,
}: {
  agent: AgentInfo;
  credentialOptions: NewKeyOption[];
  onSave: (agent: AgentInfo) => Promise<void> | void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [url, setUrl] = useState(agent.url);
  const [description, setDescription] = useState(agent.description ?? "");
  const [cardUrl, setCardUrl] = useState(agent.cardUrl ?? "");
  const [auth, setAuth] = useState<HostedAgentAuth | undefined>(agent.auth);
  const [kind, setKind] = useState<RemoteAgentKind | undefined>(agent.kind);
  const [saveError, setSaveError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (isRadixPortalTarget(e.target)) return;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleSave = async () => {
    if (
      !name.trim() ||
      (!url.trim() && kind?.provider !== "anthropic-managed-agents")
    )
      return;
    try {
      await onSave({
        ...agent,
        name: name.trim(),
        url: url.trim(),
        description: description.trim() || undefined,
        cardUrl: cardUrl.trim() || undefined,
        auth,
        kind,
      });
      setSaveError(null);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save agent",
      );
    }
  };

  return (
    <div
      ref={popoverRef}
      className="absolute end-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-2.5 shadow-lg"
    >
      <div className="flex flex-col gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSave();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
          placeholder="Name"
        />
        {kind?.provider !== "anthropic-managed-agents" && (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
              if (e.key === "Escape") onClose();
            }}
            className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
            placeholder="URL (e.g. http://localhost:8085)"
          />
        )}
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSave();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
          placeholder="Description (optional)"
        />
        <HostedAgentFields
          url={url}
          onUrlChange={setUrl}
          cardUrl={cardUrl}
          onCardUrlChange={setCardUrl}
          auth={auth}
          onAuthChange={setAuth}
          kind={kind}
          onKindChange={setKind}
          credentialOptions={credentialOptions}
        />
        {saveError && (
          <p className="text-[10px] text-destructive">{saveError}</p>
        )}
        <div className="flex items-center justify-between pt-0.5">
          <button
            onClick={() => onDelete(agent.id)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-900/20"
          >
            <IconTrash size={10} />
            Remove
          </button>
          <div className="flex gap-1">
            <button
              onClick={onClose}
              className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={
                !name.trim() ||
                (!url.trim() && kind?.provider !== "anthropic-managed-agents")
              }
              className="rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "done"; result: AgentProbeResult }
  | { status: "error"; message: string };

interface AddedAgentInfo {
  name: string;
  url: string;
  description: string;
  provider: HostedAgentProvider;
}

function buildPeerRegisterBackLink(peerUrl: string): string {
  const selfUrl = `${window.location.origin}${appBasePath()}`;
  const selfName = document.title.trim() || window.location.hostname;
  const openPath = buildOpenRoutePath({
    view: "settings",
    to: buildSettingsRoute(STANDARD_SETTINGS_TABS.agent),
    params: {
      f_agentName: selfName,
      f_agentUrl: selfUrl,
    },
  });
  return `${peerUrl.replace(/\/+$/, "")}${openPath}`;
}

function AgentAddPopover({
  initialName = "",
  initialUrl = "",
  initialDescription = "",
  initialProvider,
  credentialOptions,
  secretSet,
  syncSecret,
  onAdd,
  onClose,
}: {
  initialName?: string;
  initialUrl?: string;
  initialDescription?: string;
  initialProvider?: HostedAgentProvider;
  credentialOptions: NewKeyOption[];
  secretSet: boolean | undefined;
  syncSecret: ReturnType<typeof useSyncA2ASecret>;
  onAdd: (
    name: string,
    url: string,
    description: string,
    cardUrl: string,
    auth?: HostedAgentAuth,
    kind?: RemoteAgentKind,
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(
    initialUrl ||
      (initialProvider === "anthropic-managed-agents"
        ? ANTHROPIC_MANAGED_AGENT_DEFAULT_URL
        : ""),
  );
  const [description, setDescription] = useState(initialDescription);
  const [cardUrl, setCardUrl] = useState("");
  const [auth, setAuth] = useState<HostedAgentAuth | undefined>();
  const [kind, setKind] = useState<RemoteAgentKind | undefined>(() =>
    initialProvider === "anthropic-managed-agents"
      ? emptyAnthropicManagedAgentKind()
      : undefined,
  );
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  const [added, setAdded] = useState<AddedAgentInfo | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(
      () => (urlRef.current?.value ? nameRef : urlRef).current?.focus(),
      50,
    );
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (isRadixPortalTarget(e.target)) return;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleCheck = useCallback(async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    const normalizedKind = kind ? parseRemoteAgentKind(kind) : undefined;
    if (kind && !normalizedKind) {
      setCheck({
        status: "error",
        message: t("agentChat.agents.managedAgentIncomplete"),
      });
      return;
    }
    const normalizedAuth = normalizeHostedAuth(auth);
    if (auth && !normalizedAuth) {
      setCheck({
        status: "error",
        message: t("agentChat.agents.authIncomplete"),
      });
      return;
    }
    const normalizedUrl = normalizeHostedAgentUrl(trimmedUrl, {
      requireHttps: Boolean(normalizedAuth || normalizedKind),
    });
    if (!normalizedUrl) {
      setCheck({
        status: "error",
        message: t("agentChat.agents.invalidUrl"),
      });
      return;
    }
    const trimmedCardUrl = cardUrl.trim();
    if (
      !normalizedKind &&
      trimmedCardUrl &&
      !normalizeHostedAgentCardUrl(
        trimmedCardUrl,
        normalizedKind,
        normalizedAuth,
      )
    ) {
      setCheck({
        status: "error",
        message: t("agentChat.agents.invalidUrl"),
      });
      return;
    }
    setCheck({ status: "checking" });
    try {
      const cardQuery = trimmedCardUrl
        ? `&cardUrl=${encodeURIComponent(trimmedCardUrl)}`
        : "";
      const authQuery = normalizedAuth
        ? `&auth=${encodeURIComponent(JSON.stringify(normalizedAuth))}`
        : "";
      const kindQuery = normalizedKind
        ? `&kind=${encodeURIComponent(JSON.stringify(normalizedKind))}`
        : "";
      const res = await fetch(
        agentNativePath(
          `/_agent-native/agents/probe?url=${encodeURIComponent(normalizedUrl)}${cardQuery}${authQuery}${kindQuery}`,
        ),
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setCheck({
          status: "error",
          message: body?.error ?? `Check failed (${res.status})`,
        });
        return;
      }
      const result = body as AgentProbeResult;
      setCheck({ status: "done", result });
      if (result.reachable) {
        if (!name.trim() && result.name) setName(result.name);
        if (!description.trim() && result.description) {
          setDescription(result.description);
        }
      }
    } catch (err: any) {
      setCheck({ status: "error", message: err?.message ?? "Check failed" });
    }
  }, [url, cardUrl, name, description, auth, kind, t]);

  const handleAdd = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (
      !trimmedName ||
      (!trimmedUrl && kind?.provider !== "anthropic-managed-agents")
    )
      return;
    const trimmedDescription = description.trim();
    try {
      const ok = await onAdd(
        trimmedName,
        trimmedUrl,
        trimmedDescription,
        cardUrl.trim(),
        auth,
        kind,
      );
      if (ok) {
        setAdded({
          name: trimmedName,
          url: trimmedUrl || ANTHROPIC_MANAGED_AGENT_DEFAULT_URL,
          description: trimmedDescription,
          provider:
            kind?.provider === "anthropic-managed-agents"
              ? "anthropic-managed-agents"
              : "a2a",
        });
      }
    } catch (error) {
      setCheck({
        status: "error",
        message: error instanceof Error ? error.message : "Could not add agent",
      });
    }
  };

  if (added) {
    return (
      <div
        ref={popoverRef}
        className="absolute end-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-popover p-2.5 shadow-lg"
      >
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Added {added.name} on your side only — registration is one-way, so
            it won&apos;t know about this app until it&apos;s added there too.
          </p>
          {added.provider === "a2a" ? (
            <a
              href={buildPeerRegisterBackLink(added.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex cursor-pointer items-center justify-center gap-1 rounded bg-accent px-2 py-1 text-[10px] font-medium text-foreground no-underline hover:bg-accent/80"
            >
              <IconExternalLink size={10} />
              Open {added.name}&apos;s settings
            </a>
          ) : (
            <p className="text-[10px] text-primary">
              {t("agentChat.agents.managedAgentSaved")}
            </p>
          )}
          <button
            onClick={onClose}
            className="cursor-pointer rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  const result = check.status === "done" ? check.result : null;
  const unreachable = result ? !result.reachable : false;
  const unauthorized = result ? result.authorized === false : false;

  return (
    <div
      ref={popoverRef}
      className="absolute end-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-popover p-2.5 shadow-lg"
    >
      <div className="flex flex-col gap-1.5">
        {kind?.provider !== "anthropic-managed-agents" && (
          <div className="flex gap-1">
            <input
              ref={urlRef}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setCheck({ status: "idle" });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCheck();
                if (e.key === "Escape") onClose();
              }}
              className="w-full flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
              placeholder="URL (e.g. http://localhost:8085)"
            />
            <ToolkitButtonBase
              type="button"
              variant="outline"
              onClick={handleCheck}
              disabled={!url.trim() || check.status === "checking"}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-40"
            >
              {check.status === "checking" ? (
                <IconLoader2 size={10} className="animate-spin" />
              ) : (
                "Check"
              )}
            </ToolkitButtonBase>
          </div>
        )}
        {kind?.provider === "anthropic-managed-agents" && (
          <div className="flex justify-end">
            <ToolkitButtonBase
              type="button"
              variant="outline"
              onClick={handleCheck}
              disabled={!url.trim() || check.status === "checking"}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-40"
            >
              {check.status === "checking" ? (
                <IconLoader2 size={10} className="animate-spin" />
              ) : (
                "Check"
              )}
            </ToolkitButtonBase>
          </div>
        )}

        {check.status === "error" && (
          <p className="flex items-start gap-1 text-[10px] text-destructive">
            <IconAlertTriangle size={11} className="mt-px shrink-0" />
            {check.message}
          </p>
        )}
        {result && (
          <div
            className={`flex items-start gap-1 text-[10px] ${
              unreachable || unauthorized
                ? "text-amber-600 dark:text-amber-400"
                : "text-primary"
            }`}
          >
            {unreachable || unauthorized ? (
              <IconAlertTriangle size={11} className="mt-px shrink-0" />
            ) : (
              <IconCheck size={11} className="mt-px shrink-0" />
            )}
            <span className="leading-relaxed">
              {describeCheckResult(result)}
              {unreachable &&
                " — the app may just not be running yet; you can still add it."}
            </span>
          </div>
        )}
        {unauthorized &&
          (secretSet === true ? (
            <button
              onClick={() => syncSecret.mutate(undefined)}
              disabled={syncSecret.isPending}
              className="inline-flex cursor-pointer items-center gap-1 self-start rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {syncSecret.isPending ? (
                <IconLoader2 size={10} className="animate-spin" />
              ) : (
                <IconRefresh size={10} />
              )}
              Sync secret to apps
            </button>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              {secretSet === false ? (
                <>
                  No shared secret set yet —{" "}
                  <a
                    href={appMountedPath(
                      buildSettingsRoute(STANDARD_SETTINGS_TABS.team),
                      STANDARD_APP_ROUTES.settings,
                    )}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    set one on the Team page
                  </a>{" "}
                  first.
                </>
              ) : (
                "Ask your workspace owner to sync the shared secret."
              )}
            </p>
          ))}

        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
          placeholder="Name"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
          placeholder="Description (optional)"
        />
        <HostedAgentFields
          url={url}
          onUrlChange={(value) => {
            setUrl(value);
            setCheck({ status: "idle" });
          }}
          cardUrl={cardUrl}
          onCardUrlChange={(value) => {
            setCardUrl(value);
            setCheck({ status: "idle" });
          }}
          auth={auth}
          onAuthChange={(value) => {
            setAuth(value);
            setCheck({ status: "idle" });
          }}
          kind={kind}
          onKindChange={(value) => {
            setKind(value);
            setCheck({ status: "idle" });
          }}
          credentialOptions={credentialOptions}
          openOnMount={Boolean(initialProvider)}
        />
        <div className="flex justify-end gap-1 pt-0.5">
          <button
            onClick={onClose}
            className="cursor-pointer rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={
              !name.trim() ||
              (!url.trim() && kind?.provider !== "anthropic-managed-agents")
            }
            className="cursor-pointer rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40"
          >
            {unreachable ? "Add anyway" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function A2ASecretStatusRow({
  org,
  syncSecret,
}: {
  org: { a2aSecretSet?: boolean; allowedDomain: string | null } | undefined;
  syncSecret: ReturnType<typeof useSyncA2ASecret>;
}) {
  if (!org) return null;
  const secretSet = org.a2aSecretSet;

  if (secretSet === undefined) {
    return (
      <div className="mb-2 rounded-md border border-border/60 bg-accent/20 px-2 py-1.5 text-[10px] text-muted-foreground">
        Shared secret is managed by your workspace owner.
      </div>
    );
  }

  if (!secretSet) {
    return (
      <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">
        No shared secret set — connected apps will reject calls in production.{" "}
        <a
          href={appMountedPath(
            buildSettingsRoute(STANDARD_SETTINGS_TABS.team),
            STANDARD_APP_ROUTES.settings,
          )}
          className="underline underline-offset-2 hover:text-amber-500"
        >
          Set one on the Team page
        </a>
      </div>
    );
  }

  const noDomain = syncSecret.error?.message?.toLowerCase().includes("domain");
  const failures = syncSecret.data?.results.filter((r) => !r.ok) ?? [];

  return (
    <div className="mb-2 flex flex-col gap-1 rounded-md border border-border/60 bg-accent/20 px-2 py-1.5 text-[10px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">
          Shared secret set
          {org.allowedDomain ? ` for ${org.allowedDomain}` : ""}
        </span>
        <button
          onClick={() => syncSecret.mutate(undefined)}
          disabled={syncSecret.isPending}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {syncSecret.isPending ? (
            <IconLoader2 size={10} className="animate-spin" />
          ) : (
            <IconRefresh size={10} />
          )}
          Sync to apps
        </button>
      </div>
      {syncSecret.data && !syncSecret.isPending && (
        <div className="text-muted-foreground">
          Synced to {syncSecret.data.succeeded}/{syncSecret.data.total} app
          {syncSecret.data.total === 1 ? "" : "s"}
          {syncSecret.data.failed > 0
            ? ` (${syncSecret.data.failed} failed)`
            : ""}
          .
          {failures.length > 0 && (
            <ul className="mt-0.5 list-disc ps-3 text-red-500">
              {failures.map((r) => (
                <li key={r.id}>
                  {r.name}: {r.error ?? `HTTP ${r.status ?? "?"}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {syncSecret.error && (
        <p className="text-red-500">
          {syncSecret.error.message}
          {noDomain && (
            <>
              {" "}
              <a
                href={appMountedPath(
                  buildSettingsRoute(STANDARD_SETTINGS_TABS.team),
                  STANDARD_APP_ROUTES.settings,
                )}
                className="underline underline-offset-2"
              >
                Set the domain
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

const PREFILL_PARAMS = [
  "f_agentName",
  "f_agentUrl",
  "f_agentDescription",
] as const;

export function AgentsSection() {
  const t = useT();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [prefill, setPrefill] = useState<{
    name: string;
    url: string;
    description: string;
  } | null>(null);
  const [connectProvider, setConnectProvider] = useState<
    HostedAgentProvider | undefined
  >();
  const [probeById, setProbeById] = useState<Map<
    string,
    AgentProbeResult
  > | null>(null);
  const [credentialOptions, setCredentialOptions] = useState<NewKeyOption[]>(
    [],
  );

  const orgQuery = useOrg();
  const { data: org } = orgQuery;
  const syncSecret = useSyncA2ASecret();
  const canManageSharedAgents =
    !orgQuery.isLoading &&
    !orgQuery.isError &&
    (!org?.orgId || org.role === "owner" || org.role === "admin");

  useEffect(() => {
    let cancelled = false;
    fetch(agentNativePath("/_agent-native/secrets"))
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return;
        const options = (data as SecretStatusOption[])
          .filter(
            (secret) =>
              secret.status === "set" &&
              secret.source !== "env" &&
              typeof secret.key === "string" &&
              typeof secret.label === "string",
          )
          .map((secret) => ({
            key: secret.key,
            label: secret.label,
            hint:
              secret.source === "vault"
                ? t("agentChat.agents.vault")
                : undefined,
          }));
        setCredentialOptions(options);
      })
      .catch(() => {
        if (!cancelled) setCredentialOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("connect");
    if (provider === "a2a" || provider === "anthropic-managed-agents") {
      setConnectProvider(provider);
      setShowAdd(true);
    } else if (provider === "manual") {
      setConnectProvider(undefined);
      setShowAdd(true);
    }
    if (provider) {
      params.delete("connect");
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
      );
    }
    const url = params.get("f_agentUrl");
    if (!url) return;
    setPrefill({
      name: params.get("f_agentName") ?? "",
      url,
      description: params.get("f_agentDescription") ?? "",
    });
    setShowAdd(true);
    for (const key of PREFILL_PARAMS) params.delete(key);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(agentNativePath("/_agent-native/agents/probe"))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const results = Array.isArray(data.results)
          ? (data.results as Array<AgentProbeResult & { id: string }>)
          : [];
        const map = new Map<string, AgentProbeResult>();
        for (const result of results) map.set(result.id.toLowerCase(), result);
        setProbeById(map);
      })
      .catch(() => {
        if (!cancelled) setProbeById(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/resources?scope=all"),
      );
      if (!res.ok) return;
      const data = await res.json();
      const byAgentId = new Map<string, { id: string; path: string }>();
      for (const resource of (data.resources ?? []) as Array<{
        id: string;
        path: string;
      }>) {
        if (!isRemoteAgentPath(resource.path)) continue;
        const agentId = getRemoteAgentIdFromPath(resource.path);
        const existing = byAgentId.get(agentId);
        if (existing?.path.startsWith(REMOTE_AGENT_RESOURCE_PREFIX)) continue;
        byAgentId.set(agentId, resource);
      }
      const agentResources = [...byAgentId.values()];
      const parsed = await Promise.all(
        agentResources.map(async (r): Promise<AgentInfo | null> => {
          try {
            const detail = await fetch(
              agentNativePath(`/_agent-native/resources/${r.id}`),
            );
            if (!detail.ok) return null;
            const d = await detail.json();
            const config = JSON.parse(d.content);
            const hasAuth = config.auth !== undefined && config.auth !== null;
            const auth = parseHostedAuth(config.auth);
            if (hasAuth && !auth) return null;
            const hasKind = config.kind !== undefined && config.kind !== null;
            const kind = parseRemoteAgentKind(config.kind);
            if (hasKind && !kind) return null;
            const hostedCredential = Boolean(auth || kind);
            const url =
              typeof config.url === "string" && config.url.trim()
                ? normalizeHostedAgentUrl(config.url, {
                    requireHttps: hostedCredential,
                  })
                : kind?.provider === "anthropic-managed-agents"
                  ? "https://api.anthropic.com"
                  : undefined;
            if (!url) return null;
            const rawCardUrl =
              typeof config.cardUrl === "string" ? config.cardUrl.trim() : "";
            const cardUrl = normalizeHostedAgentCardUrl(rawCardUrl, kind, auth);
            if (
              rawCardUrl &&
              kind?.provider !== "anthropic-managed-agents" &&
              !cardUrl
            )
              return null;
            return {
              id: r.id,
              path: r.path,
              name: config.name,
              url,
              description: config.description,
              cardUrl,
              auth,
              kind,
            };
          } catch {
            return null;
          }
        }),
      );
      setAgents(parsed.filter((agent): agent is AgentInfo => agent !== null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const handleAdd = async (
    name: string,
    url: string,
    description: string,
    cardUrl: string,
    auth?: HostedAgentAuth,
    kind?: RemoteAgentKind,
  ): Promise<boolean> => {
    const normalizedKind = kind ? parseRemoteAgentKind(kind) : undefined;
    if (kind && !normalizedKind) {
      throw new Error(t("agentChat.agents.managedAgentIncomplete"));
    }
    const normalizedAuth = normalizeHostedAuth(auth);
    if (auth && !normalizedAuth) {
      throw new Error(t("agentChat.agents.authIncomplete"));
    }
    if (normalizedKind && normalizedAuth) {
      throw new Error(t("agentChat.agents.authIncomplete"));
    }
    const normalizedUrl = normalizeHostedAgentUrl(
      url ||
        (normalizedKind?.provider === "anthropic-managed-agents"
          ? ANTHROPIC_MANAGED_AGENT_DEFAULT_URL
          : ""),
      {
        requireHttps: Boolean(normalizedAuth || normalizedKind),
      },
    );
    if (!normalizedUrl) throw new Error(t("agentChat.agents.invalidUrl"));
    const normalizedCardUrl = normalizeHostedAgentCardUrl(
      cardUrl,
      normalizedKind,
      normalizedAuth,
    );
    if (!normalizedKind && cardUrl.trim() && !normalizedCardUrl) {
      throw new Error(t("agentChat.agents.invalidUrl"));
    }
    const id = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const optimisticAgent: AgentInfo = {
      id: `optimistic-${id}`,
      path: remoteAgentResourcePath(id),
      name,
      url: normalizedUrl,
      description: description || undefined,
      cardUrl: normalizedCardUrl,
      auth: normalizedAuth,
      kind: normalizedKind,
    };
    const previousAgents = agents;
    setAgents((current) => [...current, optimisticAgent]);
    const agentJson = JSON.stringify(
      {
        id,
        name,
        description: description || undefined,
        url: normalizedUrl,
        cardUrl: normalizedCardUrl,
        auth: normalizedAuth,
        ...(normalizedKind ? { kind: normalizedKind } : {}),
        color: "#6B7280",
      },
      null,
      2,
    );

    try {
      const res = await fetch(agentNativePath("/_agent-native/resources"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: remoteAgentResourcePath(id),
          content: agentJson,
          shared: true,
        }),
      });
      if (!res.ok) {
        let body: { error?: string; message?: string } | null;
        try {
          body = (await res.json()) as {
            error?: string;
            message?: string;
          };
        } catch {
          throw new Error(`Add failed (${res.status})`);
        }
        throw new Error(
          body?.error ?? body?.message ?? `Add failed (${res.status})`,
        );
      }
    } catch (error) {
      setAgents(previousAgents);
      throw error;
    }
    void fetchAgents();
    return true;
  };

  const handleSave = async (agent: AgentInfo) => {
    const normalizedKind = agent.kind
      ? parseRemoteAgentKind(agent.kind)
      : undefined;
    if (agent.kind && !normalizedKind) {
      throw new Error(t("agentChat.agents.managedAgentIncomplete"));
    }
    const normalizedAuth = normalizeHostedAuth(agent.auth);
    if (agent.auth && !normalizedAuth) {
      throw new Error(t("agentChat.agents.authIncomplete"));
    }
    if (normalizedKind && normalizedAuth) {
      throw new Error(t("agentChat.agents.authIncomplete"));
    }
    const normalizedUrl = normalizeHostedAgentUrl(
      agent.url ||
        (normalizedKind?.provider === "anthropic-managed-agents"
          ? ANTHROPIC_MANAGED_AGENT_DEFAULT_URL
          : ""),
      {
        requireHttps: Boolean(normalizedAuth || normalizedKind),
      },
    );
    if (!normalizedUrl) throw new Error(t("agentChat.agents.invalidUrl"));
    const trimmedCardUrl = agent.cardUrl?.trim() ?? "";
    const normalizedCardUrl = normalizeHostedAgentCardUrl(
      trimmedCardUrl,
      normalizedKind,
      normalizedAuth,
    );
    if (!normalizedKind && trimmedCardUrl && !normalizedCardUrl)
      throw new Error(t("agentChat.agents.invalidUrl"));
    const previousAgents = agents;
    setAgents((current) =>
      current.map((currentAgent) =>
        currentAgent.id === agent.id
          ? {
              ...agent,
              url: normalizedUrl,
              cardUrl: normalizedCardUrl,
              auth: normalizedAuth,
              kind: normalizedKind,
            }
          : currentAgent,
      ),
    );
    const agentJson = JSON.stringify(
      {
        id: getRemoteAgentIdFromPath(agent.path),
        name: agent.name,
        description: agent.description || undefined,
        url: normalizedUrl,
        cardUrl: normalizedCardUrl,
        auth: normalizedAuth,
        ...(normalizedKind ? { kind: normalizedKind } : {}),
        color: "#6B7280",
      },
      null,
      2,
    );

    try {
      const res = await fetch(
        agentNativePath(`/_agent-native/resources/${agent.id}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: agentJson }),
        },
      );
      if (!res.ok) {
        let body: { error?: string; message?: string } | null;
        try {
          body = (await res.json()) as {
            error?: string;
            message?: string;
          };
        } catch {
          body = null;
        }
        throw new Error(
          body?.error ?? body?.message ?? `Save failed (${res.status})`,
        );
      }
      setEditingAgent(null);
      void fetchAgents();
    } catch (error) {
      setAgents(previousAgents);
      throw error;
    }
  };

  const handleDelete = async (agentId: string) => {
    const previousAgents = agents;
    setAgents((current) => current.filter((agent) => agent.id !== agentId));
    try {
      const res = await fetch(
        agentNativePath(`/_agent-native/resources/${agentId}`),
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (res.ok) {
        setEditingAgent(null);
        void fetchAgents();
      } else {
        setAgents(previousAgents);
      }
    } catch {
      setAgents(previousAgents);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
        {canManageSharedAgents ? (
          <div className="relative">
            <button
              onClick={() => {
                setShowAdd(!showAdd);
                setEditingAgent(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              {showAdd ? <IconX size={13} /> : <IconPlus size={13} />}
              {showAdd ? "Cancel" : "Connect agent"}
            </button>
            {showAdd && (
              <AgentAddPopover
                initialName={prefill?.name}
                initialUrl={prefill?.url}
                initialDescription={prefill?.description}
                initialProvider={connectProvider}
                credentialOptions={credentialOptions}
                secretSet={org?.a2aSecretSet}
                syncSecret={syncSecret}
                onAdd={handleAdd}
                onClose={() => {
                  setShowAdd(false);
                  setPrefill(null);
                  setConnectProvider(undefined);
                }}
              />
            )}
          </div>
        ) : !orgQuery.isLoading ? (
          <span className="text-[10px] text-muted-foreground">
            Only workspace owners and admins can connect agents.
          </span>
        ) : null}
      </div>

      <A2ASecretStatusRow org={org} syncSecret={syncSecret} />

      {/* Agent list */}
      {loading ? (
        <div
          className="space-y-1.5"
          role="status"
          aria-busy="true"
          aria-label="Loading connected agents"
        >
          <Skeleton className="h-6 w-full bg-muted/50" />
          <Skeleton className="h-6 w-3/4 bg-muted/50" />
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-border/70 bg-card px-5 py-8 text-center">
          <span className="mb-2 flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <IconTopologyRing2 size={17} />
          </span>
          <p className="text-sm font-medium text-foreground">
            No connected agents yet
          </p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            Connect an A2A agent to delegate work from chat.
          </p>
          {canManageSharedAgents ? (
            <button
              onClick={() => setShowAdd(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              <IconPlus size={13} />
              Connect agent
            </button>
          ) : !orgQuery.isLoading ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Ask a workspace owner or admin to connect an agent.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground">
          <div className="divide-y divide-border/60 px-4">
            {agents.map((agent) => {
              const probe = probeById?.get(
                getRemoteAgentIdFromPath(agent.path).toLowerCase(),
              );
              const dotState: "ok" | "warn" | null = !probe
                ? null
                : probe.reachable && probe.authorized !== false
                  ? "ok"
                  : "warn";
              return (
                <div key={agent.id} className="group relative">
                  <div className="flex w-full items-center gap-3 py-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                      <IconTopologyRing2 size={15} />
                    </span>
                    {dotState ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              dotState === "ok"
                                ? "bg-primary"
                                : "bg-destructive"
                            }`}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          {probe && describeProbeTooltip(probe)}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-transparent" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {agent.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {agent.cardUrl || agent.url}
                      </span>
                    </div>
                    {(() => {
                      const status = probeStatus(probe);
                      if (!status) return null;
                      const label =
                        status === "reachable"
                          ? t("agentChat.agents.statusReachable")
                          : status === "auth-rejected"
                            ? t("agentChat.agents.statusAuthRejected")
                            : t("agentChat.agents.statusNoJsonRpc");
                      return (
                        <span
                          className={`shrink-0 text-[10px] ${
                            status === "reachable"
                              ? "text-primary"
                              : "text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {label}
                        </span>
                      );
                    })()}
                    {canManageSharedAgents ? (
                      <button
                        onClick={() => {
                          setEditingAgent(
                            editingAgent === agent.id ? null : agent.id,
                          );
                          setShowAdd(false);
                        }}
                        className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                      >
                        Manage
                      </button>
                    ) : null}
                  </div>
                  {canManageSharedAgents && editingAgent === agent.id && (
                    <AgentEditPopover
                      agent={agent}
                      credentialOptions={credentialOptions}
                      onSave={handleSave}
                      onDelete={handleDelete}
                      onClose={() => setEditingAgent(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
