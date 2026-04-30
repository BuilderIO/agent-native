import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconX,
  IconTrash,
  IconLock,
  IconBuilding,
  IconWorld,
  IconCheck,
  IconCopy,
  IconLink,
  IconMail,
  IconCode,
  IconChevronDown,
} from "@tabler/icons-react";
import * as Select from "@radix-ui/react-select";
import { useActionQuery, useActionMutation } from "../use-action.js";
import { cn } from "../utils.js";
import { agentNativePath } from "../api-path.js";

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  resourceType: string;
  resourceId: string;
  resourceTitle?: string;
  /**
   * When provided, enables the "Link" tab with a copy-link field.
   * Pass the user-facing share URL (e.g. `https://…/share/<id>`).
   */
  shareUrl?: string;
  /**
   * When provided, enables the "Embed" tab with a default iframe snippet.
   * For richer per-resource controls (autoplay, start time, responsive /
   * fixed size), pass `embedTabContent` instead (or in addition) — it
   * replaces the default embed body.
   */
  embedUrl?: string;
  /** Advanced: fully custom Embed tab body. Requires `embedUrl` to enable the tab. */
  embedTabContent?: ReactNode;
  /** Extra content appended to the bottom of the Link tab (e.g. download buttons). */
  linkTabExtras?: ReactNode;
}

type Visibility = "private" | "org" | "public";
type Role = "viewer" | "editor" | "admin";

interface Share {
  id: string;
  principalType: "user" | "org";
  principalId: string;
  role: Role;
}

interface SharesResponse {
  ownerEmail: string | null;
  orgId: string | null;
  visibility: Visibility | null;
  role?: "owner" | Role;
  shares: Share[];
}

interface OrgMember {
  email: string;
  name?: string | null;
}

function useOrgMembers(): OrgMember[] {
  const [members, setMembers] = useState<OrgMember[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(agentNativePath("/_agent-native/org/members"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list = Array.isArray(data?.members) ? data.members : [];
        setMembers(
          list
            .map((m: any) => ({
              email: typeof m?.email === "string" ? m.email : "",
              name: typeof m?.name === "string" ? m.name : null,
            }))
            .filter((m: OrgMember) => m.email),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return members;
}

function displayName(email: string, members: OrgMember[]): string {
  const match = members.find((m) => m.email === email);
  if (match?.name && match.name.trim()) return match.name;
  return email;
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0";
const BUTTON_OUTLINE_SM = cn(
  BUTTON_BASE,
  "h-9 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground",
);
const BUTTON_PRIMARY_SM = cn(
  BUTTON_BASE,
  "h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90",
);
const BUTTON_GHOST_ICON = cn(
  BUTTON_BASE,
  "h-8 w-8 p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
);

const VIS_META: Record<
  Visibility,
  { label: string; description: string; Icon: typeof IconLock }
> = {
  private: {
    label: "Private",
    description: "Only people with access can view",
    Icon: IconLock,
  },
  org: {
    label: "Organization",
    description: "Anyone in your organization can view",
    Icon: IconBuilding,
  },
  public: {
    label: "Public",
    description: "Anyone signed in with the link can view",
    Icon: IconWorld,
  },
};

const ROLE_OPTIONS: Array<{ value: Role; label: string; description: string }> =
  [
    { value: "viewer", label: "Viewer", description: "Can view" },
    { value: "editor", label: "Editor", description: "Can edit" },
    {
      value: "admin",
      label: "Admin",
      description: "Can edit and manage access",
    },
  ];

/**
 * Framework share dialog. Drop into any template via
 * `<ShareDialog open onClose resourceType resourceId />`. Passing
 * `shareUrl` lights up a Link tab with a copy field; passing `embedUrl`
 * lights up an Embed tab. With neither prop, renders a single Invite +
 * general-access panel (Google-Docs-lite).
 */
export function ShareDialog(props: ShareDialogProps) {
  const {
    open,
    onClose,
    resourceType,
    resourceId,
    resourceTitle,
    shareUrl,
    embedUrl,
    embedTabContent,
    linkTabExtras,
  } = props;

  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType,
    resourceId,
  });
  const orgMembers = useOrgMembers();

  const hasLinkTab = Boolean(shareUrl);
  const hasEmbedTab = Boolean(embedUrl);
  const tabsEnabled = hasLinkTab || hasEmbedTab;

  const [tab, setTab] = useState<"link" | "invite" | "embed">(
    hasLinkTab ? "link" : "invite",
  );

  useEffect(() => {
    if (!open) return;
    setTab(hasLinkTab ? "link" : "invite");
  }, [open, hasLinkTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const titleText = resourceTitle
    ? `Share "${resourceTitle}"`
    : `Share ${resourceType}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titleText}
        className="w-full max-w-lg rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold" title={titleText}>
              {titleText}
            </div>
            {sharesQuery.data?.ownerEmail ? (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                Owner: {displayName(sharesQuery.data.ownerEmail, orgMembers)}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={BUTTON_GHOST_ICON}
          >
            <IconX size={16} />
          </button>
        </div>

        {tabsEnabled ? (
          <div
            role="tablist"
            aria-label="Share options"
            className="mx-5 mt-1 flex gap-1 border-b border-border"
          >
            {hasLinkTab ? (
              <TabTrigger
                active={tab === "link"}
                onClick={() => setTab("link")}
                icon={<IconLink size={14} strokeWidth={1.75} />}
                label="Link"
              />
            ) : null}
            <TabTrigger
              active={tab === "invite"}
              onClick={() => setTab("invite")}
              icon={<IconMail size={14} strokeWidth={1.75} />}
              label="Invite"
            />
            {hasEmbedTab ? (
              <TabTrigger
                active={tab === "embed"}
                onClick={() => setTab("embed")}
                icon={<IconCode size={14} strokeWidth={1.75} />}
                label="Embed"
              />
            ) : null}
          </div>
        ) : null}

        <div className="px-5 py-4">
          {tabsEnabled && tab === "link" && hasLinkTab ? (
            <LinkTab
              resourceType={resourceType}
              resourceId={resourceId}
              shareUrl={shareUrl!}
              sharesQuery={sharesQuery}
              extras={linkTabExtras}
            />
          ) : null}
          {!tabsEnabled || tab === "invite" ? (
            <InviteTab
              resourceType={resourceType}
              resourceId={resourceId}
              sharesQuery={sharesQuery}
              showVisibility={!tabsEnabled}
              orgMembers={orgMembers}
            />
          ) : null}
          {tabsEnabled && tab === "embed" && hasEmbedTab
            ? (embedTabContent ?? <DefaultEmbedBody embedUrl={embedUrl!} />)
            : null}
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className={BUTTON_PRIMARY_SM}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function TabTrigger(props: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      className={cn(
        "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        props.active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Link tab — visibility picker + copy-link field + optional extras
// ---------------------------------------------------------------------------

function LinkTab(props: {
  resourceType: string;
  resourceId: string;
  shareUrl: string;
  sharesQuery: ReturnType<typeof useActionQuery<SharesResponse>>;
  extras?: ReactNode;
}) {
  const { resourceType, resourceId, shareUrl, sharesQuery, extras } = props;

  const setVisibility = useActionMutation("set-resource-visibility");
  const data = sharesQuery.data;
  const visibility: Visibility =
    (data?.visibility as Visibility | null) ?? "private";
  const canManage =
    data?.role === "owner" || data?.role === "admin" || !data?.role;
  const meta = VIS_META[visibility];

  const handleVisibility = (next: Visibility) => {
    if (next === visibility) return;
    setVisibility.mutate(
      { resourceType, resourceId, visibility: next } as any,
      { onSuccess: () => sharesQuery.refetch() },
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-sm font-semibold">General access</div>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <meta.Icon size={16} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <VisibilitySelect
              value={visibility}
              onChange={handleVisibility}
              disabled={!canManage}
            />
            <div className="mt-0.5 text-xs text-muted-foreground">
              {meta.description}
            </div>
          </div>
        </div>
      </div>

      <CopyField label="Share link" value={shareUrl} />

      {extras}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite tab — invite-by-email + shares list + (optional) visibility
// ---------------------------------------------------------------------------

function InviteTab(props: {
  resourceType: string;
  resourceId: string;
  sharesQuery: ReturnType<typeof useActionQuery<SharesResponse>>;
  showVisibility: boolean;
  orgMembers: OrgMember[];
}) {
  const { resourceType, resourceId, sharesQuery, showVisibility, orgMembers } =
    props;

  const share = useActionMutation("share-resource");
  const unshare = useActionMutation("unshare-resource");
  const setVisibility = useActionMutation("set-resource-visibility");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");

  const data = sharesQuery.data;
  const shares = data?.shares ?? [];
  const visibility: Visibility =
    (data?.visibility as Visibility | null) ?? "private";
  const canManage =
    data?.role === "owner" || data?.role === "admin" || !data?.role;
  const meta = VIS_META[visibility];

  const handleAdd = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    share.mutate(
      {
        resourceType,
        resourceId,
        principalType: "user",
        principalId: trimmed,
        role,
      } as any,
      {
        onSuccess: () => {
          setEmail("");
          sharesQuery.refetch();
        },
      },
    );
  };

  const handleRemove = (s: Share) => {
    unshare.mutate(
      {
        resourceType,
        resourceId,
        principalType: s.principalType,
        principalId: s.principalId,
      } as any,
      { onSuccess: () => sharesQuery.refetch() },
    );
  };

  const handleVisibility = (next: Visibility) => {
    if (next === visibility) return;
    setVisibility.mutate(
      { resourceType, resourceId, visibility: next } as any,
      { onSuccess: () => sharesQuery.refetch() },
    );
  };

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex items-stretch gap-2">
          <input
            type="email"
            placeholder="Add people by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            autoComplete="off"
            className="flex-1 min-w-0 h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
          />
          <RoleSelect value={role} onChange={setRole} />
        </div>
      ) : null}

      <div>
        <div className="mb-2 text-sm font-semibold">People with access</div>
        <ul className="flex flex-col gap-1 list-none p-0 m-0">
          {data?.ownerEmail ? (
            <li className="flex items-center gap-3 px-1 py-1.5 text-sm">
              <Avatar label={displayName(data.ownerEmail, orgMembers)} />
              <span className="flex-1 min-w-0 truncate">
                {displayName(data.ownerEmail, orgMembers)}
              </span>
              <span className="text-xs text-muted-foreground">Owner</span>
            </li>
          ) : null}
          {shares.map((s) => (
            <li
              key={`${s.principalType}:${s.principalId}`}
              className="flex items-center gap-3 px-1 py-1.5 text-sm"
            >
              <Avatar
                label={
                  s.principalType === "org"
                    ? s.principalId
                    : displayName(s.principalId, orgMembers)
                }
                org={s.principalType === "org"}
              />
              <span className="flex-1 min-w-0 truncate">
                {s.principalType === "org"
                  ? s.principalId
                  : displayName(s.principalId, orgMembers)}
              </span>
              <span className="text-xs text-muted-foreground">
                {cap(s.role)}
              </span>
              {canManage ? (
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => handleRemove(s)}
                  className={BUTTON_GHOST_ICON}
                >
                  <IconTrash size={14} />
                </button>
              ) : null}
            </li>
          ))}
          {!shares.length && !data?.ownerEmail ? (
            <li className="px-1 py-1.5 text-sm text-muted-foreground">
              No one has access yet.
            </li>
          ) : null}
        </ul>
      </div>

      {showVisibility ? (
        <div>
          <div className="mb-2 text-sm font-semibold">General access</div>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <meta.Icon size={16} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <VisibilitySelect
                value={visibility}
                onChange={handleVisibility}
                disabled={!canManage}
              />
              <div className="mt-0.5 text-xs text-muted-foreground">
                {meta.description}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default Embed body (simple responsive iframe snippet)
// ---------------------------------------------------------------------------

function DefaultEmbedBody({ embedUrl }: { embedUrl: string }) {
  const code = `<div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="${embedUrl}" frameborder="0" allowfullscreen allow="autoplay; picture-in-picture" style="position:absolute;inset:0;width:100%;height:100%"></iframe></div>`;
  return (
    <div className="space-y-3">
      <CopyField label="Embed URL" value={embedUrl} />
      <CopyField label="Embed code" value={code} multiline />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function CopyField({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="flex items-stretch gap-2">
        {multiline ? (
          <textarea
            readOnly
            value={value}
            className="flex-1 h-20 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        ) : (
          <input
            readOnly
            value={value}
            className="flex-1 min-w-0 h-9 rounded-md border border-input bg-background px-3 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        )}
        <button
          type="button"
          onClick={copy}
          aria-label="Copy"
          className={cn(BUTTON_OUTLINE_SM, "w-9 px-0")}
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </button>
      </div>
    </div>
  );
}

const selectContentClass =
  "z-[2100] min-w-[12rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md";
const selectItemClass =
  "relative flex w-full cursor-pointer select-none items-start gap-2 rounded-sm py-2 pl-8 pr-3 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

function SelectItems({
  items,
}: {
  items: Array<{ value: string; label: string; description?: string }>;
}) {
  return (
    <>
      {items.map((it) => (
        <Select.Item
          key={it.value}
          value={it.value}
          className={selectItemClass}
        >
          <span className="absolute left-2 top-2 flex h-4 w-4 items-center justify-center">
            <Select.ItemIndicator>
              <IconCheck size={14} />
            </Select.ItemIndicator>
          </span>
          <span className="flex flex-col">
            <Select.ItemText>{it.label}</Select.ItemText>
            {it.description ? (
              <span className="text-xs text-muted-foreground">
                {it.description}
              </span>
            ) : null}
          </span>
        </Select.Item>
      ))}
    </>
  );
}

function RoleSelect(props: { value: Role; onChange: (v: Role) => void }) {
  const current =
    ROLE_OPTIONS.find((o) => o.value === props.value) ?? ROLE_OPTIONS[0];
  return (
    <Select.Root
      value={props.value}
      onValueChange={(v) => props.onChange(v as Role)}
    >
      <Select.Trigger
        aria-label="Role"
        className={cn(
          BUTTON_BASE,
          "h-9 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <Select.Value>{current.label}</Select.Value>
        <Select.Icon>
          <IconChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className={selectContentClass}
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport>
            <SelectItems items={ROLE_OPTIONS} />
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function VisibilitySelect(props: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  disabled?: boolean;
}) {
  const current = VIS_META[props.value];
  return (
    <Select.Root
      value={props.value}
      onValueChange={(v) => props.onChange(v as Visibility)}
      disabled={props.disabled}
    >
      <Select.Trigger
        aria-label="General access"
        className={cn(
          BUTTON_BASE,
          "h-7 px-1 -ml-1 bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <Select.Value>{current.label}</Select.Value>
        <Select.Icon>
          <IconChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className={selectContentClass}
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport>
            <SelectItems
              items={(Object.keys(VIS_META) as Visibility[]).map((k) => ({
                value: k,
                label: VIS_META[k].label,
                description: VIS_META[k].description,
              }))}
            />
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function Avatar({ label, org }: { label: string; org?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
    >
      {org ? (
        <IconBuilding size={14} strokeWidth={1.75} />
      ) : (
        (label.split("@")[0]?.[0] ?? label[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
