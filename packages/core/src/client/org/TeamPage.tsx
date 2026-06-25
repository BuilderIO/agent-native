import {
  IconBuilding,
  IconUserPlus,
  IconTrash,
  IconCrown,
  IconShieldCheck,
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
  IconFileImport,
  IconPlus,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import type { DomainMatchOrg } from "../../org/types.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import {
  useOrg,
  useOrgMembers,
  useOrgInvitations,
  useCreateOrg,
  useUpdateOrg,
  useBulkInviteMembers,
  useChangeMemberRole,
  useAcceptInvitation,
  useRemoveMember,
  useSwitchOrg,
  useSetOrgDomain,
  useSetA2ASecret,
  useSyncA2ASecret,
  useJoinByDomain,
  type InviteRole,
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
  const t = useT();
  const { data: org } = useOrg();
  const acceptInvitation = useAcceptInvitation();

  if (!org?.pendingInvitations?.length) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">{t("org.pendingInvitations")}</h3>
      {org.pendingInvitations.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between rounded-md border border-border p-3"
        >
          <div>
            <div className="text-sm font-medium">{inv.orgName}</div>
            <div className="text-xs text-muted-foreground">
              {t("org.invitedByLabel", { name: inv.invitedBy })}
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
              t("org.accept")
            )}
          </button>
        </div>
      ))}
      <ErrorText error={acceptInvitation.error} />
    </section>
  );
}

function JoinByDomainCard({ matches }: { matches: DomainMatchOrg[] }) {
  const t = useT();
  const joinByDomain = useJoinByDomain();
  const [pendingId, setPendingId] = useState<string | null>(null);

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">{t("org.joinYourTeam")}</h3>
      <p className="text-sm text-muted-foreground">
        {matches.length === 1
          ? t("org.joinDomainOne")
          : t("org.joinDomainMany")}
      </p>
      <div className="space-y-2">
        {matches.map((m) => (
          <div
            key={m.orgId}
            className="flex items-center justify-between rounded-md border border-border p-3"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600/10">
                <IconBuilding className="h-4 w-4 text-blue-600" />
              </div>
              <div className="text-sm font-medium">{m.orgName}</div>
            </div>
            <button
              type="button"
              disabled={joinByDomain.isPending && pendingId === m.orgId}
              onClick={() => {
                setPendingId(m.orgId);
                joinByDomain.mutate(m.orgId, {
                  onSettled: () => setPendingId(null),
                });
              }}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {joinByDomain.isPending && pendingId === m.orgId ? (
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                t("org.join")
              )}
            </button>
          </div>
        ))}
      </div>
      <ErrorText error={joinByDomain.error} />
    </section>
  );
}

function CreateOrgCard({ description }: { description?: string }) {
  const t = useT();
  const createOrg = useCreateOrg();
  const [name, setName] = useState("");
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">{t("org.createOrgCardTitle")}</h3>
      <p className="text-sm text-muted-foreground">
        {description || t("org.createOrgCardDescription")}
      </p>
      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
        >
          {t("org.createOrganization")}
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
                t("org.create")
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
              {t("org.cancel")}
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
  const t = useT();
  const { data: org } = useOrg();
  const { data: membersData, isLoading: isLoadingMembers } = useOrgMembers();
  const { data: invitationsData } = useOrgInvitations();
  const removeMember = useRemoveMember();
  const switchOrg = useSwitchOrg();

  const [showInviteForm, setShowInviteForm] = useState(false);

  if (!org?.orgId) return null;

  const isOwner = org.role === "owner";
  const isOwnerOrAdmin = isOwner || org.role === "admin";
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
              {t("org.memberCount", { count: members.length })} ·{" "}
              {t("org.youAreRole", { role: org.role })}
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
          {t("org.members")}
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
          <MemberRow
            key={m.email}
            email={m.email}
            role={m.role}
            isCurrentUser={m.email === org.email}
            currentUserRole={org.role ?? null}
          />
        ))}
        {pendingInvites.map((inv) => (
          <div
            key={inv.id}
            className="flex items-center justify-between py-1.5 px-2 opacity-60"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">{inv.email}</span>
              <RoleIcon role={inv.role} />
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                Invited{inv.role === "admin" ? " · admin" : ""}
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
              Invite members
            </button>
          ) : (
            <BulkInviteForm
              currentUserRole={org.role}
              onClose={() => setShowInviteForm(false)}
            />
          )}
        </div>
      )}

      {isOwnerOrAdmin && (
        <DomainSettingsSection
          domain={org.allowedDomain}
          ownerEmail={org.email}
        />
      )}

      {isOwner && <A2ASecretSection secret={org.a2aSecret} />}

      <ErrorText error={removeMember.error} />
      <ErrorText error={switchOrg.error} />
    </section>
  );
}

function MemberRow({
  email,
  role,
  isCurrentUser,
  currentUserRole,
}: {
  email: string;
  role: string;
  isCurrentUser: boolean;
  currentUserRole: string | null;
}) {
  const t = useT();
  const removeMember = useRemoveMember();
  const changeRole = useChangeMemberRole();
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Owners can manage admins + members. Admins can only manage members.
  // Owners themselves are immutable through this UI; current user can't
  // edit their own role here.
  const canManage =
    role !== "owner" &&
    !isCurrentUser &&
    (currentUserRole === "owner" ||
      (currentUserRole === "admin" && role === "member"));

  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent/30">
      <div className="flex items-center gap-2">
        <span className="text-sm">{email}</span>
        <RoleIcon role={role} />
        {isCurrentUser && (
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t("org.you")}
          </span>
        )}
        {role === "admin" && (
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-blue-600">
            {t("org.admin")}
          </span>
        )}
      </div>
      {canManage && (
        <div className="flex items-center gap-1">
          {editing ? (
            <select
              autoFocus
              value={role}
              onChange={(e) => {
                const next = e.target.value === "admin" ? "admin" : "member";
                if (next !== role) {
                  changeRole.mutate(
                    { email, role: next },
                    { onSuccess: () => setEditing(false) },
                  );
                } else {
                  setEditing(false);
                }
              }}
              onBlur={() => setEditing(false)}
              disabled={changeRole.isPending}
              className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px]"
            >
              <option value="member">{t("org.member")}</option>
              <option value="admin">{t("org.admin")}</option>
            </select>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <IconPencil className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("org.changeRole")}</TooltipContent>
            </Tooltip>
          )}
          {confirmingRemove ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {t("org.cancel")}
              </button>
              <button
                type="button"
                disabled={removeMember.isPending}
                onClick={() =>
                  removeMember.mutate(email, {
                    onSettled: () => setConfirmingRemove(false),
                  })
                }
                className="rounded bg-red-500 px-1.5 py-0.5 text-[11px] text-white hover:bg-red-600 disabled:opacity-50"
              >
                {t("org.remove")}
              </button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={removeMember.isPending}
                  onClick={() => setConfirmingRemove(true)}
                  className="text-muted-foreground hover:text-red-500 disabled:opacity-50"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("org.removeMember")}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

interface DraftInvite {
  email: string;
  role: InviteRole;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmailList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function parseCsvEmails(text: string): string[] {
  // Tolerant CSV parse — split on lines, then on commas, take any cell
  // that looks like an email. Handles "name,email,role" rows or just
  // "email" per line. A robust full CSV parser would be overkill here.
  const cells: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const cell of line.split(",")) {
      const trimmed = cell.trim().replace(/^"|"$/g, "");
      if (trimmed) cells.push(trimmed);
    }
  }
  return Array.from(
    new Set(cells.filter((c) => EMAIL_RE.test(c)).map((c) => c.toLowerCase())),
  );
}

function BulkInviteForm({
  currentUserRole,
  onClose,
}: {
  currentUserRole: string | null;
  onClose: () => void;
}) {
  const bulkInvite = useBulkInviteMembers();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<DraftInvite[]>([
    { email: "", role: "member" },
  ]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteRole, setPasteRole] = useState<InviteRole>("member");
  const [resultBanner, setResultBanner] = useState<{
    succeeded: number;
    failed: { email: string; error: string }[];
  } | null>(null);

  const canSetAdmin = currentUserRole === "owner";

  const validDrafts = useMemo(
    () =>
      drafts
        .map((d) => ({ ...d, email: d.email.trim().toLowerCase() }))
        .filter((d) => EMAIL_RE.test(d.email)),
    [drafts],
  );

  function setDraft(index: number, patch: Partial<DraftInvite>) {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }

  function appendEmails(emails: string[], role: InviteRole) {
    if (!emails.length) return;
    setDrafts((prev) => {
      const existing = new Set(
        prev.map((d) => d.email.trim().toLowerCase()).filter(Boolean),
      );
      const fresh: DraftInvite[] = [];
      for (const e of emails) {
        if (!existing.has(e)) {
          fresh.push({ email: e, role });
          existing.add(e);
        }
      }
      // If the only existing row is an empty placeholder, drop it.
      const cleaned = prev.filter(
        (d, i) => !(i === 0 && !d.email.trim() && prev.length === 1),
      );
      return [...cleaned, ...fresh];
    });
  }

  function handleFile(file: File) {
    file.text().then((text) => {
      const emails = parseCsvEmails(text);
      if (emails.length) {
        appendEmails(emails, "member");
      } else {
        setResultBanner({
          succeeded: 0,
          failed: [{ email: file.name, error: "No valid emails found in CSV" }],
        });
      }
    });
  }

  async function submit() {
    setResultBanner(null);
    const dedup = new Map<string, DraftInvite>();
    for (const d of validDrafts) {
      // canSetAdmin guard mirrors server-side enforcement so an admin-only
      // user editing the form can't even attempt to grant admin (they'd
      // get a 403 anyway).
      const role = canSetAdmin ? d.role : "member";
      dedup.set(d.email, { ...d, role });
    }
    const invites = Array.from(dedup.values());
    if (invites.length === 0) return;

    const result = await bulkInvite.mutateAsync(invites);
    setResultBanner({
      succeeded: result.succeeded.length,
      failed: result.failed,
    });

    // Wipe drafts that succeeded; leave failed ones so the user can fix
    // and retry. If everything succeeded, reset to a single blank row.
    const failedEmails = new Set(result.failed.map((f) => f.email));
    setDrafts((prev) => {
      const remaining = prev.filter((d) =>
        failedEmails.has(d.email.trim().toLowerCase()),
      );
      return remaining.length > 0 ? remaining : [{ email: "", role: "member" }];
    });

    // Auto-close on full success.
    if (result.failed.length === 0 && result.succeeded.length > 0) {
      setTimeout(() => onClose(), 1200);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {drafts.map((draft, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="email"
              value={draft.email}
              onChange={(e) => setDraft(i, { email: e.target.value })}
              placeholder="colleague@company.com"
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              autoFocus={i === drafts.length - 1}
            />
            <select
              value={draft.role}
              onChange={(e) =>
                setDraft(i, {
                  role: e.target.value === "admin" ? "admin" : "member",
                })
              }
              disabled={!canSetAdmin}
              title={
                canSetAdmin
                  ? undefined
                  : "Only the organization owner can invite admins"
              }
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            {drafts.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setDrafts((prev) => prev.filter((_, j) => j !== i))
                }
                className="text-muted-foreground hover:text-red-500"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setDrafts((prev) => [...prev, { email: "", role: "member" }])
          }
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
        >
          <IconPlus className="h-3.5 w-3.5" />
          Add another
        </button>
        <button
          type="button"
          onClick={() => setPasteOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
        >
          <IconUserPlus className="h-3.5 w-3.5" />
          Paste many
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
        >
          <IconFileImport className="h-3.5 w-3.5" />
          Import CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // reset so re-uploading the same file re-fires onChange
            e.target.value = "";
          }}
        />
      </div>

      {pasteOpen && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="text-xs font-medium text-muted-foreground">
            Paste emails (comma, space, or newline separated)
          </div>
          <textarea
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            rows={4}
            placeholder="alice@acme.com, bob@acme.com&#10;charlie@acme.com"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
          />
          <div className="flex items-center gap-2">
            <select
              value={pasteRole}
              onChange={(e) =>
                setPasteRole(e.target.value === "admin" ? "admin" : "member")
              }
              disabled={!canSetAdmin}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
            >
              <option value="member">Add as members</option>
              <option value="admin">Add as admins</option>
            </select>
            <button
              type="button"
              onClick={() => {
                appendEmails(parseEmailList(pasteValue), pasteRole);
                setPasteValue("");
                setPasteOpen(false);
              }}
              disabled={parseEmailList(pasteValue).length === 0}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setPasteValue("");
                setPasteOpen(false);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={validDrafts.length === 0 || bulkInvite.isPending}
          onClick={submit}
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {bulkInvite.isPending ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="inline-flex items-center gap-1">
              <IconCheck className="h-3.5 w-3.5" />
              Send {validDrafts.length || ""}{" "}
              {validDrafts.length === 1 ? "invite" : "invites"}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Each invitee signs in with this exact email to accept.
        {canSetAdmin
          ? " Admins can manage members and workspace settings."
          : " Only the organization owner can grant admin access."}
      </p>

      {resultBanner && (
        <div className="space-y-1 rounded-md border border-border bg-accent/30 p-2.5">
          {resultBanner.succeeded > 0 && (
            <p className="text-[11px] text-green-600">
              <IconCheck className="inline h-3 w-3 -mt-0.5" /> Sent{" "}
              {resultBanner.succeeded}{" "}
              {resultBanner.succeeded === 1 ? "invite" : "invites"}.
            </p>
          )}
          {resultBanner.failed.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-red-500">
              {resultBanner.failed.map((f) => (
                <li key={f.email}>
                  <IconAlertTriangle className="inline h-3 w-3 -mt-0.5 me-1" />
                  {f.email}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ErrorText error={bulkInvite.error} />
    </div>
  );
}

function DomainSettingsSection({
  domain,
  ownerEmail,
}: {
  domain: string | null;
  ownerEmail: string;
}) {
  const setOrgDomain = useSetOrgDomain();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(domain ?? "");

  const ownDomain = ownerEmail.split("@")[1]?.toLowerCase() ?? "";

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
        Anyone who signs up with an email at this domain will join your
        organization automatically. You can only set your own email domain (
        {ownDomain || "—"}); free email providers like gmail.com or outlook.com
        aren&apos;t allowed.
      </p>
      {!editing ? (
        <div className="flex items-center gap-2">
          {domain ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
                <IconAt className="h-3.5 w-3.5 text-muted-foreground" />
                {domain}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(domain);
                      setEditing(true);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <IconPencil className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Edit domain</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={setOrgDomain.isPending}
                    onClick={() => setOrgDomain.mutate(null)}
                    className="text-muted-foreground hover:text-red-500 disabled:opacity-50"
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Remove domain</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(ownDomain);
                setEditing(true);
              }}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
            >
              <IconAt className="h-3.5 w-3.5" />
              Allow {ownDomain || "your domain"} to auto-join
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
            placeholder={ownDomain || "example.com"}
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
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setRevealed(!revealed)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {revealed ? (
                    <IconEyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <IconEye className="h-3.5 w-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {revealed ? "Hide secret" : "Reveal secret"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {copied ? (
                    <IconCheck className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <IconCopy className="h-3.5 w-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>Copy secret</TooltipContent>
            </Tooltip>
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={regenerate}
              disabled={setA2ASecret.isPending || syncA2ASecret.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50 disabled:opacity-50"
            >
              {setA2ASecret.isPending ? (
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <IconRefresh className="h-3.5 w-3.5" />
              )}
              Regenerate
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Regenerate secret and sync to connected apps
          </TooltipContent>
        </Tooltip>
        {secret && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => syncToApps()}
                disabled={setA2ASecret.isPending || syncA2ASecret.isPending}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50 disabled:opacity-50"
              >
                {syncA2ASecret.isPending ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <IconCloudUpload className="h-3.5 w-3.5" />
                )}
                Sync to apps
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Push this secret to every connected app
            </TooltipContent>
          </Tooltip>
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
            <ul className="text-[11px] text-red-500 list-disc ps-5 space-y-0.5">
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

/**
 * Default Team management page. Templates can route directly to this component
 * or wrap it with their own Layout via the `layout` prop.
 */
export function TeamPage({
  layout,
  title,
  createOrgDescription,
  className,
}: TeamPageProps) {
  const t = useT();
  const { data: org, isLoading } = useOrg();

  const content = (
    <div className={`space-y-6 max-w-2xl ${className ?? ""}`}>
      <h2 className="text-2xl font-bold tracking-tight">
        {title ?? t("org.team")}
      </h2>

      {isLoading && (
        <section className="rounded-lg border border-border bg-card p-6">
          <div className="text-sm text-muted-foreground">
            {t("org.loading")}
          </div>
        </section>
      )}

      {!isLoading && (
        <>
          <PendingInvitationsCard />
          {!org?.orgId ? (
            <>
              {org?.domainMatches && org.domainMatches.length > 0 && (
                <JoinByDomainCard matches={org.domainMatches} />
              )}
              <CreateOrgCard description={createOrgDescription} />
            </>
          ) : (
            <MembersCard />
          )}
        </>
      )}
    </div>
  );

  const wrapped = (
    <TooltipProvider delayDuration={200}>{content}</TooltipProvider>
  );

  return layout ? <>{layout(wrapped)}</> : wrapped;
}
