import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import {
  IconArrowLeft,
  IconChevronRight,
  IconLink,
  IconLock,
  IconSend2,
  IconTrash,
  IconUsersGroup,
  IconWorld,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  Avatar as UserAvatar,
  AvatarFallback as UserAvatarFallback,
  AvatarImage as UserAvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useVisibleAvatarUrl } from "@/lib/use-visible-avatar-url";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared types + constants
// ---------------------------------------------------------------------------

export type Visibility = "private" | "org" | "public";
export type Role = "viewer" | "commenter" | "editor" | "admin";
export type ShareSettingsView = "people" | null;

export interface RoleCopy {
  label: string;
  description: string;
}

export interface Share {
  id: string;
  principalType: "user" | "org";
  principalId: string;
  role: Role;
}

export interface SharesResponse {
  ownerEmail: string | null;
  orgId: string | null;
  visibility: Visibility | null;
  role?: "owner" | Role;
  shares: Share[];
}

export type SharesQuery = ReturnType<typeof useActionQuery<SharesResponse>>;

export const VIS_META: Record<Visibility, { Icon: typeof IconLock }> = {
  private: {
    Icon: IconLock,
  },
  org: {
    Icon: IconUsersGroup,
  },
  public: {
    Icon: IconWorld,
  },
};

export const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: "viewer", label: "Viewer" },
  { value: "commenter", label: "Commenter" },
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Admin" },
];

export function copyToClipboard(value: string): Promise<boolean> {
  return writeClipboardText(value);
}

// ---------------------------------------------------------------------------
// Keeping the share popover open across nested layers
// ---------------------------------------------------------------------------

const NESTED_LAYER_SELECTOR = [
  "[data-radix-popper-content-wrapper]",
  "[data-radix-menu-content]",
  "[data-radix-select-viewport]",
  "[role='menu']",
  "[role='listbox']",
  "[data-sonner-toaster]",
].join(",");

function isNestedLayerTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(NESTED_LAYER_SELECTOR) !== null
  );
}

/**
 * Dropdown and select layers are portalled to the body, so Radix reads their
 * clicks and focus moves as "outside" the share popover and dismisses it. Spread
 * these on `PopoverContent` so only genuinely outside interactions close it.
 */
export function nestedLayerDismissGuards(): {
  onPointerDownOutside: (
    event: CustomEvent<{ originalEvent: PointerEvent }>,
  ) => void;
  onFocusOutside: (event: CustomEvent<{ originalEvent: FocusEvent }>) => void;
} {
  return {
    onPointerDownOutside: (event) => {
      if (isNestedLayerTarget(event.detail.originalEvent.target)) {
        event.preventDefault();
      }
    },
    onFocusOutside: (event) => {
      if (isNestedLayerTarget(event.detail.originalEvent.target)) {
        event.preventDefault();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Optimistic visibility mutation (resource-agnostic)
// ---------------------------------------------------------------------------

export function useResourceVisibilityMutation(
  resourceType: string,
  resourceId: string,
  sharesQuery: SharesQuery,
) {
  const queryClient = useQueryClient();
  const setVisibility = useActionMutation("set-resource-visibility");
  const shareQueryKey = useMemo(
    () =>
      ["action", "list-resource-shares", { resourceType, resourceId }] as const,
    [resourceType, resourceId],
  );

  const setResourceVisibility = (
    next: Visibility,
    options?: { onSuccess?: () => void },
  ) => {
    const previous = queryClient.getQueryData<SharesResponse>(shareQueryKey);
    queryClient.setQueryData<SharesResponse>(shareQueryKey, (current) =>
      current ? { ...current, visibility: next } : current,
    );
    setVisibility.mutate(
      {
        resourceType,
        resourceId,
        visibility: next,
      } as any,
      {
        onSuccess: () => {
          void sharesQuery.refetch().finally(() => options?.onSuccess?.());
        },
        onError: () => {
          if (previous) {
            queryClient.setQueryData(shareQueryKey, previous);
          } else {
            queryClient.invalidateQueries({ queryKey: shareQueryKey });
          }
        },
      },
    );
  };

  return { setResourceVisibility, isPending: setVisibility.isPending };
}

// ---------------------------------------------------------------------------
// Compact section labels
// ---------------------------------------------------------------------------

export function ShareSectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-xs font-medium text-muted-foreground", className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy-to-clipboard action button (the URL itself is never rendered)
// ---------------------------------------------------------------------------

export function CopyButton({
  value,
  children,
  copiedLabel,
  disabled,
  className,
  variant = "secondary",
}: {
  value: string;
  children: ReactNode;
  copiedLabel?: ReactNode;
  disabled?: boolean;
  className?: string;
  variant?: "secondary" | "outline" | "default" | "ghost";
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const handleClick = async () => {
    if (disabled || !value) return;
    const result = await copyToClipboard(value);
    if (result === false) return;
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1_400);
  };

  return (
    <Button
      type="button"
      variant={variant}
      disabled={disabled || !value}
      onClick={() => void handleClick()}
      className={cn("gap-2", className)}
    >
      <IconLink size={16} aria-hidden />
      {copied ? (copiedLabel ?? t("recordRoute.linkCopied")) : children}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// "Make public and copy" card (shown for private/org links the user manages)
// ---------------------------------------------------------------------------

export function MakePublicCard({
  isPending,
  onMakePublic,
  secondaryAction,
}: {
  isPending: boolean;
  onMakePublic: () => void;
  secondaryAction?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
      <p className="sr-only">{t("shareUi.restrictedLinkDescription")}</p>
      <IconLock
        aria-hidden
        size={14}
        strokeWidth={1.8}
        className="text-muted-foreground"
      />
      <div className="flex items-center gap-2">
        {secondaryAction}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          onClick={onMakePublic}
          disabled={isPending}
        >
          {isPending
            ? t("shareUi.makingPublic")
            : t("shareUi.makePublicAndCopy")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatar chip
// ---------------------------------------------------------------------------

export function Avatar({ label, org }: { label: string; org?: boolean }) {
  const { avatarRef, avatarUrl } = useVisibleAvatarUrl(org ? null : label);

  if (org) {
    return (
      <span
        aria-hidden
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
      >
        <IconUsersGroup size={14} strokeWidth={1.75} />
      </span>
    );
  }

  return (
    <UserAvatar ref={avatarRef} className="h-7 w-7 shrink-0">
      {avatarUrl ? <UserAvatarImage src={avatarUrl} alt={label} /> : null}
      <UserAvatarFallback className="bg-muted text-[11px] font-semibold text-muted-foreground">
        {(label.split("@")[0]?.[0] ?? label[0] ?? "?").toUpperCase()}
      </UserAvatarFallback>
    </UserAvatar>
  );
}

// ---------------------------------------------------------------------------
// Drill-down chrome: a clickable summary row that opens a "Share Settings"
// sub-screen (back arrow + title + content + Done), replacing the popover's
// main view rather than expanding inline.
// ---------------------------------------------------------------------------

export function AccessSummaryRow({
  icon,
  label,
  meta,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 text-start transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {meta ? (
        <span className="shrink-0 truncate text-xs text-muted-foreground">
          {meta}
        </span>
      ) : null}
      <IconChevronRight
        aria-hidden
        size={16}
        className="shrink-0 text-muted-foreground/70"
      />
    </button>
  );
}

export function ShareSettingsPanel({
  title,
  onBack,
  children,
  footer,
}: {
  title?: ReactNode;
  onBack: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const t = useT();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-ms-1.5 h-7 w-7 shrink-0"
          onClick={onBack}
          aria-label={t("shareUi.back")}
        >
          <IconArrowLeft size={16} />
        </Button>
        <div className="text-sm font-medium">
          {title ?? t("shareUi.shareSettings")}
        </div>
      </div>
      {children}
      <div className="flex justify-end">{footer}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// General access — inline dropdown, phrased as what the audience can do
// ---------------------------------------------------------------------------

/** Widest audience first, so the riskiest choice is never buried. */
const ACCESS_ORDER: Visibility[] = ["public", "org", "private"];

export function GeneralAccessSelect({
  visibility,
  canManage,
  isPending,
  onChange,
}: {
  visibility: Visibility;
  canManage: boolean;
  isPending: boolean;
  onChange: (next: Visibility) => void;
}) {
  const t = useT();
  const { data: org } = useOrg();
  const orgName = org?.orgName;
  const meta = VIS_META[visibility];

  const optionLabel = (value: Visibility) => {
    if (value !== "org") return t(`shareUi.accessOptions.${value}`);
    return orgName
      ? t("shareUi.accessOptions.org", { orgName })
      : t("shareUi.accessOptions.orgFallback");
  };

  return (
    <div className="flex items-center gap-3 px-1 py-1.5">
      <span
        aria-hidden
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <meta.Icon size={16} strokeWidth={1.75} />
      </span>
      <Select
        value={visibility}
        onValueChange={(v) => onChange(v as Visibility)}
        disabled={!canManage || isPending}
      >
        <SelectTrigger
          aria-label={t("shareUi.selectAccess")}
          className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus:ring-0 focus:ring-offset-0"
        >
          <SelectValue>{optionLabel(visibility)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {ACCESS_ORDER.map((value) => (
            <SelectItem key={value} value={value}>
              {optionLabel(value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// People with access — invite field, summary row, and full-list settings body
// ---------------------------------------------------------------------------

export function InvitePeopleField({
  resourceType,
  resourceId,
  resourceUrl,
  sharesQuery,
  onError,
}: {
  resourceType: string;
  resourceId: string;
  /** Optional notification deep-link passed to `share-resource`. */
  resourceUrl?: string;
  sharesQuery: SharesQuery;
  onError?: (err: unknown) => void;
}) {
  const t = useT();
  const share = useActionMutation("share-resource");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [notifyPeople, setNotifyPeople] = useState(true);
  const hasInviteEmail = email.trim().length > 0;

  const handleAdd = () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    share.mutate(
      {
        resourceType,
        resourceId,
        principalType: "user",
        principalId: trimmed,
        role,
        notify: notifyPeople,
        ...(resourceUrl ? { resourceUrl } : {}),
      } as any,
      {
        onSuccess: () => {
          setEmail("");
          sharesQuery.refetch();
        },
        onError: (err: unknown) => onError?.(err),
      },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-2">
        <div className="flex h-9 min-w-0 flex-1 items-center overflow-hidden rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
          <Input
            type="email"
            placeholder={t("shareUi.addPeopleByEmail")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            autoComplete="off"
            className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger className="h-full w-auto shrink-0 gap-1 rounded-none border-0 bg-transparent px-3 text-sm text-muted-foreground shadow-none focus:ring-0 focus:ring-offset-0">
              <SelectValue>{t(`shareUi.roles.${role}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(`shareUi.roles.${opt.value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="icon"
          onClick={handleAdd}
          disabled={!hasInviteEmail || share.isPending}
          aria-label={t("shareUi.invite")}
          title={t("shareUi.invite")}
          className="h-9 w-9 shrink-0"
        >
          <IconSend2 size={16} />
        </Button>
      </div>
      {hasInviteEmail ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={notifyPeople}
            onCheckedChange={(checked) => setNotifyPeople(checked === true)}
          />
          {t("shareUi.notifyPeople")}
        </label>
      ) : null}
    </div>
  );
}

export function PeopleAccessRow({
  sharesQuery,
  onOpenSettings,
}: {
  sharesQuery: SharesQuery;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const data = sharesQuery.data;
  const people = useMemo(
    () => [
      ...(data?.ownerEmail ? [data.ownerEmail] : []),
      ...(data?.shares.map((s) => s.principalId) ?? []),
    ],
    [data],
  );
  const [first, ...rest] = people;

  return (
    <AccessSummaryRow
      icon={
        first ? (
          <Avatar label={first} />
        ) : (
          <span className="inline-block h-7 w-7 shrink-0 rounded-full bg-muted" />
        )
      }
      label={
        !first
          ? t("shareUi.onlyYou")
          : rest.length > 0
            ? t("shareUi.othersCount", { count: rest.length, email: first })
            : first
      }
      meta={t("shareUi.canAccess")}
      onClick={onOpenSettings}
      disabled={sharesQuery.isLoading}
    />
  );
}

export function PeopleAccessSettingsBody({
  resourceType,
  resourceId,
  sharesQuery,
  canManage,
  roleCopy,
  onError,
}: {
  resourceType: string;
  resourceId: string;
  sharesQuery: SharesQuery;
  canManage: boolean;
  roleCopy?: Partial<Record<Role, RoleCopy>>;
  onError?: (err: unknown, action: "changeRole" | "remove") => void;
}) {
  const t = useT();
  const share = useActionMutation("share-resource");
  const unshare = useActionMutation("unshare-resource");
  const data = sharesQuery.data;
  const shares = data?.shares ?? [];
  const getRoleLabel = (value: Role) =>
    roleCopy?.[value]?.label ?? t(`shareUi.roles.${value}`);

  const handleRoleChange = (s: Share, nextRole: Role) => {
    share.mutate(
      {
        resourceType,
        resourceId,
        principalType: s.principalType,
        principalId: s.principalId,
        role: nextRole,
      } as any,
      {
        onSuccess: () => sharesQuery.refetch(),
        onError: (err: unknown) => onError?.(err, "changeRole"),
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
      {
        onSuccess: () => sharesQuery.refetch(),
        onError: (err: unknown) => onError?.(err, "remove"),
      },
    );
  };

  return (
    <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto p-0 m-0">
      {data?.ownerEmail ? (
        <li className="flex items-center gap-3 px-1 py-1.5 text-sm">
          <Avatar label={data.ownerEmail} />
          <span className="min-w-0 flex-1 truncate">{data.ownerEmail}</span>
          <span className="text-xs text-muted-foreground">
            {t("shareUi.ownerRole")}
          </span>
        </li>
      ) : null}

      {shares.map((s) => (
        <li
          key={`${s.principalType}:${s.principalId}`}
          className="flex items-center gap-2 px-1 py-1.5 text-sm"
        >
          <Avatar label={s.principalId} org={s.principalType === "org"} />
          <span className="min-w-0 flex-1 truncate">{s.principalId}</span>
          {canManage ? (
            <Select
              value={s.role}
              onValueChange={(v) => handleRoleChange(s, v as Role)}
            >
              <SelectTrigger className="h-8 w-auto shrink-0 border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none focus:ring-0">
                <SelectValue>{getRoleLabel(s.role)}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {getRoleLabel(opt.value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">
              {getRoleLabel(s.role)}
            </span>
          )}
          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("shareUi.remove")}
              onClick={() => handleRemove(s)}
              className="h-7 w-7 shrink-0"
            >
              <IconTrash size={14} />
            </Button>
          ) : null}
        </li>
      ))}

      {!shares.length && !data?.ownerEmail ? (
        <li className="px-1 py-1.5 text-sm text-muted-foreground">
          {t("shareUi.noAccessYet")}
        </li>
      ) : null}
    </ul>
  );
}
