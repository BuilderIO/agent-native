import { trackEvent } from "@agent-native/core/client/analytics";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import {
  IconCheck,
  IconChevronDown,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

const OPEN_NESTED_LAYER_SELECTOR = [
  "[data-radix-menu-content][data-state='open']",
  "[role='listbox'][data-state='open']",
].join(",");

function isNestedLayerInteraction(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest(NESTED_LAYER_SELECTOR)) {
    return true;
  }
  // Radix blocks body pointer events while a select/menu is open, so a click
  // meant to close it resolves to the document rather than the element under
  // the cursor. That interaction belongs to the nested layer, not the popover.
  return (
    typeof document !== "undefined" &&
    document.querySelector(OPEN_NESTED_LAYER_SELECTOR) !== null
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
      if (isNestedLayerInteraction(event.detail.originalEvent.target)) {
        event.preventDefault();
      }
    },
    onFocusOutside: (event) => {
      if (isNestedLayerInteraction(event.detail.originalEvent.target)) {
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
  resourceType,
  resourceId,
  linkType = "share",
}: {
  value: string;
  children: ReactNode;
  copiedLabel?: ReactNode;
  disabled?: boolean;
  className?: string;
  variant?: "secondary" | "outline" | "default" | "ghost";
  resourceType?: string;
  resourceId?: string;
  linkType?: string;
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
    if (resourceType && resourceId) {
      trackEvent("share_link_copied", {
        resource_type: resourceType,
        resource_id: resourceId,
        link_type: linkType,
      });
    }
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
      className={cn("relative", className)}
    >
      {/* The idle label always occupies the button so the confirmation state
          doesn't resize it; the confirmation is centered on top. */}
      <span
        className={cn("flex items-center gap-2", copied && "invisible")}
        aria-hidden={copied}
      >
        <IconLink size={16} aria-hidden />
        {children}
      </span>
      {copied ? (
        <span className="absolute inset-0 flex items-center justify-center gap-2">
          <IconCheck size={16} aria-hidden className="text-success" />
          {copiedLabel ?? t("shareUi.copied")}
        </span>
      ) : null}
    </Button>
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
        // Muted reads darker than the surface in light mode, background does
        // the same in dark mode, so the chip stays subtly recessed in both.
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground dark:bg-background"
      >
        <IconUsersGroup size={14} strokeWidth={1.75} />
      </span>
    );
  }

  return (
    <UserAvatar ref={avatarRef} className="h-7 w-7 shrink-0">
      {avatarUrl ? <UserAvatarImage src={avatarUrl} alt={label} /> : null}
      <UserAvatarFallback className="bg-muted text-[11px] font-semibold text-muted-foreground dark:bg-background">
        {(label.split("@")[0]?.[0] ?? label[0] ?? "?").toUpperCase()}
      </UserAvatarFallback>
    </UserAvatar>
  );
}

// ---------------------------------------------------------------------------
// Accordion row: a summary that expands its detail in place, so managing
// access never takes the user out of the share popover.
// ---------------------------------------------------------------------------

export function AccessAccordionRow({
  icon,
  label,
  meta,
  disabled,
  open,
  onOpenChange,
  children,
}: {
  icon: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
  /** Controlled so callers can show a different summary while expanded. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}) {
  const summary = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {meta ? (
        <span className="shrink-0 truncate text-xs text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </>
  );

  // With nothing to reveal, stay a static row rather than offer a chevron and
  // hover affordance that expand into an empty panel.
  if (!children) {
    return (
      <div className="flex w-full items-center gap-3 px-1 py-1.5">
        {summary}
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        disabled={disabled}
        className="flex w-full cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 text-start transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
      >
        {summary}
        {/* Sized like the row-level remove button so both trailing icons
            share the same optical center. */}
        <span className="flex h-7 w-7 shrink-0 items-center justify-center">
          <IconChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 opacity-50 transition-transform",
              open && "rotate-180",
            )}
          />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="clips-collapsible-content">
        <div className="pt-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
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
    <Select
      value={visibility}
      onValueChange={(v) => onChange(v as Visibility)}
      disabled={!canManage || isPending}
    >
      {/* The trigger spans the whole row so the hover affordance matches the
          hit area. The icon is a bare svg, not a wrapped span, because the
          shared trigger applies line-clamp to every direct span child. */}
      <SelectTrigger
        aria-label={t("shareUi.selectAccess")}
        // The caret's trailing margin lines it up with the accordion row's
        // caret, which sits inside a 28px box.
        className="h-auto w-full cursor-pointer justify-start gap-3 rounded-md border-0 bg-transparent px-1 py-1.5 text-sm shadow-none transition-colors hover:bg-muted/50 focus:ring-0 focus:ring-offset-0 [&>span]:flex-1 [&>span]:text-start [&>svg:last-child]:me-1.5"
      >
        <meta.Icon
          aria-hidden
          strokeWidth={1.75}
          className="h-7 w-7 shrink-0 rounded-full bg-muted p-1.5 text-muted-foreground"
        />
        <SelectValue>{optionLabel(visibility)}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {ACCESS_ORDER.map((value) => {
          const OptionIcon = VIS_META[value].Icon;
          return (
            <SelectItem
              key={value}
              value={value}
              // The shared SelectItem pins its check to the inline-start edge.
              // Move it to the trailing edge so the option icon owns the left.
              className="ps-2 pe-8 [&>span:first-child]:start-auto [&>span:first-child]:end-2"
            >
              <span className="flex items-center gap-2">
                <OptionIcon
                  aria-hidden
                  size={16}
                  strokeWidth={1.75}
                  className="shrink-0 text-muted-foreground"
                />
                {optionLabel(value)}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
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

export function PeopleAccessSection({
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
  onError?: (err: unknown, action: "permission" | "remove") => void;
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
  const [open, setOpen] = useState(false);

  // Expanded, the trigger stops being a summary and becomes `first`'s own row,
  // since the people below it are the remainder of the list.
  const firstShare = data?.shares.find((s) => s.principalId === first);
  const firstRole = firstShare
    ? (roleCopy?.[firstShare.role]?.label ??
      t(`shareUi.roles.${firstShare.role}`))
    : t("shareUi.ownerRole");

  return (
    <AccessAccordionRow
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
          : open || rest.length === 0
            ? first
            : t("shareUi.othersCount", { count: rest.length, email: first })
      }
      meta={open && first ? firstRole : t("shareUi.canAccess")}
      disabled={sharesQuery.isLoading}
      open={open}
      onOpenChange={setOpen}
    >
      {rest.length > 0 ? (
        <PeopleAccessSettingsBody
          resourceType={resourceType}
          resourceId={resourceId}
          sharesQuery={sharesQuery}
          canManage={canManage}
          roleCopy={roleCopy}
          onError={onError}
          excludePrincipalId={first}
        />
      ) : null}
    </AccessAccordionRow>
  );
}

export function PeopleAccessSettingsBody({
  resourceType,
  resourceId,
  sharesQuery,
  canManage,
  roleCopy,
  onError,
  excludePrincipalId,
}: {
  resourceType: string;
  resourceId: string;
  sharesQuery: SharesQuery;
  canManage: boolean;
  roleCopy?: Partial<Record<Role, RoleCopy>>;
  onError?: (err: unknown, action: "permission" | "remove") => void;
  /** Principal already shown in the summary row, so it is not listed twice. */
  excludePrincipalId?: string;
}) {
  const t = useT();
  const share = useActionMutation("share-resource");
  const unshare = useActionMutation("unshare-resource");
  const data = sharesQuery.data;
  const ownerEmail = data?.ownerEmail ?? null;
  const showOwner = ownerEmail !== null && ownerEmail !== excludePrincipalId;
  const shares = (data?.shares ?? []).filter(
    (s) => s.principalId !== excludePrincipalId,
  );
  const getRoleLabel = (value: Role) =>
    roleCopy?.[value]?.label ?? t(`shareUi.roles.${value}`);

  const handleChangeRole = (s: Share, nextRole: Role) => {
    if (nextRole === s.role) return;
    share.mutate(
      {
        resourceType,
        resourceId,
        principalType: s.principalType,
        principalId: s.principalId,
        role: nextRole,
        // Re-granting an existing share only changes the role, so don't email
        // the person again.
        notify: false,
      } as any,
      {
        onSuccess: () => sharesQuery.refetch(),
        onError: (err: unknown) => onError?.(err, "permission"),
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
      {showOwner ? (
        <li className="flex items-center gap-3 px-1 py-1.5 text-sm">
          <Avatar label={ownerEmail} />
          <span className="min-w-0 flex-1 truncate">{ownerEmail}</span>
          <span className="text-xs text-muted-foreground">
            {t("shareUi.ownerRole")}
          </span>
        </li>
      ) : null}

      {shares.map((s) => (
        <li
          key={`${s.principalType}:${s.principalId}`}
          className="flex items-center gap-3 px-1 py-1.5 text-sm"
        >
          <Avatar label={s.principalId} org={s.principalType === "org"} />
          <span className="min-w-0 flex-1 truncate">{s.principalId}</span>
          {canManage ? (
            <Select
              value={s.role}
              onValueChange={(value) => handleChangeRole(s, value as Role)}
              disabled={share.isPending}
            >
              <SelectTrigger className="h-8 w-auto shrink-0 gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none focus:ring-0">
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
              className="h-7 w-7 shrink-0 text-muted-foreground"
            >
              <IconTrash size={14} />
            </Button>
          ) : null}
        </li>
      ))}

      {!shares.length && !showOwner ? (
        <li className="px-1 py-1.5 text-sm text-muted-foreground">
          {t("shareUi.noAccessYet")}
        </li>
      ) : null}
    </ul>
  );
}
