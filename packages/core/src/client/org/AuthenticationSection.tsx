import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
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
  ErrorText,
  OrganizationDescription,
  PendingLabel,
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
  const shownDomain = domain || (canEnableOwnDomain ? ownDomain : "");

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
      label={t("agentChat.settingsOrg.search.domainAutoJoin")}
      description={
        <OrganizationDescription
          help={t("agentChat.settingsOrg.auth.domainHelp")}
          docsUrl={docsUrl("organizations-teams-permissions", {
            campaign: "organization_settings",
            content: "domain_auto_join",
          })}
        >
          {shownDomain
            ? t("agentChat.settingsOrg.auth.domainDescription", {
                domain: shownDomain,
              })
            : t("agentChat.settingsOrg.auth.domainDescriptionNoDomain")}
        </OrganizationDescription>
      }
      control={
        !editing ? (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {domain ? (
              <>
                <span className="me-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm">
                  <IconAt className="size-3.5 text-muted-foreground" />
                  {domain}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToolkitButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("agentChat.settingsOrg.auth.editDomain")}
                      onClick={() => {
                        setDraft(domain);
                        setEditing(true);
                      }}
                    >
                      <IconPencil />
                    </ToolkitButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("agentChat.settingsOrg.auth.editDomain")}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToolkitButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("agentChat.settingsOrg.auth.removeDomain")}
                      disabled={setOrgDomain.isPending}
                      onClick={() => setOrgDomain.mutate(null)}
                    >
                      <IconX />
                    </ToolkitButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("agentChat.settingsOrg.auth.removeDomain")}
                  </TooltipContent>
                </Tooltip>
              </>
            ) : canEnableOwnDomain ? (
              <ToolkitButton
                type="button"
                variant="outline"
                size="sm"
                disabled={setOrgDomain.isPending}
                onClick={() => setOrgDomain.mutate(ownDomain)}
              >
                <PendingLabel
                  pending={setOrgDomain.isPending}
                  label={t("org.enableDomainJoin", { domain: ownDomain })}
                  pendingLabel={t("org.enableDomainJoin", {
                    domain: ownDomain,
                  })}
                />
              </ToolkitButton>
            ) : null}
          </div>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Input
              type="text"
              size="sm"
              value={draft}
              aria-label={t("agentChat.settingsOrg.search.domainAutoJoin")}
              aria-invalid={setOrgDomain.error ? true : undefined}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder={ownDomain || "example.com"}
              className="w-44"
              autoFocus
            />
            <ToolkitButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
                setOrgDomain.reset();
              }}
            >
              {t("agentChat.common.cancel")}
            </ToolkitButton>
            <ToolkitButton
              type="submit"
              size="sm"
              disabled={setOrgDomain.isPending}
            >
              <PendingLabel
                pending={setOrgDomain.isPending}
                label={t("agentChat.common.save")}
                pendingLabel={t("agentChat.common.saving")}
              />
            </ToolkitButton>
          </form>
        )
      }
    >
      {setOrgDomain.error ? <ErrorText error={setOrgDomain.error} /> : null}
    </SettingsRow>
  );
}

export function A2ASecretSection({ isSet }: { isSet: boolean }) {
  const t = useT();
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

  const masked = isSet
    ? "••••••••••••"
    : t("agentChat.settingsOrg.auth.secretNotSetValue");
  const revealLabel = secret
    ? t("agentChat.settingsOrg.auth.hide")
    : t("agentChat.settingsOrg.auth.reveal");

  return (
    <SettingsRow
      id="cross-app-authentication"
      label={t("agentChat.settingsOrg.auth.sharedSecret")}
      description={
        isSet
          ? t("agentChat.settingsOrg.auth.sharedSecretSet")
          : t("agentChat.settingsOrg.auth.sharedSecretNotSet")
      }
      control={
        <Popover>
          <PopoverTrigger asChild>
            <ToolkitButton type="button" variant="outline" size="sm">
              {t("agentChat.settingsOrg.auth.manage")}
            </ToolkitButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[min(420px,calc(100vw-2rem))] space-y-4 p-4"
          >
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
              <p className="min-w-0 truncate font-mono text-sm text-foreground">
                {secret ?? masked}
              </p>
              {isSet && (
                <div className="flex shrink-0 items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ToolkitButton
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={toggleReveal}
                        disabled={revealA2ASecret.isPending}
                        aria-label={revealLabel}
                      >
                        {secret ? <IconEyeOff /> : <IconEye />}
                      </ToolkitButton>
                    </TooltipTrigger>
                    <TooltipContent>{revealLabel}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ToolkitButton
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={copyToClipboard}
                        disabled={revealA2ASecret.isPending}
                        aria-label={t("agentChat.common.copy")}
                      >
                        {copied ? <IconCheck /> : <IconCopy />}
                      </ToolkitButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("agentChat.common.copy")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <ToolkitButton
                type="button"
                variant="outline-destructive"
                size="sm"
                onClick={regenerate}
                disabled={setA2ASecret.isPending || syncA2ASecret.isPending}
              >
                {setA2ASecret.isPending && !pasteMode ? (
                  <Spinner aria-hidden="true" />
                ) : (
                  <IconRefresh />
                )}
                {t("agentChat.settingsOrg.auth.regenerate")}
              </ToolkitButton>
              {isSet ? (
                <ToolkitButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => syncToApps()}
                  disabled={setA2ASecret.isPending || syncA2ASecret.isPending}
                >
                  {syncA2ASecret.isPending ? (
                    <Spinner aria-hidden="true" />
                  ) : (
                    <IconCloudUpload />
                  )}
                  {t("agentChat.settingsOrg.auth.syncToApps")}
                </ToolkitButton>
              ) : null}
            </div>

            {!pasteMode ? (
              <ToolkitButton
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setPasteMode(true)}
              >
                <IconKey />
                {t("agentChat.settingsOrg.auth.pasteSecret")}
              </ToolkitButton>
            ) : (
              <form
                className="grid gap-2 rounded-lg border border-border bg-background p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveSecret();
                }}
              >
                <Label htmlFor="cross-app-secret">
                  {t("agentChat.settingsOrg.auth.pasteSecretLabel")}
                </Label>
                <Input
                  id="cross-app-secret"
                  type="text"
                  size="sm"
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setPasteMode(false);
                      setPasteValue("");
                    }
                  }}
                  aria-invalid={setA2ASecret.error ? true : undefined}
                  autoComplete="off"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <ToolkitButton
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setPasteMode(false);
                      setPasteValue("");
                    }}
                  >
                    {t("agentChat.common.cancel")}
                  </ToolkitButton>
                  <ToolkitButton
                    type="submit"
                    size="sm"
                    disabled={!pasteValue.trim() || setA2ASecret.isPending}
                  >
                    <PendingLabel
                      pending={setA2ASecret.isPending}
                      label={t("agentChat.common.save")}
                      pendingLabel={t("agentChat.common.saving")}
                    />
                  </ToolkitButton>
                </div>
              </form>
            )}

            {syncA2ASecret.isPending && (
              <p className="text-xs text-muted-foreground">
                {t("agentChat.settingsOrg.auth.syncing")}
              </p>
            )}
            {syncResult && !syncA2ASecret.isPending && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {syncResult.failed > 0
                    ? t("agentChat.settingsOrg.auth.syncedPartial", {
                        count: syncResult.total,
                        succeeded: syncResult.succeeded,
                        failed: syncResult.failed,
                      })
                    : t("agentChat.settingsOrg.auth.synced", {
                        count: syncResult.total,
                      })}
                </p>
                {syncResult.failed > 0 && (
                  <ul className="list-disc space-y-0.5 ps-5 text-xs text-destructive">
                    {syncResult.results
                      .filter((r) => !r.ok)
                      .map((r) => (
                        <li key={r.id}>
                          {r.name}:{" "}
                          {r.error ||
                            t("agentChat.settingsOrg.auth.syncErrorStatus", {
                              status: r.status ?? "?",
                            })}
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
