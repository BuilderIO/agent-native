import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";
import {
  IconLoader2,
  IconCheck,
  IconPencil,
  IconAt,
  IconX,
  IconKey,
  IconCopy,
  IconRefresh,
  IconEye,
  IconEyeOff,
  IconCloudUpload,
} from "@tabler/icons-react";
import { useState } from "react";

import { isFreeEmailProvider } from "../../org/free-email-providers.js";
import { docsUrl } from "../../shared/docs-url.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import {
  useOrg,
  useSetOrgDomain,
  useRevealA2ASecret,
  useSetA2ASecret,
  useSyncA2ASecret,
  type SyncA2ASecretResult,
} from "./hooks.js";
import { OrgIdentitySettings } from "./OrgIdentitySettings.js";
import {
  Button,
  ErrorText,
  OrganizationDescription,
  SectionTooltipProvider,
} from "./TeamPrimitives.js";

export function DomainSettingsSection({
  domain,
  ownerEmail,
}: {
  domain: string | null;
  ownerEmail: string;
}) {
  const t = useT();
  const setOrgDomain = useSetOrgDomain();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(domain ?? "");

  const ownDomain = ownerEmail.split("@")[1]?.toLowerCase() ?? "";
  // The server only ever accepts the caller's own domain (handlers.ts
  // setDomainHandler), so a free-text field has exactly one legal value here.
  // Skip the typing ceremony and enable it directly when that value is usable.
  const canEnableOwnDomain = !!ownDomain && !isFreeEmailProvider(ownDomain);

  function save() {
    const trimmed = draft.trim().toLowerCase();
    if (trimmed === (domain ?? "")) {
      setEditing(false);
      return;
    }
    setOrgDomain.mutate(trimmed || null, {
      onSuccess: () => setEditing(false),
    });
  }

  return (
    <SettingsRow
      id="email-domain"
      label="Email domain auto-join"
      description={
        <OrganizationDescription
          help={`Anyone who signs up with an email at this domain joins the organization automatically. Only your own email domain (${ownDomain || "—"}) can be used; free email providers are not allowed.`}
          docsUrl={docsUrl("organizations-teams-permissions", {
            campaign: "organization_settings",
            content: "domain_auto_join",
          })}
        >
          Automatically add members with your work email.
        </OrganizationDescription>
      }
      control={
        !editing ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {domain ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
                  <IconAt className="h-3.5 w-3.5 text-muted-foreground" />
                  {domain}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      onClick={() => {
                        setDraft(domain);
                        setEditing(true);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <IconPencil size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit domain</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      intent="danger"
                      emphasis="ghost"
                      disabled={setOrgDomain.isPending}
                      onClick={() => setOrgDomain.mutate(null)}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <IconX size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove domain</TooltipContent>
                </Tooltip>
              </>
            ) : canEnableOwnDomain ? (
              <Button
                type="button"
                intent="primary"
                emphasis="solid"
                disabled={setOrgDomain.isPending}
                onClick={() => setOrgDomain.mutate(ownDomain)}
                className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {setOrgDomain.isPending ? (
                  <IconLoader2 size={14} className="animate-spin" />
                ) : (
                  <IconAt size={14} />
                )}
                {t("org.enableDomainJoin", { domain: ownDomain })}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder={ownDomain || "example.com"}
              className="w-44 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              autoFocus
            />
            <Button
              type="button"
              intent="primary"
              emphasis="solid"
              disabled={setOrgDomain.isPending}
              onClick={save}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {setOrgDomain.isPending ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              type="button"
              intent="neutral"
              emphasis="outline"
              onClick={() => setEditing(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
          </div>
        )
      }
    >
      {setOrgDomain.error ? <ErrorText error={setOrgDomain.error} /> : null}
    </SettingsRow>
  );
}

export function A2ASecretSection({ isSet }: { isSet: boolean }) {
  const revealA2ASecret = useRevealA2ASecret();
  const setA2ASecret = useSetA2ASecret();
  const syncA2ASecret = useSyncA2ASecret();
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [syncResult, setSyncResult] = useState<SyncA2ASecretResult | null>(
    null,
  );

  function writeClipboard(value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function toggleReveal() {
    if (secret) {
      setSecret(null);
      return;
    }
    revealA2ASecret.mutate(undefined, {
      onSuccess: (result) => setSecret(result.a2aSecret),
    });
  }

  function copyToClipboard() {
    if (secret) {
      writeClipboard(secret);
      return;
    }
    revealA2ASecret.mutate(undefined, {
      onSuccess: (result) => {
        if (result.a2aSecret) writeClipboard(result.a2aSecret);
      },
    });
  }

  // Push the current secret to all connected apps. Optionally pass the
  // PREVIOUS secret as `signSecret` so the receiving apps (which still
  // hold the previous value) can verify the JWT.
  function syncToApps(signSecret?: string) {
    setSyncResult(null);
    syncA2ASecret.mutate(signSecret ? { signSecret } : undefined, {
      onSuccess: (result) => {
        setSyncResult(result);
      },
    });
  }

  function regenerate() {
    setA2ASecret.mutate(undefined, {
      onSuccess: (result) => {
        setSecret(null);
        // Auto-sync the new secret to all connected apps. Sign with the
        // PREVIOUS secret (which peers still hold) so verification on
        // their side succeeds and they accept the new value.
        syncToApps(result.previousSecret ?? undefined);
      },
    });
  }

  function saveSecret() {
    const trimmed = pasteValue.trim();
    if (!trimmed) return;
    setA2ASecret.mutate(trimmed, {
      onSuccess: (result) => {
        setPasteMode(false);
        setPasteValue("");
        // Same auto-sync flow as regenerate: peers verify with the
        // previous secret, then update to the new pasted value.
        syncToApps(result.previousSecret ?? undefined);
      },
    });
  }

  const masked = isSet ? "••••••••••••" : "Not set";

  return (
    <SettingsRow
      id="cross-app-authentication"
      label="Cross-app authentication"
      description={
        <OrganizationDescription help="This secret authenticates cross-app delegation. Every app in the organization must share it.">
          Share one secret across connected apps.
        </OrganizationDescription>
      }
      control={
        <Popover>
          <PopoverTrigger asChild>
            <ToolkitButton
              type="button"
              variant="ghost"
              intent="neutral"
              emphasis="outline"
              className="inline-flex h-9 min-h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium leading-none text-foreground hover:bg-accent/40 active:scale-100"
            >
              Manage
            </ToolkitButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[min(420px,calc(100vw-2rem))] space-y-4 p-4"
          >
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">
                Cross-app authentication
              </h3>
              <p className="text-xs leading-5 text-muted-foreground">
                Use one shared secret across connected apps. Regenerating or
                replacing it automatically syncs the new value to those apps.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    Shared secret
                  </p>
                  <p className="mt-1 truncate font-mono text-sm text-foreground">
                    {secret ?? masked}
                  </p>
                </div>
                {isSet && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          onClick={toggleReveal}
                          disabled={revealA2ASecret.isPending}
                          aria-label={secret ? "Hide secret" : "Reveal secret"}
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          {secret ? (
                            <IconEyeOff size={14} />
                          ) : (
                            <IconEye size={14} />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {secret ? "Hide secret" : "Reveal secret"}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          onClick={copyToClipboard}
                          disabled={revealA2ASecret.isPending}
                          aria-label="Copy secret"
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          {copied ? (
                            <IconCheck size={14} className="text-primary" />
                          ) : (
                            <IconCopy size={14} />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy secret</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                intent="danger"
                emphasis="outline"
                onClick={regenerate}
                disabled={setA2ASecret.isPending || syncA2ASecret.isPending}
                className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent/50 disabled:opacity-50"
              >
                {setA2ASecret.isPending ? (
                  <IconLoader2 size={14} className="animate-spin" />
                ) : (
                  <IconRefresh size={14} />
                )}
                Regenerate
              </Button>
              {isSet ? (
                <Button
                  type="button"
                  intent="neutral"
                  emphasis="outline"
                  onClick={() => syncToApps()}
                  disabled={setA2ASecret.isPending || syncA2ASecret.isPending}
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent/50 disabled:opacity-50"
                >
                  {syncA2ASecret.isPending ? (
                    <IconLoader2 size={14} className="animate-spin" />
                  ) : (
                    <IconCloudUpload size={14} />
                  )}
                  Sync to apps
                </Button>
              ) : null}
            </div>

            {!pasteMode ? (
              <Button
                type="button"
                intent="neutral"
                emphasis="outline"
                onClick={() => setPasteMode(true)}
                className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent/50"
              >
                <IconKey size={14} />
                Paste secret
              </Button>
            ) : (
              <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                <label
                  htmlFor="cross-app-secret"
                  className="text-xs font-medium text-foreground"
                >
                  Paste a shared secret
                </label>
                <input
                  id="cross-app-secret"
                  type="text"
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveSecret();
                    if (e.key === "Escape") {
                      setPasteMode(false);
                      setPasteValue("");
                    }
                  }}
                  placeholder="Paste A2A secret"
                  className="min-w-0 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    intent="neutral"
                    emphasis="outline"
                    onClick={() => {
                      setPasteMode(false);
                      setPasteValue("");
                    }}
                    className="h-8 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    intent="primary"
                    emphasis="solid"
                    disabled={!pasteValue.trim() || setA2ASecret.isPending}
                    onClick={saveSecret}
                    className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {setA2ASecret.isPending ? (
                      <IconLoader2 size={14} className="animate-spin" />
                    ) : null}
                    Save
                  </Button>
                </div>
              </div>
            )}

            {syncA2ASecret.isPending && (
              <p className="text-xs text-muted-foreground">
                Syncing to connected apps…
              </p>
            )}
            {syncResult && !syncA2ASecret.isPending && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Synced to {syncResult.succeeded}/{syncResult.total} app
                  {syncResult.total === 1 ? "" : "s"}
                  {syncResult.failed > 0
                    ? ` (${syncResult.failed} failed)`
                    : ""}
                  .
                </p>
                {syncResult.failed > 0 && (
                  <ul className="list-disc space-y-0.5 ps-5 text-xs text-destructive">
                    {syncResult.results
                      .filter((r) => !r.ok)
                      .map((r) => (
                        <li key={r.id}>
                          {r.name}: {r.error || `HTTP ${r.status ?? "?"}`}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}
            <ErrorText error={revealA2ASecret.error} />
            <ErrorText error={setA2ASecret.error} />
            <ErrorText error={syncA2ASecret.error} />
          </PopoverContent>
        </Popover>
      }
    />
  );
}

/**
 * Sign-in policy, SSO, SCIM, and domain auto-join for owners and admins, plus
 * the cross-app secret for owners. Renders nothing for members.
 */
export function AuthenticationSection({ title }: { title?: string }) {
  const { data: org } = useOrg();

  if (!org?.orgId || (org.role !== "owner" && org.role !== "admin")) {
    return null;
  }

  return (
    <SectionTooltipProvider>
      <SettingsGroup title={title}>
        <DomainSettingsSection
          domain={org.allowedDomain}
          ownerEmail={org.email}
        />
        <OrgIdentitySettings
          org={org}
          requiredAuthProvider={org.requiredAuthProvider}
        />
        {org.role === "owner" && (
          <A2ASecretSection isSet={Boolean(org.a2aSecretSet)} />
        )}
      </SettingsGroup>
    </SectionTooltipProvider>
  );
}
