import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  IconX,
  IconTrash,
  IconLock,
  IconWorld,
  IconCheck,
  IconCopy,
  IconLink,
  IconMail,
  IconCode,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";

import { agentNativePath } from "../api-path.js";
import { writeClipboardText } from "../clipboard.js";
import { useT } from "../i18n.js";
import { useActionQuery, useActionMutation } from "../use-action.js";
import { cn } from "../utils.js";

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
  displayName?: string | null;
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
  const normalized = email.trim().toLowerCase();
  const match = members.find((m) => m.email.toLowerCase() === normalized);
  if (match?.name && match.name.trim()) return match.name;
  return normalized.includes("@") ? email : "Unknown person";
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors active:!scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0";
const BUTTON_OUTLINE_SM = cn(
  BUTTON_BASE,
  "!h-9 !px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground",
);
const BUTTON_PRIMARY_SM = cn(
  BUTTON_BASE,
  "!h-9 !px-4 bg-primary text-primary-foreground hover:bg-primary/90",
);
const BUTTON_GHOST_ICON = cn(
  BUTTON_BASE,
  "!h-8 !w-8 !p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
);

const VIS_ICONS: Record<Visibility, typeof IconLock> = {
  private: IconLock,
  org: IconUsersGroup,
  public: IconWorld,
};

function useVisibilityMeta() {
  const t = useT();
  return {
    private: {
      label: t("share.private"),
      description: t("share.privateDescription"),
      Icon: VIS_ICONS.private,
    },
    org: {
      label: t("share.organization"),
      description: t("share.organizationDescription"),
      Icon: VIS_ICONS.org,
    },
    public: {
      label: t("share.public"),
      description: t("share.publicDescription"),
      Icon: VIS_ICONS.public,
    },
  } satisfies Record<
    Visibility,
    { label: string; description: string; Icon: typeof IconLock }
  >;
}

function useRoleOptions() {
  const t = useT();
  return [
    {
      value: "viewer",
      label: t("share.viewer"),
      description: t("share.viewerDescription"),
    },
    {
      value: "editor",
      label: t("share.editor"),
      description: t("share.editorDescription"),
    },
    {
      value: "admin",
      label: t("share.admin"),
      description: t("share.adminDescription"),
    },
  ] satisfies Array<{ value: Role; label: string; description: string }>;
}

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
  const t = useT();

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

  if (!open) return null;

  const titleText = resourceTitle
    ? t("share.titleWithResource", { title: resourceTitle })
    : t("share.titleWithType", { type: resourceType });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        hideClose
        motion="instant"
        overlayClassName="!z-[2000] !bg-black/40 !backdrop-blur-none !transition-none"
        className="!top-4 !z-[2010] !block !max-h-none !w-[calc(100vw-2rem)] !max-w-lg !translate-y-0 !gap-0 !overflow-visible !rounded-xl !border-border !bg-popover !p-0 !text-popover-foreground !shadow-2xl sm:!top-1/2 sm:!-translate-y-1/2"
        aria-label={titleText}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <DialogTitle
              className="truncate !text-base !leading-normal !tracking-normal !text-inherit"
              title={titleText}
            >
              {titleText}
            </DialogTitle>
            {sharesQuery.data?.ownerEmail ? (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {t("share.owner", {
                  name: displayName(sharesQuery.data.ownerEmail, orgMembers),
                })}
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("share.close")}
            onClick={onClose}
            className={cn(BUTTON_GHOST_ICON, "[&_svg]:!size-auto")}
          >
            <IconX size={16} />
          </Button>
        </div>

        {tabsEnabled ? (
          <div
            role="tablist"
            aria-label={t("share.shareOptions")}
            className="mx-5 mt-1 flex gap-1 border-b border-border"
          >
            {hasLinkTab ? (
              <TabTrigger
                active={tab === "link"}
                onClick={() => setTab("link")}
                icon={<IconLink size={14} strokeWidth={1.75} />}
                label={t("share.link")}
              />
            ) : null}
            <TabTrigger
              active={tab === "invite"}
              onClick={() => setTab("invite")}
              icon={<IconMail size={14} strokeWidth={1.75} />}
              label={t("share.invite")}
            />
            {hasEmbedTab ? (
              <TabTrigger
                active={tab === "embed"}
                onClick={() => setTab("embed")}
                icon={<IconCode size={14} strokeWidth={1.75} />}
                label={t("share.embed")}
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
              shareUrl={shareUrl}
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
          <Button type="button" onClick={onClose} className={BUTTON_PRIMARY_SM}>
            {t("share.done")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
    <Button
      type="button"
      variant="ghost"
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      className={cn(
        "inline-flex !h-auto items-center gap-1.5 !rounded-none border-b-2 !px-3 !py-2 text-sm font-medium transition-colors hover:!bg-transparent active:!scale-100 focus-visible:!ring-0 focus-visible:!ring-offset-0 [&_svg]:!size-auto",
        props.active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {props.icon}
      {props.label}
    </Button>
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
  const t = useT();
  const visibilityMeta = useVisibilityMeta();

  const setVisibility = useActionMutation("set-resource-visibility");
  const data = sharesQuery.data;
  const visibility: Visibility =
    (data?.visibility as Visibility | null) ?? "private";
  const canManage = data?.role === "owner" || data?.role === "admin";
  const meta = visibilityMeta[visibility];

  const handleVisibility = (next: Visibility) => {
    if (next === visibility) return;
    if (!canManage) return;
    setVisibility.mutate(
      { resourceType, resourceId, visibility: next } as any,
      { onSuccess: () => sharesQuery.refetch() },
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-sm font-semibold">
          {t("share.generalAccess")}
        </div>
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

      <CopyField label={t("share.shareLink")} value={shareUrl} />

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
  shareUrl?: string;
  sharesQuery: ReturnType<typeof useActionQuery<SharesResponse>>;
  showVisibility: boolean;
  orgMembers: OrgMember[];
}) {
  const {
    resourceType,
    resourceId,
    shareUrl,
    sharesQuery,
    showVisibility,
    orgMembers,
  } = props;
  const t = useT();
  const visibilityMeta = useVisibilityMeta();

  const share = useActionMutation("share-resource");
  const unshare = useActionMutation("unshare-resource");
  const setVisibility = useActionMutation("set-resource-visibility");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [notifyPeople, setNotifyPeople] = useState(true);
  const hasInviteEmail = email.trim().length > 0;

  const data = sharesQuery.data;
  const shares = data?.shares ?? [];
  const visibility: Visibility =
    (data?.visibility as Visibility | null) ?? "private";
  const canManage = data?.role === "owner" || data?.role === "admin";
  const meta = visibilityMeta[visibility];

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
        notify: notifyPeople,
        resourceUrl: getNotificationUrl(shareUrl),
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
    if (!canManage) return;
    setVisibility.mutate(
      { resourceType, resourceId, visibility: next } as any,
      { onSuccess: () => sharesQuery.refetch() },
    );
  };

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="space-y-2">
          <div className="flex items-stretch gap-2">
            <input
              type="email"
              placeholder={t("share.addPeopleByEmail")}
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
          {hasInviteEmail ? (
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={notifyPeople}
                onChange={(e) => setNotifyPeople(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              {t("share.notifyPeople")}
            </label>
          ) : null}
        </div>
      ) : null}

      <div>
        <div className="mb-2 text-sm font-semibold">
          {t("share.peopleWithAccess")}
        </div>
        <ul className="flex flex-col gap-1 list-none p-0 m-0">
          {data?.ownerEmail ? (
            <li className="flex items-center gap-3 px-1 py-1.5 text-sm">
              <Avatar label={displayName(data.ownerEmail, orgMembers)} />
              <span className="flex-1 min-w-0 truncate">
                {displayName(data.ownerEmail, orgMembers)}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("share.ownerRole")}
              </span>
            </li>
          ) : null}
          {shares.map((s) => (
            <li
              key={`${s.principalType}:${s.principalId}`}
              className="flex items-center gap-3 px-1 py-1.5 text-sm"
            >
              <Avatar
                label={principalLabel(s, orgMembers)}
                org={s.principalType === "org"}
              />
              <span className="flex-1 min-w-0 truncate">
                {principalLabel(s, orgMembers)}
              </span>
              <span className="text-xs text-muted-foreground">
                {cap(s.role)}
              </span>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("share.remove")}
                  onClick={() => handleRemove(s)}
                  className={cn(BUTTON_GHOST_ICON, "[&_svg]:!size-auto")}
                >
                  <IconTrash size={14} />
                </Button>
              ) : null}
            </li>
          ))}
          {!shares.length && !data?.ownerEmail ? (
            <li className="px-1 py-1.5 text-sm text-muted-foreground">
              {t("share.noAccess")}
            </li>
          ) : null}
        </ul>
      </div>

      {showVisibility ? (
        <div>
          <div className="mb-2 text-sm font-semibold">
            {t("share.generalAccess")}
          </div>
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
  const t = useT();
  const code = `<div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="${embedUrl}" frameborder="0" allowfullscreen allow="autoplay; picture-in-picture" style="position:absolute;inset:0;width:100%;height:100%"></iframe></div>`;
  return (
    <div className="space-y-3">
      <CopyField label={t("share.embedUrl")} value={embedUrl} />
      <CopyField label={t("share.embedCode")} value={code} multiline />
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
  const t = useT();
  const copy = async () => {
    if (!(await writeClipboardText(value))) {
      setCopied(false);
      return;
    }
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
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label={t("share.copy")}
          className={cn(BUTTON_OUTLINE_SM, "!w-9 !px-0 [&_svg]:!size-auto")}
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </Button>
      </div>
    </div>
  );
}

const selectContentClass =
  "!z-[2100] min-w-[12rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md";
const selectItemClass =
  "relative flex w-full cursor-pointer select-none !items-start gap-2 rounded-sm py-2 ps-8 pe-3 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>span:first-child]:!top-2 [&>span:first-child_svg]:!size-[14px]";

function SelectItems({
  items,
}: {
  items: Array<{ value: string; label: string; description?: string }>;
}) {
  return (
    <>
      {items.map((it) => (
        <SelectItem key={it.value} value={it.value} className={selectItemClass}>
          <span className="flex flex-col">
            <span>{it.label}</span>
            {it.description ? (
              <span className="text-xs text-muted-foreground">
                {it.description}
              </span>
            ) : null}
          </span>
        </SelectItem>
      ))}
    </>
  );
}

function RoleSelect(props: { value: Role; onChange: (v: Role) => void }) {
  const t = useT();
  const roleOptions = useRoleOptions();
  const current =
    roleOptions.find((o) => o.value === props.value) ?? roleOptions[0];
  return (
    <Select
      value={props.value}
      onValueChange={(v) => props.onChange(v as Role)}
    >
      <SelectTrigger
        aria-label={t("share.role")}
        className={cn(
          BUTTON_BASE,
          "!h-9 !w-auto !px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground [&_svg]:!size-[14px] [&_svg]:!opacity-100",
        )}
      >
        <SelectValue>{current.label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        className={selectContentClass}
        position="popper"
        sideOffset={4}
      >
        <SelectItems items={roleOptions} />
      </SelectContent>
    </Select>
  );
}

function VisibilitySelect(props: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  disabled?: boolean;
  allowPrivate?: boolean;
  allowPublic?: boolean;
}) {
  const t = useT();
  const visibilityMeta = useVisibilityMeta();
  const current = visibilityMeta[props.value];
  const allowPrivate = props.allowPrivate !== false;
  const allowPublic = props.allowPublic !== false;
  const options = (Object.keys(VIS_ICONS) as Visibility[]).filter((k) => {
    if (k === props.value) return true;
    if (k === "private" && !allowPrivate) return false;
    if (k === "public" && !allowPublic) return false;
    return true;
  });
  return (
    <Select
      value={props.value}
      onValueChange={(v) => props.onChange(v as Visibility)}
      disabled={props.disabled}
    >
      <SelectTrigger
        aria-label={t("share.generalAccess")}
        className={cn(
          BUTTON_BASE,
          "!h-7 !w-auto !px-1 -ms-1 bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground [&_svg]:!size-[14px] [&_svg]:!opacity-100",
        )}
      >
        <SelectValue>{current.label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        className={selectContentClass}
        position="popper"
        sideOffset={4}
      >
        <SelectItems
          items={options.map((k) => ({
            value: k,
            label: visibilityMeta[k].label,
            description: visibilityMeta[k].description,
          }))}
        />
      </SelectContent>
    </Select>
  );
}

function Avatar({ label, org }: { label: string; org?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
    >
      {org ? (
        <IconUsersGroup size={14} strokeWidth={1.75} />
      ) : (
        (label.split("@")[0]?.[0] ?? label[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}

function getNotificationUrl(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (typeof window === "undefined") return undefined;
  return window.location.href;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function principalLabel(share: Share, members: OrgMember[]): string {
  const serverLabel = share.displayName?.trim();
  if (serverLabel) return serverLabel;
  if (share.principalType === "org") return "Organization";
  return displayName(share.principalId, members);
}
