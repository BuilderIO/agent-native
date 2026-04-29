import { useEffect, useState, type ReactNode } from "react";
import {
  IconBuilding,
  IconUserPlus,
  IconTrash,
  IconCrown,
  IconShieldCheck,
  IconLoader2,
  IconMail,
  IconCheck,
  IconLogin,
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
import {
  useOrg,
  useOrgMembers,
  useOrgInvitations,
  useCreateOrg,
  useUpdateOrg,
  useInviteMember,
  useAcceptInvitation,
  useRemoveMember,
  useSwitchOrg,
  useSetOrgDomain,
  useSetA2ASecret,
  useSyncA2ASecret,
  type SyncA2ASecretResult,
} from "./hooks.js";

export interface TeamPageProps {
  /**
   * Optional wrapper around the page contents. Templates pass their own Layout
   * component so the Team page renders inside the template's chrome.
   */
  layout?: (children: ReactNode) => ReactNode;
  /**
   * Title shown at the top of the page. Defaults to "Team".
   */
  title?: string;
  /**
   * Description shown on the "Create an Organization" card. Defaults to
   * "Set up a team to collaborate with your colleagues."
   */
  createOrgDescription?: string;
  /**
   * Class applied to the outer max-width container. Templates can use this to
   * tweak page width.
   */
  className?: string;
}

function RoleIcon({ role }: { role: string }) {
  if (role === "owner")
    return <IconCrown className="h-3.5 w-3.5 text-amber-500" />;
  if (role === "admin")
    return <IconShieldCheck className="h-3.5 w-3.5 text-blue-500" />;
  return null;
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="text-xs text-red-500">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

function PendingInvitationsCard() {
  const { data: org } = useOrg();
  const acceptInvitation = useAcceptInvitation();

  if (!org?.pendingInvitations?.length) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">Pending Invitations</h3>
      {org.pendingInvitations.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between rounded-md border border-border p-3"
        >
          <div>
            <div className="text-sm font-medium">{inv.orgName}</div>
            <div className="text-xs text-muted-foreground">
              Invited by {inv.invitedBy}
            </div>
          </div>
          <button
            type="button"
            onClick={() => acceptInvitation.mutate(inv.id)}
            disabled={acceptInvitation.isPending}
            className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {acceptInvitation.isPending ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Accept"
            )}
          </button>
        </div>
      ))}
      <ErrorText error={acceptInvitation.error} />
    </section>
  );
}

function CreateOrgCard({ description }: { description?: string }) {
  const createOrg = useCreateOrg();
  const [name, setName] = useState("");
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">Create an Organization</h3>
      <p className="text-sm text-muted-foreground">
        {description || "Set up a team to collaborate with your colleagues."}
      </p>
      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
        >
          Create organization
        </button>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Inc."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!name.trim() || createOrg.isPending}
              onClick={() =>
                createOrg.mutate(name.trim(), {
                  onSuccess: () => {
                    setName("");
                    setShowForm(false);
                  },
                })
              }
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {createOrg.isPending ? (
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Create"
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setName("");
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <ErrorText error={createOrg.error} />
        </div>
      )}
    </section>
  );
}

function OrgNameDisplay({ name, canEdit }: { name: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const updateOrg = useUpdateOrg();

  if (!canEdit) return <div className="text-sm font-medium">{name}</div>;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        className="group flex items-center gap-1.5 text-sm font-medium hover:text-foreground/80"
      >
        {name}
        <IconPencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </button>
    );
  }

  function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      return;
    }
    updateOrg.mutate(trimmed, { onSuccess: () => setEditing(false) });
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={save}
        className="rounded border border-border bg-background px-1.5 py-0.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-foreground"
        autoFocus
      />
      <ErrorText error={updateOrg.error} />
    </div>
  );
}

function MembersCard() {
  const { data: org } = useOrg();
  const { data: membersData, isLoading: isLoadingMembers } = useOrgMembers();
  const { data: invitationsData } = useOrgInvitations();
  const inviteMember = useInviteMember();
  const removeMember = useRemoveMember();
  const switchOrg = useSwitchOrg();

  const [inviteEmail, setInviteEmail] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);

  if (!org?.orgId) return null;

  const isOwnerOrAdmin = org.role === "owner" || org.role === "admin";
  const members = membersData?.members ?? [];
  const pendingInvites = invitationsData?.invitations ?? [];
  const hasMultipleOrgs = (org.orgs?.length ?? 0) > 1;

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/10">
            <IconBuilding className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <OrgNameDisplay name={org.orgName ?? ""} canEdit={isOwnerOrAdmin} />
            <div className="text-xs text-muted-foreground">
              {members.length} member{members.length !== 1 ? "s" : ""} · You are{" "}
              {org.role}
            </div>
          </div>
        </div>
        {hasMultipleOrgs && (
          <select
            value={org.orgId ?? ""}
            onChange={(e) => switchOrg.mutate(e.target.value || null)}
            disabled={switchOrg.isPending}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
          >
            {org.orgs.map((o) => (
              <option key={o.orgId} value={o.orgId}>
                {o.orgName}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="border-t border-border pt-3 space-y-1">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Members
        </div>
        {isLoadingMembers && members.length === 0 && (
          <>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1.5 px-2"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-3.5 rounded bg-muted animate-pulse"
                    style={{ width: `${140 + i * 30}px` }}
                  />
                  <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </>
        )}
        {members.map((m) => (
          <div
            key={m.email}
            className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent/30"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">{m.email}</span>
              <RoleIcon role={m.role} />
              {m.email === org.email && (
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  You
                </span>
              )}
            </div>
            {isOwnerOrAdmin && m.email !== org.email && m.role !== "owner" && (
              <button
                type="button"
                disabled={removeMember.isPending}
                onClick={() => removeMember.mutate(m.email)}
                className="text-muted-foreground hover:text-red-500 disabled:opacity-50"
                title="Remove member"
              >
                <IconTrash className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {pendingInvites.map((inv) => (
          <div
            key={inv.id}
            className="flex items-center justify-between py-1.5 px-2 opacity-60"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">{inv.email}</span>
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                Invited
              </span>
            </div>
          </div>
        ))}
      </div>

      {isOwnerOrAdmin && (
        <div className="border-t border-border pt-3">
          {!showInviteForm ? (
            <button
              type="button"
              onClick={() => setShowInviteForm(true)}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
            >
              <IconUserPlus className="h-3.5 w-3.5" />
              Invite member
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <IconMail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  disabled={!inviteEmail.trim() || inviteMember.isPending}
                  onClick={() =>
                    inviteMember.mutate(inviteEmail.trim(), {
                      onSuccess: () => {
                        setInviteEmail("");
                        setShowInviteForm(false);
                      },
                    })
                  }
                  className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
                >
                  {inviteMember.isPending ? (
                    <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <IconCheck className="h-3.5 w-3.5" />
                      Send
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowInviteForm(false);
                    setInviteEmail("");
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                They&apos;ll need to sign in with Google using this exact email
                to accept the invitation.
              </p>
              <ErrorText error={inviteMember.error} />
            </div>
          )}
        </div>
      )}

      {isOwnerOrAdmin && <DomainSettingsSection domain={org.allowedDomain} />}

      {isOwnerOrAdmin && <A2ASecretSection secret={org.a2aSecret} />}

      <ErrorText error={removeMember.error} />
      <ErrorText error={switchOrg.error} />
    </section>
  );
}

function DomainSettingsSection({ domain }: { domain: string | null }) {
  const setOrgDomain = useSetOrgDomain();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(domain ?? "");

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
    <div className="border-t border-border pt-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Email domain auto-join
      </div>
      <p className="text-[11px] text-muted-foreground">
        Anyone who signs up with an email from this domain can join your
        organization without an invitation.
      </p>
      {!editing ? (
        <div className="flex items-center gap-2">
          {domain ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
                <IconAt className="h-3.5 w-3.5 text-muted-foreground" />
                {domain}
              </span>
              <button
                type="button"
                onClick={() => {
                  setDraft(domain);
                  setEditing(true);
                }}
                className="text-muted-foreground hover:text-foreground"
                title="Edit domain"
              >
                <IconPencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={setOrgDomain.isPending}
                onClick={() => setOrgDomain.mutate(null)}
                className="text-muted-foreground hover:text-red-500 disabled:opacity-50"
                title="Remove domain"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                setEditing(true);
              }}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
            >
              <IconAt className="h-3.5 w-3.5" />
              Set allowed domain
            </button>
          )}
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
            placeholder="example.com"
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            autoFocus
          />
          <button
            type="button"
            disabled={setOrgDomain.isPending}
            onClick={save}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {setOrgDomain.isPending ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Save"
            )}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}
      <ErrorText error={setOrgDomain.error} />
    </div>
  );
}

function A2ASecretSection({ secret }: { secret: string | null | undefined }) {
  const setA2ASecret = useSetA2ASecret();
  const syncA2ASecret = useSyncA2ASecret();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [syncResult, setSyncResult] = useState<SyncA2ASecretResult | null>(
    null,
  );

  function copyToClipboard() {
    if (!secret) return;
    navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
        setRevealed(false);
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

  const masked = secret ? "****" + secret.slice(-8) : "Not set";

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Cross-app authentication
      </div>
      <p className="text-[11px] text-muted-foreground">
        This secret authenticates cross-app delegation (e.g. Dispatch to
        Analytics). All apps in your organization need the same secret.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono">
          <IconKey className="h-3.5 w-3.5 text-muted-foreground" />
          {revealed && secret ? secret : masked}
        </span>
        {secret && (
          <>
            <button
              type="button"
              onClick={() => setRevealed(!revealed)}
              className="text-muted-foreground hover:text-foreground"
              title={revealed ? "Hide secret" : "Reveal secret"}
            >
              {revealed ? (
                <IconEyeOff className="h-3.5 w-3.5" />
              ) : (
                <IconEye className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={copyToClipboard}
              className="text-muted-foreground hover:text-foreground"
              title="Copy secret"
            >
              {copied ? (
                <IconCheck className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <IconCopy className="h-3.5 w-3.5" />
              )}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={regenerate}
          disabled={setA2ASecret.isPending || syncA2ASecret.isPending}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50 disabled:opacity-50"
          title="Regenerate secret and sync to connected apps"
        >
          {setA2ASecret.isPending ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <IconRefresh className="h-3.5 w-3.5" />
          )}
          Regenerate
        </button>
        {secret && (
          <button
            type="button"
            onClick={() => syncToApps()}
            disabled={setA2ASecret.isPending || syncA2ASecret.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50 disabled:opacity-50"
            title="Push this secret to every connected app"
          >
            {syncA2ASecret.isPending ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <IconCloudUpload className="h-3.5 w-3.5" />
            )}
            Sync to apps
          </button>
        )}
      </div>

      {syncA2ASecret.isPending && (
        <p className="text-[11px] text-muted-foreground">
          Syncing to connected apps…
        </p>
      )}

      {syncResult && !syncA2ASecret.isPending && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">
            Synced to {syncResult.succeeded}/{syncResult.total} app
            {syncResult.total === 1 ? "" : "s"}
            {syncResult.failed > 0 ? ` (${syncResult.failed} failed)` : ""}.
          </p>
          {syncResult.failed > 0 && (
            <ul className="text-[11px] text-red-500 list-disc pl-5 space-y-0.5">
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

      {!pasteMode ? (
        <button
          type="button"
          onClick={() => setPasteMode(true)}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
        >
          <IconKey className="h-3.5 w-3.5" />
          Paste secret from another app
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
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
            className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
            autoFocus
          />
          <button
            type="button"
            disabled={!pasteValue.trim() || setA2ASecret.isPending}
            onClick={saveSecret}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {setA2ASecret.isPending ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Save"
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setPasteMode(false);
              setPasteValue("");
            }}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      <ErrorText error={setA2ASecret.error} />
      <ErrorText error={syncA2ASecret.error} />
    </div>
  );
}

const MIGRATE_FLAG_KEY = "an_migrate_from_local";

function LocalModeSignInCard() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upgradeToAccount() {
    setIsSubmitting(true);
    setError(null);
    try {
      // Remember that we want to migrate data once the user completes sign-in.
      try {
        localStorage.setItem(MIGRATE_FLAG_KEY, "1");
      } catch {
        // localStorage may be unavailable (private mode) — migration just
        // won't auto-run. The user can still sign in.
      }
      const res = await fetch("/_agent-native/auth/exit-local-mode", {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to exit local mode");
      }
      // Reload with ?signin=1 → auth guard will serve the onboarding page so
      // the user can sign in with Google or create an email/password account.
      // The URL flag is used (rather than a cookie) because third-party iframe
      // contexts (e.g. the Builder.io editor) block SameSite=Lax cookies, so a
      // cookie-only signal would be lost on reload. The localStorage flag
      // survives the reload so TeamPage can migrate data automatically once
      // they're back.
      const url = new URL(window.location.href);
      url.searchParams.set("signin", "1");
      window.location.href = url.toString();
    } catch (e: any) {
      setError(e?.message || "Failed to start sign-in");
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-4">
      <p className="text-sm text-muted-foreground">
        Signed in as <code>local@localhost</code>. Create an account to:
      </p>
      <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
        <li>Sync data across devices</li>
        <li>Invite teammates</li>
        <li>Keep your local data — it migrates automatically</li>
      </ul>
      <button
        type="button"
        onClick={upgradeToAccount}
        disabled={isSubmitting}
        className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
      >
        {isSubmitting ? (
          <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <IconLogin className="h-3.5 w-3.5" />
        )}
        Sign in or create account
      </button>
      {error && <ErrorText error={error} />}
    </section>
  );
}

interface MigrationState {
  status: "idle" | "running" | "done" | "error";
  coreTables: Record<string, number>;
  appKeys: string[];
  error: string | null;
}

function MigrationStatusCard({ state }: { state: MigrationState }) {
  if (state.status === "idle") return null;

  const movedCore = Object.entries(state.coreTables);

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-3">
      <div className="flex items-center gap-2">
        {state.status === "running" ? (
          <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : state.status === "done" ? (
          <IconCheck className="h-4 w-4 text-green-500" />
        ) : (
          <IconTrash className="h-4 w-4 text-red-500" />
        )}
        <h3 className="text-sm font-medium">
          {state.status === "running"
            ? "Migrating your local workspace"
            : state.status === "done"
              ? "Local workspace migrated"
              : "Migration incomplete"}
        </h3>
      </div>

      {state.status === "running" && (
        <p className="text-sm text-muted-foreground">
          Moving your local SQL data onto this real account. Keep this page open
          while the upgrade finishes.
        </p>
      )}

      {state.status === "done" && (
        <>
          <p className="text-sm text-muted-foreground">
            Your local workspace has been attached to this account.
          </p>
          {(movedCore.length > 0 || state.appKeys.length > 0) && (
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground space-y-1">
              {movedCore.map(([table, count]) => (
                <div key={table}>
                  {table}: {count} row{count === 1 ? "" : "s"}
                </div>
              ))}
              {state.appKeys.length > 0 && (
                <div>
                  app settings: {state.appKeys.length} key
                  {state.appKeys.length === 1 ? "" : "s"}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {state.status === "error" && (
        <p className="text-sm text-red-500">
          {state.error || "We signed you in, but moving local data failed."}
        </p>
      )}
    </section>
  );
}

/**
 * After the user finishes signing in on the onboarding page and lands back on
 * the Team page, pull across any data that was previously scoped to
 * `local@localhost`. Triggered by a localStorage flag set from
 * `LocalModeSignInCard` so we only migrate when the user explicitly opted in.
 */
function useMigrateLocalDataOnSignIn(
  email: string | undefined,
): MigrationState {
  const [state, setState] = useState<MigrationState>({
    status: "idle",
    coreTables: {},
    appKeys: [],
    error: null,
  });

  useEffect(() => {
    if (!email || email === "local@localhost") return; // guard:allow-localhost-fallback — client-side check that skips the local→real-account migration when still in dev mode
    let flag: string | null = null;
    try {
      flag = localStorage.getItem(MIGRATE_FLAG_KEY);
    } catch {
      return;
    }
    if (!flag) return;
    // Clear the flag immediately so a failed request doesn't loop.
    try {
      localStorage.removeItem(MIGRATE_FLAG_KEY);
    } catch {
      // ignore
    }
    let cancelled = false;

    (async () => {
      setState({
        status: "running",
        coreTables: {},
        appKeys: [],
        error: null,
      });

      try {
        const coreRes = await fetch("/_agent-native/auth/migrate-local-data", {
          method: "POST",
          credentials: "include",
        });
        const coreBody = await coreRes.json().catch(() => ({}));
        if (!coreRes.ok) {
          throw new Error(
            coreBody?.error || "Failed to migrate local framework data",
          );
        }

        let appKeys: string[] = [];
        try {
          const appRes = await fetch("/api/local-migration", {
            method: "POST",
            credentials: "include",
          });
          if (appRes.ok) {
            const appBody = await appRes.json().catch(() => ({}));
            appKeys = Array.isArray(appBody?.keys) ? appBody.keys : [];
          } else if (appRes.status !== 404) {
            const appBody = await appRes.json().catch(() => ({}));
            throw new Error(appBody?.error || "App-specific migration failed");
          }
        } catch (err: any) {
          if (!/404/.test(String(err?.message ?? ""))) throw err;
        }

        if (!cancelled) {
          setState({
            status: "done",
            coreTables:
              typeof coreBody?.tables === "object" && coreBody.tables
                ? coreBody.tables
                : {},
            appKeys,
            error: null,
          });
        }
      } catch (err: any) {
        if (!cancelled) {
          setState({
            status: "error",
            coreTables: {},
            appKeys: [],
            error: err?.message || "Migration failed",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [email]);

  return state;
}

/**
 * Default Team management page. Templates can route directly to this component
 * or wrap it with their own Layout via the `layout` prop.
 */
export function TeamPage({
  layout,
  title = "Team",
  createOrgDescription,
  className,
}: TeamPageProps) {
  const { data: org, isLoading } = useOrg();
  const migration = useMigrateLocalDataOnSignIn(org?.email);
  const isMigrating = migration.status === "running";

  const content = (
    <div className={`space-y-6 max-w-2xl ${className ?? ""}`}>
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>

      {isLoading && (
        <section className="rounded-lg border border-border bg-card p-6">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </section>
      )}

      {/* guard:allow-localhost-fallback — client-side dev-mode UI: shows sign-in prompt when running in local mode */}
      {!isLoading && org?.email === "local@localhost" && (
        <LocalModeSignInCard />
      )}

      {/* guard:allow-localhost-fallback — client-side dev-mode UI: hides migration card while still in local mode */}
      {!isLoading && org?.email !== "local@localhost" && (
        <MigrationStatusCard state={migration} />
      )}

      {/* guard:allow-localhost-fallback — client-side dev-mode UI: hides team management while still in local mode */}
      {!isLoading && org?.email !== "local@localhost" && !isMigrating && (
        <>
          <PendingInvitationsCard />
          {!org?.orgId ? (
            <CreateOrgCard description={createOrgDescription} />
          ) : (
            <MembersCard />
          )}
        </>
      )}
    </div>
  );

  return layout ? <>{layout(content)}</> : content;
}
