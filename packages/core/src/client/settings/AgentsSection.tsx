import {
  Picker,
  Skeleton,
  TextField,
} from "@agent-native/toolkit/design-system";
import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import {
  Button,
  ButtonBase as ToolkitButtonBase,
} from "@agent-native/toolkit/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@agent-native/toolkit/ui/collapsible";
import { DialogFooter } from "@agent-native/toolkit/ui/dialog";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
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
  IconAlertCircle,
} from "@tabler/icons-react";
import {
  useState,
  useEffect,
  useId,
  useRef,
  useCallback,
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

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
import { useChangeVersion } from "../use-change-version.js";
import { cn } from "../utils.js";
import { NewKeyMenu, type NewKeyOption } from "./NewKeyMenu.js";

/** A registered remote agent: one `remote-agents/<id>.json` manifest. */
export interface RemoteAgentInfo {
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
export type HostedAgentProvider = "a2a" | "anthropic-managed-agents";

const ANTHROPIC_MANAGED_AGENT_DEFAULT_URL = "https://api.anthropic.com";

/** The Settings id that opens the Connected agents list and its Add form. */
export const CONNECTED_AGENTS_SETTINGS_ID = "agent:agents";

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

/** Wire shape of `GET /_agent-native/agents/probe` (single or batched result). */
export interface AgentProbeResult {
  url: string;
  reachable: boolean;
  cardStatus?: "reachable" | "auth-rejected" | "no-json-rpc";
  name?: string;
  description?: string;
  securitySchemes?: string[];
  /** Absent (not false) whenever the auth check never ran or never resolved. */
  authorized?: boolean;
  authError?: string;
  publicSkills?: number;
  error?: string;
}

export function probeStatus(
  result: AgentProbeResult | undefined,
): "reachable" | "auth-rejected" | "no-json-rpc" | null {
  if (!result) return null;
  if (result.cardStatus) return result.cardStatus;
  if (/json.?rpc/i.test(result.error ?? "")) return "no-json-rpc";
  if (result.authorized === false) return "auth-rejected";
  return result.reachable ? "reachable" : null;
}

type Translate = ReturnType<typeof useT>;

function describeSkills(
  publicSkills: number | undefined,
  t: Translate,
): string | null {
  if (publicSkills === undefined) return null;
  // An empty public skill list only means the card advertises no anonymous-
  // safe actions — the peer still has authenticated reads/writes. Saying so
  // plainly avoids reading as "this agent can't do anything."
  if (publicSkills === 0) return t("agentChat.agents.checkReadsRequireAuth");
  return t("agentChat.agents.checkPublicSkills", { count: publicSkills });
}

/** One-line status for the row dot tooltip. */
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

/** Multi-clause status line for the Add popover's Check result. */
function describeCheckResult(result: AgentProbeResult, t: Translate): string {
  if (!result.reachable) {
    return result.error ?? t("agentChat.agents.checkNotReachable");
  }
  const scheme = result.securitySchemes?.length
    ? result.securitySchemes.join(", ")
    : t("agentChat.agents.checkNoAuthScheme");
  const authText =
    result.authorized === false
      ? t("agentChat.agents.checkTokenRejected")
      : result.authorized === undefined
        ? result.authError
          ? t("agentChat.agents.checkTokenUnverifiedReason", {
              reason: result.authError,
            })
          : t("agentChat.agents.checkTokenUnverified")
        : t("agentChat.agents.checkTokenWorks");
  const skills = describeSkills(result.publicSkills, t);
  return [t("agentChat.agents.checkLive", { scheme }), authText, skills]
    .filter(Boolean)
    .join(" · ");
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
  variant = "compact",
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
  variant?: AgentFormVariant;
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

  const providerOptions = [
    { value: "a2a", label: t("agentChat.agents.providerA2A") },
    {
      value: "anthropic-managed-agents",
      label: t("agentChat.agents.providerAnthropic"),
    },
  ];
  const authOptions = [
    { value: "none", label: t("agentChat.agents.authNone") },
    { value: "bearer", label: t("agentChat.agents.authBearer") },
    {
      value: "oauth-client-credentials",
      label: t("agentChat.agents.authClientCredentials"),
    },
  ];

  if (variant === "dialog") {
    const credentialField = (
      selected: string | undefined,
      onPick: (key: string) => void,
    ) => {
      const menu = (label: string, size: "xs" | "default") => (
        <NewKeyMenu
          options={credentialOptions}
          label={label}
          size={size}
          variant={size === "xs" ? "ghost" : "secondary"}
          onPick={(option) => onPick(option.key)}
          onCustom={(name) => {
            if (name) onPick(name);
          }}
          triggerClassName="shrink-0"
        />
      );
      if (!selected) {
        return (
          <div className="justify-self-start">
            {menu(t("agentChat.agents.chooseCredential"), "default")}
          </div>
        );
      }
      return (
        <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-background ps-3 pe-1.5">
          <span className="min-w-0 truncate text-sm">
            {credentialOptions.find((option) => option.key === selected)
              ?.label ?? selected}
          </span>
          {menu(t("agentChat.settingsModel.change"), "xs")}
        </div>
      );
    };
    return (
      <Collapsible open={open} onOpenChange={setOpen} className="grid gap-4">
        <CollapsibleTrigger className="group/hosted flex items-center gap-1 justify-self-start rounded-sm text-sm font-medium text-foreground outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          {t("agentChat.agents.hostedAgent")}
          <IconChevronDown
            className="size-4 transition-transform duration-200 group-data-[state=open]/hosted:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-4">
          <Picker
            mode="select"
            value={provider}
            onChange={(value) => {
              if (value) updateProvider(String(value));
            }}
            label={t("agentChat.agents.provider")}
            options={providerOptions}
          />
          {provider === "a2a" ? (
            <>
              <TextField
                value={cardUrl}
                onChange={onCardUrlChange}
                label={t("agentChat.agents.cardUrl")}
                placeholder={t("agentChat.agents.cardUrlPlaceholder")}
              />
              <Picker
                mode="select"
                value={authType}
                onChange={(value) => updateAuthType(String(value))}
                label={t("agentChat.agents.authType")}
                options={authOptions}
              />
              {authType !== "none" &&
                credentialField(
                  selectedCredentialRef || undefined,
                  updateCredentialRef,
                )}
              {oauthAuth && (
                <>
                  <TextField
                    value={oauthAuth.tokenUrl}
                    onChange={(value) =>
                      onAuthChange({ ...oauthAuth, tokenUrl: value })
                    }
                    label={t("agentChat.agents.tokenUrl")}
                  />
                  <TextField
                    value={oauthAuth.clientId}
                    onChange={(value) =>
                      onAuthChange({ ...oauthAuth, clientId: value })
                    }
                    label={t("agentChat.agents.clientId")}
                  />
                  <TextField
                    value={oauthAuth.scope ?? ""}
                    onChange={(value) =>
                      onAuthChange({ ...oauthAuth, scope: value })
                    }
                    label={t("agentChat.agents.scope")}
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
                placeholder={t("agentChat.agents.apiBaseUrlPlaceholder")}
              />
              <TextField
                value={managedKind?.agentId ?? ""}
                onChange={(value) => updateManagedKind("agentId", value)}
                label={t("agentChat.agents.agentId")}
                placeholder={t("agentChat.agents.agentIdPlaceholder")}
              />
              <TextField
                value={managedKind?.environmentId ?? ""}
                onChange={(value) => updateManagedKind("environmentId", value)}
                label={t("agentChat.agents.environmentId")}
                placeholder={t("agentChat.agents.environmentIdPlaceholder")}
              />
              {credentialField(managedKind?.credentialRef || undefined, (key) =>
                updateManagedKind("credentialRef", key),
              )}
            </>
          )}
        </CollapsibleContent>
      </Collapsible>
    );
  }

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
          options={providerOptions}
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
              options={authOptions}
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

/** `compact` fits today's inline popovers; `dialog` fills a Settings dialog. */
export type AgentFormVariant = "compact" | "dialog";

/** The inline popovers' compact controls; the dialog uses toolkit ones. */
const COMPACT_FORM_CLASSES = {
  stack: "flex flex-col gap-1.5",
  field:
    "w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent",
  text: "text-[10px]",
  primary:
    "cursor-pointer rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40",
  secondary:
    "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-40",
  ghost:
    "cursor-pointer rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground",
  destructive:
    "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/10",
  footer: "pt-0.5",
};

/** A failed save in a dialog form: the server's message, above the footer. */
function FormErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <IconAlertCircle />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** Edit one registered agent: name, endpoint, description, hosted auth. */
export function AgentEditForm({
  agent,
  credentialOptions,
  onSave,
  onDelete,
  onClose,
  variant = "compact",
}: {
  agent: RemoteAgentInfo;
  credentialOptions: NewKeyOption[];
  onSave: (agent: RemoteAgentInfo) => Promise<void> | void;
  /** Omit to hide Remove (the caller offers it elsewhere). */
  onDelete?: (id: string) => void;
  onClose: () => void;
  variant?: AgentFormVariant;
}) {
  const t = useT();
  const classes = COMPACT_FORM_CLASSES;
  const [name, setName] = useState(agent.name);
  const [url, setUrl] = useState(agent.url);
  const [description, setDescription] = useState(agent.description ?? "");
  const [cardUrl, setCardUrl] = useState(agent.cardUrl ?? "");
  const [auth, setAuth] = useState<HostedAgentAuth | undefined>(agent.auth);
  const [kind, setKind] = useState<RemoteAgentKind | undefined>(agent.kind);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canSave =
    !!name.trim() &&
    (!!url.trim() || kind?.provider === "anthropic-managed-agents");

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
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
        error instanceof Error
          ? error.message
          : t("agentChat.agents.formSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  if (variant === "dialog") {
    return (
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <TextField
          value={name}
          onChange={setName}
          label={t("agentChat.agents.formName")}
          autoFocus
        />
        {kind?.provider !== "anthropic-managed-agents" && (
          <TextField
            value={url}
            onChange={setUrl}
            label={t("agentChat.agents.formUrl")}
            placeholder={t("agentChat.agents.formUrlPlaceholder")}
          />
        )}
        <TextField
          value={description}
          onChange={setDescription}
          label={t("agentChat.agents.formDescription")}
        />
        <HostedAgentFields
          variant="dialog"
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
        {saveError ? <FormErrorAlert message={saveError} /> : null}
        <DialogFooter className="gap-2 sm:space-x-0">
          {onDelete ? (
            <Button
              type="button"
              variant="secondary-destructive"
              className="sm:me-auto"
              disabled={saving}
              onClick={() => onDelete(agent.id)}
            >
              {t("agentChat.agents.formRemove")}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("agentChat.common.cancel")}
          </Button>
          <Button type="submit" disabled={!canSave || saving}>
            {saving ? <Spinner /> : null}
            {saving
              ? t("agentChat.settingsResources.saving")
              : t("agentChat.common.save")}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  // The inline popover closes on Escape; Enter saves.
  const onFieldKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter") void handleSave();
    if (e.key === "Escape") onClose();
  };

  return (
    <div className={classes.stack}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onFieldKeyDown}
        className={classes.field}
        placeholder={t("agentChat.agents.formName")}
        aria-label={t("agentChat.agents.formName")}
      />
      {kind?.provider !== "anthropic-managed-agents" && (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={onFieldKeyDown}
          className={classes.field}
          placeholder={t("agentChat.agents.formUrlPlaceholder")}
          aria-label={t("agentChat.agents.formUrl")}
        />
      )}
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={onFieldKeyDown}
        className={classes.field}
        placeholder={t("agentChat.agents.formDescriptionPlaceholder")}
        aria-label={t("agentChat.agents.formDescription")}
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
        <p className={`${classes.text} text-destructive`}>{saveError}</p>
      )}
      <div className={`flex items-center justify-between ${classes.footer}`}>
        {onDelete ? (
          <button
            type="button"
            onClick={() => onDelete(agent.id)}
            className={classes.destructive}
          >
            <IconTrash size={10} />
            {t("agentChat.agents.formRemove")}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-1">
          <button type="button" onClick={onClose} className={classes.ghost}>
            {t("agentChat.common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className={classes.primary}
          >
            {t("agentChat.common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Closes on an outside click, ignoring clicks inside Radix portals. */
function useCloseOnOutsideClick(
  ref: RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (isRadixPortalTarget(e.target)) return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose, ref]);
}

function AgentEditPopover(props: {
  agent: RemoteAgentInfo;
  credentialOptions: NewKeyOption[];
  onSave: (agent: RemoteAgentInfo) => Promise<void> | void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(popoverRef, props.onClose);
  return (
    <div
      ref={popoverRef}
      className="absolute end-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-2.5 shadow-lg"
    >
      <AgentEditForm {...props} />
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

/** Builds an absolute deep link into a peer's own Settings > Agents Add
 * popover, prefilled with THIS app's own name/url/description, via the
 * existing `/_agent-native/open` route's `f_*` filter-forwarding (the only
 * non-reserved params the open route echoes onto the redirect URL instead of
 * only stashing them server-side for `navigate` polling). No new endpoint.
 * `agent:agents` is the one id both today's tabbed Settings and the Settings
 * shell (Sub-agents) open with the Add form mounted. */
function buildPeerRegisterBackLink(peerUrl: string): string {
  const selfUrl = `${window.location.origin}${appBasePath()}`;
  const selfName = document.title.trim() || window.location.hostname;
  const openPath = buildOpenRoutePath({
    view: "settings",
    to: buildSettingsRoute(CONNECTED_AGENTS_SETTINGS_ID),
    params: {
      f_agentName: selfName,
      f_agentUrl: selfUrl,
    },
  });
  return `${peerUrl.replace(/\/+$/, "")}${openPath}`;
}

export type AgentAddHandler = (
  name: string,
  url: string,
  description: string,
  cardUrl: string,
  auth?: HostedAgentAuth,
  kind?: RemoteAgentKind,
) => Promise<boolean>;

interface AgentAddFormProps {
  initialName?: string;
  initialUrl?: string;
  initialDescription?: string;
  initialProvider?: HostedAgentProvider;
  credentialOptions: NewKeyOption[];
  secretSet: boolean | undefined;
  syncSecret: ReturnType<typeof useSyncA2ASecret>;
  onAdd: AgentAddHandler;
  onClose: () => void;
  variant?: AgentFormVariant;
}

/** Connect a remote agent by URL: check it, name it, and save it. */
export function AgentAddForm({
  initialName = "",
  initialUrl = "",
  initialDescription = "",
  initialProvider,
  credentialOptions,
  secretSet,
  syncSecret,
  onAdd,
  onClose,
  variant = "compact",
}: AgentAddFormProps) {
  const t = useT();
  const classes = COMPACT_FORM_CLASSES;
  const iconSize = 10;
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
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const canAdd =
    !!name.trim() &&
    (!!url.trim() || kind?.provider === "anthropic-managed-agents");

  useEffect(() => {
    const t = setTimeout(
      () => (urlRef.current?.value ? nameRef : urlRef).current?.focus(),
      50,
    );
    return () => clearTimeout(t);
  }, []);

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
          message:
            body?.error ??
            t("agentChat.agents.checkFailedStatus", { status: res.status }),
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
      setCheck({
        status: "error",
        message: err?.message ?? t("agentChat.agents.checkFailed"),
      });
    }
  }, [url, cardUrl, name, description, auth, kind, t]);

  const handleAdd = async () => {
    if (!canAdd || adding) return;
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    const trimmedDescription = description.trim();
    setAdding(true);
    setAddError(null);
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
      setAddError(
        error instanceof Error
          ? error.message
          : t("agentChat.agents.formAddFailed"),
      );
    } finally {
      setAdding(false);
    }
  };

  // The inline popover closes on Escape; a dialog owns Escape itself.
  const closeOnEscape = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  if (variant === "dialog") {
    if (added) {
      return (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            {t("agentChat.agents.addedOneWay", { name: added.name })}
          </p>
          {added.provider === "a2a" ? (
            <Button asChild variant="secondary" className="justify-self-start">
              <a
                href={buildPeerRegisterBackLink(added.url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <IconExternalLink />
                {t("agentChat.agents.openPeerSettings", { name: added.name })}
              </a>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("agentChat.agents.managedAgentSaved")}
            </p>
          )}
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              {t("agentChat.common.dismiss")}
            </Button>
          </DialogFooter>
        </div>
      );
    }
    const checked = check.status === "done" ? check.result : null;
    const warn = checked
      ? !checked.reachable || checked.authorized === false
      : false;
    const checking = check.status === "checking";
    const checkStatusId = `${formId}-check`;
    const checkStatus = (
      <p
        id={checkStatusId}
        aria-live="polite"
        className={cn(
          "flex min-h-5 items-start gap-1.5 text-xs leading-5",
          check.status === "error"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      >
        {check.status === "error" ? (
          <>
            <IconAlertTriangle
              className="mt-0.5 size-3.5 shrink-0"
              aria-hidden
            />
            {check.message}
          </>
        ) : checked ? (
          <>
            {warn ? (
              <IconAlertTriangle
                className="mt-0.5 size-3.5 shrink-0 text-destructive"
                aria-hidden
              />
            ) : (
              <IconCheck
                className="mt-0.5 size-3.5 shrink-0 text-primary"
                aria-hidden
              />
            )}
            <span>
              {describeCheckResult(checked, t)}
              {!checked.reachable ? (
                <span className="block">
                  {t("agentChat.agents.unreachableHint")}
                </span>
              ) : null}
            </span>
          </>
        ) : (
          t("agentChat.settingsSubAgents.anyAgentHint")
        )}
      </p>
    );
    const checkButton = (
      <Button
        type="button"
        variant="secondary"
        className="shrink-0"
        disabled={!url.trim() || checking}
        onClick={() => void handleCheck()}
      >
        {checking ? <Spinner /> : null}
        {t("agentChat.agents.formCheck")}
      </Button>
    );
    return (
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleAdd();
        }}
      >
        {kind?.provider !== "anthropic-managed-agents" ? (
          <div className="grid gap-1.5">
            <TextField
              value={url}
              onChange={(value) => {
                setUrl(value);
                setCheck({ status: "idle" });
              }}
              label={t("agentChat.agents.formUrl")}
              placeholder={t("agentChat.agents.formUrlPlaceholder")}
              inputRef={urlRef}
              invalid={check.status === "error"}
              aria-describedby={checkStatusId}
              trailingContent={checkButton}
              onKeyDown={(event) => {
                // Enter on the URL checks it; the name comes back from the check.
                if (event.key === "Enter" && !canAdd) {
                  event.preventDefault();
                  void handleCheck();
                }
              }}
            />
            {checkStatus}
          </div>
        ) : (
          <div className="grid gap-1.5">
            <div className="justify-self-start">{checkButton}</div>
            {checkStatus}
          </div>
        )}
        {checked?.authorized === false ? (
          secretSet === true ? (
            <Button
              type="button"
              variant="secondary"
              className="justify-self-start"
              disabled={syncSecret.isPending}
              onClick={() => syncSecret.mutate(undefined)}
            >
              {syncSecret.isPending ? <Spinner /> : <IconRefresh />}
              {t("agentChat.agents.syncSecret")}
            </Button>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              {secretSet === false ? (
                <>
                  {t("agentChat.agents.noSharedSecret")}{" "}
                  <a
                    href={appMountedPath(
                      buildSettingsRoute(STANDARD_SETTINGS_TABS.team),
                      STANDARD_APP_ROUTES.settings,
                    )}
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    {t("agentChat.agents.noSharedSecretLink")}
                  </a>
                </>
              ) : (
                t("agentChat.agents.askOwnerSyncSecret")
              )}
            </p>
          )
        ) : null}
        <TextField
          value={name}
          onChange={setName}
          label={t("agentChat.agents.formName")}
          inputRef={nameRef}
        />
        <TextField
          value={description}
          onChange={setDescription}
          label={t("agentChat.agents.formDescription")}
        />
        <HostedAgentFields
          variant="dialog"
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
        {addError ? <FormErrorAlert message={addError} /> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("agentChat.common.cancel")}
          </Button>
          <Button type="submit" disabled={!canAdd || adding}>
            {adding ? <Spinner /> : null}
            {adding
              ? t("agentChat.agents.formAdding")
              : checked && !checked.reachable
                ? t("agentChat.agents.formAddAnyway")
                : t("agentChat.agents.formAdd")}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  if (added) {
    return (
      <div className={classes.stack}>
        <p className={`${classes.text} leading-relaxed text-muted-foreground`}>
          {t("agentChat.agents.addedOneWay", { name: added.name })}
        </p>
        {added.provider === "a2a" ? (
          <a
            href={buildPeerRegisterBackLink(added.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex cursor-pointer items-center justify-center gap-1 rounded bg-accent px-2 py-1 text-[10px] font-medium text-foreground no-underline hover:bg-accent/80"
          >
            <IconExternalLink size={iconSize} />
            {t("agentChat.agents.openPeerSettings", { name: added.name })}
          </a>
        ) : (
          <p className={`${classes.text} text-primary`}>
            {t("agentChat.agents.managedAgentSaved")}
          </p>
        )}
        <button type="button" onClick={onClose} className={classes.ghost}>
          {t("agentChat.common.dismiss")}
        </button>
      </div>
    );
  }

  const result = check.status === "done" ? check.result : null;
  const unreachable = result ? !result.reachable : false;
  const unauthorized = result ? result.authorized === false : false;
  const checkButton = (
    <ToolkitButtonBase
      type="button"
      variant="outline"
      onClick={handleCheck}
      disabled={!url.trim() || check.status === "checking"}
      className={classes.secondary}
    >
      {check.status === "checking" ? (
        <IconLoader2 size={iconSize} className="animate-spin" />
      ) : (
        t("agentChat.agents.formCheck")
      )}
    </ToolkitButtonBase>
  );

  return (
    <div className={classes.stack}>
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
              closeOnEscape(e);
            }}
            className={`${classes.field} flex-1`}
            placeholder={t("agentChat.agents.formUrlPlaceholder")}
            aria-label={t("agentChat.agents.formUrl")}
          />
          {checkButton}
        </div>
      )}
      {kind?.provider === "anthropic-managed-agents" && (
        <div className="flex justify-end">{checkButton}</div>
      )}

      {check.status === "error" && (
        <p
          className={`flex items-start gap-1 ${classes.text} text-destructive`}
        >
          <IconAlertTriangle size={11} className="mt-px shrink-0" />
          {check.message}
        </p>
      )}
      {addError && (
        <p
          className={`flex items-start gap-1 ${classes.text} text-destructive`}
        >
          <IconAlertTriangle size={11} className="mt-px shrink-0" />
          {addError}
        </p>
      )}
      {result && (
        <div
          className={`flex items-start gap-1 ${classes.text} ${
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
            {describeCheckResult(result, t)}
            {unreachable && (
              <span className="block">
                {t("agentChat.agents.unreachableHint")}
              </span>
            )}
          </span>
        </div>
      )}
      {unauthorized &&
        (secretSet === true ? (
          <button
            type="button"
            onClick={() => syncSecret.mutate(undefined)}
            disabled={syncSecret.isPending}
            className={`${classes.secondary} self-start`}
          >
            {syncSecret.isPending ? (
              <IconLoader2 size={iconSize} className="animate-spin" />
            ) : (
              <IconRefresh size={iconSize} />
            )}
            {t("agentChat.agents.syncSecret")}
          </button>
        ) : (
          <p className={`${classes.text} text-muted-foreground`}>
            {secretSet === false ? (
              <>
                {t("agentChat.agents.noSharedSecret")}{" "}
                <a
                  href={appMountedPath(
                    buildSettingsRoute(STANDARD_SETTINGS_TABS.team),
                    STANDARD_APP_ROUTES.settings,
                  )}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {t("agentChat.agents.noSharedSecretLink")}
                </a>
              </>
            ) : (
              t("agentChat.agents.askOwnerSyncSecret")
            )}
          </p>
        ))}

      <input
        ref={nameRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void handleAdd();
          closeOnEscape(e);
        }}
        className={classes.field}
        placeholder={t("agentChat.agents.formName")}
        aria-label={t("agentChat.agents.formName")}
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void handleAdd();
          closeOnEscape(e);
        }}
        className={classes.field}
        placeholder={t("agentChat.agents.formDescriptionPlaceholder")}
        aria-label={t("agentChat.agents.formDescription")}
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
      <div className={`flex justify-end gap-1 ${classes.footer}`}>
        <button type="button" onClick={onClose} className={classes.ghost}>
          {t("agentChat.common.cancel")}
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={
            !name.trim() ||
            (!url.trim() && kind?.provider !== "anthropic-managed-agents")
          }
          className={classes.primary}
        >
          {unreachable
            ? t("agentChat.agents.formAddAnyway")
            : t("agentChat.agents.formAdd")}
        </button>
      </div>
    </div>
  );
}

function AgentAddPopover(props: AgentAddFormProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(popoverRef, props.onClose);
  return (
    <div
      ref={popoverRef}
      className="absolute end-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-popover p-2.5 shadow-lg"
    >
      <AgentAddForm {...props} />
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
    // Not an owner/admin — the server omits `a2aSecretSet` entirely for this
    // role rather than reporting `false`, so this must read as "can't see
    // it," never as "not set" (a claim we have no basis for).
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

/** Query params `/_agent-native/open` forwards onto the redirect target. */
const PREFILL_PARAMS = [
  "f_agentName",
  "f_agentUrl",
  "f_agentDescription",
] as const;

/** What a `?connect=` or peer "register back" deep link asked to open. */
export interface AgentConnectRequest {
  /** Absent for `?connect=manual` and register-back links. */
  provider?: HostedAgentProvider;
  prefill?: { name: string; url: string; description: string };
}

/**
 * Reads the connect deep link from the current URL. `?connect=` comes from
 * the Agent directory; `f_agent*` from a peer's register-back link (see
 * buildPeerRegisterBackLink), which the open route echoes onto the URL.
 * `strip` also removes those params, so a reload does not reopen the form.
 */
export function readAgentConnectRequest({
  strip = true,
}: { strip?: boolean } = {}): AgentConnectRequest | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const connect = params.get("connect");
  let request: AgentConnectRequest | null =
    connect === "a2a" || connect === "anthropic-managed-agents"
      ? { provider: connect }
      : connect === "manual"
        ? {}
        : null;
  const url = params.get("f_agentUrl");
  if (url) {
    request = {
      ...request,
      prefill: {
        name: params.get("f_agentName") ?? "",
        url,
        description: params.get("f_agentDescription") ?? "",
      },
    };
  }
  if (strip) stripAgentConnectParams();
  return request;
}

/**
 * Removes the connect deep-link params from the URL. The Settings shell
 * rewrites a legacy link to its page's path keeping the query, so a page
 * there strips only once the viewer is done with the form.
 */
export function stripAgentConnectParams(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const connect = params.get("connect");
  const url = params.get("f_agentUrl");
  if (!connect && !url) return;
  params.delete("connect");
  if (url) for (const key of PREFILL_PARAMS) params.delete(key);
  const query = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}

/**
 * Owners and admins write the shared `remote-agents/` manifests; so does
 * anyone in a solo deployment. The resources route enforces the same rule.
 */
export function canManageSharedAgents(
  orgQuery: Pick<ReturnType<typeof useOrg>, "data" | "isLoading" | "isError">,
): boolean {
  const org = orgQuery.data;
  return (
    !orgQuery.isLoading &&
    !orgQuery.isError &&
    (!org?.orgId || org.role === "owner" || org.role === "admin")
  );
}

export interface RemoteAgentsState {
  agents: RemoteAgentInfo[];
  /** `error` means the list could not be read, not that it is empty. */
  status: "loading" | "ready" | "error";
  /**
   * Batched probe results keyed by lowercase agent id; `null` until the probe
   * answers. A row absent from a loaded map was never probed.
   */
  probeById: Map<string, AgentProbeResult> | null;
  probeFailed: boolean;
  credentialOptions: NewKeyOption[];
  add: AgentAddHandler;
  /** Throws with a readable message when the save is refused. */
  save: (agent: RemoteAgentInfo) => Promise<void>;
  /** Resolves false when the delete failed and the row was restored. */
  remove: (resourceId: string) => Promise<boolean>;
  /** Reads the list again after it failed to load. */
  retry: () => void;
}

/**
 * The registered remote agents (`remote-agents/<id>.json`, including the
 * seeded first-party apps), with optimistic add, save, and remove. Refetches
 * when the agent writes resources, so a `resources` write shows up live.
 */
export function useRemoteAgents(): RemoteAgentsState {
  const t = useT();
  const [agents, setAgents] = useState<RemoteAgentInfo[]>([]);
  const [status, setStatus] = useState<RemoteAgentsState["status"]>("loading");
  const [probeById, setProbeById] = useState<Map<
    string,
    AgentProbeResult
  > | null>(null);
  const [probeFailed, setProbeFailed] = useState(false);
  const [savedSecrets, setSavedSecrets] = useState<SecretStatusOption[]>([]);
  const agentWrites = useChangeVersion("action");

  // The secrets list loads once; labels are applied at render so a new `t`
  // never refetches it.
  useEffect(() => {
    let cancelled = false;
    fetch(agentNativePath("/_agent-native/secrets"))
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return;
        setSavedSecrets(
          (data as SecretStatusOption[]).filter(
            (secret) =>
              secret.status === "set" &&
              secret.source !== "env" &&
              typeof secret.key === "string" &&
              typeof secret.label === "string",
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setSavedSecrets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const credentialOptions = useMemo<NewKeyOption[]>(
    () =>
      savedSecrets.map((secret) => ({
        key: secret.key,
        label: secret.label,
        hint:
          secret.source === "vault" ? t("agentChat.agents.vault") : undefined,
      })),
    [savedSecrets, t],
  );

  // One batched probe for the whole list — cheap liveness dots, not one
  // request per row. A row absent from the results (never returned) stays
  // dot-less rather than defaulting to a color that isn't backed by data.
  useEffect(() => {
    let cancelled = false;
    fetch(agentNativePath("/_agent-native/agents/probe"))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setProbeFailed(true);
          return;
        }
        const results = Array.isArray(data.results)
          ? (data.results as Array<AgentProbeResult & { id: string }>)
          : [];
        const map = new Map<string, AgentProbeResult>();
        for (const result of results) map.set(result.id.toLowerCase(), result);
        setProbeById(map);
      })
      .catch(() => {
        if (!cancelled) setProbeFailed(true);
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
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json();
      // Migrating a remote agent to the canonical `remote-agents/` prefix
      // leaves the legacy `agents/` row in place (resources/store.ts), so
      // every migrated agent has two resources pointing at one URL. Collapse
      // them the way discoverAgents does, canonical winning.
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
        agentResources.map(async (r): Promise<RemoteAgentInfo | null> => {
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
      setAgents(
        parsed.filter((agent): agent is RemoteAgentInfo => agent !== null),
      );
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [agentWrites, fetchAgents]);

  const add: AgentAddHandler = async (
    name,
    url,
    description,
    cardUrl,
    auth,
    kind,
  ) => {
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
    const optimisticAgent: RemoteAgentInfo = {
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
    // Deliberately don't close the form here — a successful add shows a
    // follow-up state (registration is one-way; the peer doesn't know
    // about us yet) that the user dismisses explicitly.
    void fetchAgents();
    return true;
  };

  const save = async (agent: RemoteAgentInfo) => {
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
      void fetchAgents();
    } catch (error) {
      setAgents(previousAgents);
      throw error;
    }
  };

  const remove = async (resourceId: string): Promise<boolean> => {
    const previousAgents = agents;
    setAgents((current) => current.filter((agent) => agent.id !== resourceId));
    try {
      const res = await fetch(
        agentNativePath(`/_agent-native/resources/${resourceId}`),
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (res.ok) {
        void fetchAgents();
        return true;
      }
      setAgents(previousAgents);
      return false;
    } catch {
      setAgents(previousAgents);
      return false;
    }
  };

  const retry = useCallback(() => {
    setStatus("loading");
    void fetchAgents();
  }, [fetchAgents]);

  return {
    agents,
    status,
    probeById,
    probeFailed,
    credentialOptions,
    add,
    save,
    remove,
    retry,
  };
}

export function AgentsSection() {
  const t = useT();
  const { agents, status, probeById, credentialOptions, add, save, remove } =
    useRemoteAgents();
  const loading = status === "loading";
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [prefill, setPrefill] = useState<AgentConnectRequest["prefill"] | null>(
    null,
  );
  const [connectProvider, setConnectProvider] = useState<
    HostedAgentProvider | undefined
  >();

  const orgQuery = useOrg();
  const { data: org } = orgQuery;
  const syncSecret = useSyncA2ASecret();
  const canManage = canManageSharedAgents(orgQuery);

  useEffect(() => {
    const request = readAgentConnectRequest();
    if (!request) return;
    setConnectProvider(request.provider);
    setPrefill(request.prefill ?? null);
    setShowAdd(true);
  }, []);

  const handleSave = async (agent: RemoteAgentInfo) => {
    await save(agent);
    setEditingAgent(null);
  };

  const handleDelete = async (agentId: string) => {
    if (await remove(agentId)) setEditingAgent(null);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
        {canManage ? (
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
                onAdd={add}
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
      ) : status === "error" ? (
        <p role="alert" className="text-xs text-destructive">
          {t("agentChat.settingsSubAgents.loadFailed")}
        </p>
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
          {canManage ? (
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
                    {canManage ? (
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
                  {canManage && editingAgent === agent.id && (
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
