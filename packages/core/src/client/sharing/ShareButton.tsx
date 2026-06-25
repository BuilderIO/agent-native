import * as Select from "@radix-ui/react-select";
import {
  IconLock,
  IconBuilding,
  IconWorld,
  IconTrash,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconLoader2,
  IconSearch,
  IconSearchOff,
  IconShare3,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  UIEvent as ReactUIEvent,
} from "react";

import { agentNativePath } from "../api-path.js";
import { writeClipboardText } from "../clipboard.js";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { useActionQuery, useActionMutation } from "../use-action.js";
import { cn } from "../utils.js";

export interface ShareButtonProps {
  resourceType: string;
  resourceId: string;
  resourceTitle?: string;
  /** @deprecated No longer affects rendering — trigger always says
   *  "Share". Kept for callsite compatibility. */
  variant?: "compact" | "label";
  /** Optional trigger style. Defaults to the Google-Docs-style "Share" label. */
  trigger?: "label" | "icon";
  /** Optional className applied to the trigger button. */
  triggerClassName?: string;
  /** Notified when the share popover opens or closes. Hosts that render the
   *  button next to an iframe use this to disable the iframe's pointer events
   *  while the popover is open, so popover hover/clicks aren't swallowed. */
  onOpenChange?: (open: boolean) => void;
  /** Open the popover on first render. Useful after an upgrade/create flow that
   *  lands the user directly in the shareable resource. */
  defaultOpen?: boolean;
  /** Optional public/share URL shown as a copyable link in the popover.
   *  This is treated as the primary "Copy link" target — same convention
   *  as Google Docs' Share dialog, which copies the editor URL. */
  shareUrl?: string;
  /** Optional label for the primary copyable link section. */
  shareUrlLabel?: string;
  /** Optional helper text for the primary copyable link section. */
  shareUrlDescription?: ReactNode;
  /** Where to render share links in the popover. Defaults to the bottom,
   *  matching the historical Google-Docs-style share dialog. */
  shareUrlPlacement?: "top" | "bottom";
  /** Optional placeholder shown in the share-URL slot when `shareUrl` is
   *  undefined. Use this to explain *why* there's no link yet (e.g. "Publish
   *  this form to get a public response link") instead of leaving the slot
   *  empty. */
  shareUrlPlaceholder?: ReactNode;
  /** Optional secondary copyable link (e.g. a presentation / read-only
   *  surface for the same resource). Anyone with at least viewer access
   *  can open it — access is enforced on the resource itself, not the
   *  URL shape, so we never gate this behind visibility. */
  secondaryShareUrl?: string;
  /** Optional label for the secondary copyable link. */
  secondaryShareUrlLabel?: string;
  /** Optional helper text for the secondary copyable link. */
  secondaryShareUrlDescription?: ReactNode;
  /** @deprecated No longer enforced — access is checked on the resource,
   *  not the URL shape, mirroring Google Slides. Kept for callsite
   *  compatibility; the prop is now a no-op. */
  shareUrlRequiresPublic?: boolean;
  /** @deprecated See `shareUrlRequiresPublic`. No longer rendered. */
  shareUrlUnavailableDescription?: ReactNode;
  /** Optional template-specific copy for the visibility picker. */
  visibilityCopy?: Partial<
    Record<Visibility, { label?: string; description?: string }>
  >;
  /** Optional label for the explicit per-person access list. */
  peopleAccessLabel?: ReactNode;
  /** Optional label for the coarse visibility control. */
  generalAccessLabel?: ReactNode;
  /** Optional note rendered between general access and the copyable link. */
  accessNote?: ReactNode;
  /** Optional Notion-style organization access control. When present, the
   *  share panel exposes a "Hide in search" switch under Advanced for org
   *  visibility. */
  hideInSearchControl?: {
    checked: boolean;
    pending?: boolean;
    label?: string;
    description?: ReactNode;
    onCheckedChange: (checked: boolean) => void | Promise<void>;
  };
}

type Visibility = "private" | "org" | "public";
type Role = "viewer" | "editor" | "admin";
type HideInSearchControl = NonNullable<ShareButtonProps["hideInSearchControl"]>;

interface Share {
  id: string;
  principalType: "user" | "org";
  principalId: string;
  role: Role;
}

interface SharesPolicy {
  /** When false, the visibility picker hides "Public". Default: true. */
  allowPublic: boolean;
  /** When true, individual user shares must target an org member or pending invitee. Default: false. */
  requireOrgMemberForUserShares: boolean;
}

interface SharesResponse {
  ownerEmail: string | null;
  orgId: string | null;
  visibility: Visibility | null;
  role?: "owner" | Role;
  shares: Share[];
  /** Server-declared policy for what visibilities and share targets are allowed. */
  policy?: SharesPolicy;
}

// Mirror shadcn's <Button size="sm" variant="outline"> class string so the
// trigger sits flush next to other sm outline buttons in the template.
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";
const BUTTON_OUTLINE_SM = cn(
  BUTTON_BASE,
  "h-9 px-3 border border-[hsl(var(--sidebar-border,var(--input)))] bg-[hsl(var(--sidebar-background,var(--background)))] text-foreground hover:bg-[hsl(var(--sidebar-accent,var(--accent)))] hover:text-[hsl(var(--sidebar-accent-foreground,var(--accent-foreground)))]",
);
const BUTTON_PRIMARY_SM = cn(
  BUTTON_BASE,
  "h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90",
);
const BUTTON_GHOST_ICON = cn(
  BUTTON_BASE,
  "h-7 w-7 p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
);
const SHARE_POPOVER_SURFACE =
  "border-[hsl(var(--sidebar-border,var(--border)))] bg-[hsl(var(--sidebar-background,var(--popover)))]";
const MEMBER_SUGGESTION_LIMIT = 25;
const MEMBER_SEARCH_DEBOUNCE_MS = 140;

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
    description: "Anyone with the link can view",
    Icon: IconWorld,
  },
};

function visibilityMeta(
  visibility: Visibility,
  copy?: ShareButtonProps["visibilityCopy"],
): (typeof VIS_META)[Visibility] {
  const base = VIS_META[visibility];
  const override = copy?.[visibility];
  return {
    ...base,
    label: override?.label ?? base.label,
    description: override?.description ?? base.description,
  };
}

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
 * Framework share control. Renders a shadcn-outline-styled trigger that
 * opens a Google-Docs-style popover anchored beneath it. Uses Tailwind
 * + CSS variables so the same component renders natively in light and
 * dark mode in any shadcn template.
 */
export function ShareButton(props: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [pendingVisibility, setPendingVisibility] = useState<Visibility | null>(
    null,
  );
  const appliedDefaultOpenRef = useRef(false);
  const visibilityRequestId = useRef(0);
  const queryClient = useQueryClient();
  const shareQueryParams = useMemo(
    () => ({
      resourceType: props.resourceType,
      resourceId: props.resourceId,
    }),
    [props.resourceType, props.resourceId],
  );
  const shareQueryKey = useMemo(
    () => ["action", "list-resource-shares", shareQueryParams] as const,
    [shareQueryParams],
  );
  const setVisibility = useActionMutation("set-resource-visibility");
  const sharesQuery = useActionQuery<SharesResponse>(
    "list-resource-shares",
    shareQueryParams,
  );
  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    props.onOpenChange?.(v);
    if (v && pendingVisibility === null) sharesQuery.refetch();
  };

  useEffect(() => {
    if (!props.defaultOpen || appliedDefaultOpenRef.current) return;
    appliedDefaultOpenRef.current = true;
    handleOpenChange(true);
  });

  const updateCachedVisibility = (visibility: Visibility) => {
    queryClient.setQueryData<SharesResponse>(shareQueryKey, (prev) =>
      prev ? { ...prev, visibility } : prev,
    );
  };

  const handleVisibilityChange = (next: Visibility): Promise<void> => {
    const requestId = ++visibilityRequestId.current;
    const previous = queryClient.getQueryData<SharesResponse>(shareQueryKey);
    setPendingVisibility(next);
    updateCachedVisibility(next);
    return new Promise((resolve, reject) => {
      setVisibility.mutate(
        {
          resourceType: props.resourceType,
          resourceId: props.resourceId,
          visibility: next,
        } as any,
        {
          onSuccess: (result: any) => {
            if (requestId === visibilityRequestId.current) {
              updateCachedVisibility(
                (result?.visibility as Visibility | undefined) ?? next,
              );
            }
            sharesQuery
              .refetch()
              .then(() => resolve())
              .catch(reject)
              .finally(() => {
                if (requestId === visibilityRequestId.current) {
                  setPendingVisibility(null);
                }
              });
          },
          onError: (error) => {
            if (requestId === visibilityRequestId.current) {
              setPendingVisibility(null);
              if (previous) {
                queryClient.setQueryData(shareQueryKey, previous);
              } else {
                queryClient.invalidateQueries({ queryKey: shareQueryKey });
              }
            }
            reject(error);
          },
        },
      );
    });
  };

  // The default trigger says "Share" — the icon reflects the resource's
  // current visibility (lock / building / globe), matching Google Docs.
  // While the query is loading and we don't know the visibility yet,
  // render a skeleton placeholder in the icon slot instead of guessing.
  const iconOnly = props.trigger === "icon";
  const loaded = sharesQuery.data !== undefined;
  const serverVisibility =
    (sharesQuery.data?.visibility as Visibility | null) ?? "private";
  const currentVisibility = pendingVisibility ?? serverVisibility;
  const VisibilityIcon =
    currentVisibility === "public"
      ? IconWorld
      : currentVisibility === "org"
        ? IconBuilding
        : IconLock;
  const TriggerIcon = iconOnly ? IconShare3 : VisibilityIcon;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            iconOnly ? BUTTON_GHOST_ICON : BUTTON_OUTLINE_SM,
            props.triggerClassName,
          )}
          aria-label={iconOnly ? "Share" : undefined}
        >
          {loaded || iconOnly ? (
            <TriggerIcon size={16} strokeWidth={1.75} />
          ) : (
            <span
              aria-hidden
              className="inline-block h-4 w-4 rounded-sm bg-muted animate-pulse"
            />
          )}
          {!iconOnly && <span>Share</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className={cn(
          "z-[2000] w-[min(460px,92vw)] rounded-lg p-4 shadow-lg",
          SHARE_POPOVER_SURFACE,
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SharePanel
          {...props}
          sharesQuery={sharesQuery}
          visibilityOverride={pendingVisibility}
          onVisibilityChange={handleVisibilityChange}
          onClose={() => handleOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

interface OrgMember {
  email: string;
  name?: string | null;
  role?: string | null;
  joinedAt?: number | null;
}

interface OrgMembersResponse {
  members: OrgMember[];
  hasMore?: boolean;
  nextOffset?: number | null;
}

interface OrgMemberSearch {
  members: OrgMember[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: boolean;
  loadMore: () => void;
}

function useOrgMemberSearch(query: string, enabled: boolean): OrgMemberSearch {
  const search = query.trim();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    (offset: number, append: boolean) => {
      if (!enabled) return;
      const requestId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setMembers([]);
        setNextOffset(null);
        setHasMore(false);
      }
      setError(false);

      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("limit", String(MEMBER_SUGGESTION_LIMIT));
      params.set("offset", String(offset));

      fetch(`${agentNativePath("/_agent-native/org/members")}?${params}`, {
        credentials: "include",
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error("Could not load people");
          return response.json() as Promise<OrgMembersResponse>;
        })
        .then((data) => {
          if (controller.signal.aborted || requestId !== requestIdRef.current)
            return;
          const nextMembers = normalizeMembers(data?.members);
          setMembers((prev) =>
            append ? mergeMembers(prev, nextMembers) : nextMembers,
          );
          setHasMore(data?.hasMore === true);
          setNextOffset(
            typeof data?.nextOffset === "number" ? data.nextOffset : null,
          );
        })
        .catch((err) => {
          if (controller.signal.aborted || requestId !== requestIdRef.current)
            return;
          setError(true);
          setHasMore(false);
          setNextOffset(null);
          if (!append) setMembers([]);
          if (process.env.NODE_ENV === "development") {
            console.warn("[ShareButton] org member search failed", err);
          }
        })
        .finally(() => {
          if (controller.signal.aborted || requestId !== requestIdRef.current)
            return;
          if (append) setIsLoadingMore(false);
          else setIsLoading(false);
        });
    },
    [enabled, search],
  );

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      setMembers([]);
      setNextOffset(null);
      setHasMore(false);
      setIsLoading(false);
      setIsLoadingMore(false);
      setError(false);
      return;
    }
    const timeout = setTimeout(
      () => fetchPage(0, false),
      search ? MEMBER_SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timeout);
      abortRef.current?.abort();
    };
  }, [enabled, fetchPage, search]);

  const loadMore = useCallback(() => {
    if (!enabled || !hasMore || nextOffset === null) return;
    if (isLoading || isLoadingMore) return;
    fetchPage(nextOffset, true);
  }, [enabled, fetchPage, hasMore, isLoading, isLoadingMore, nextOffset]);

  return {
    members,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
  };
}

function normalizeMembers(value: unknown): OrgMember[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((m: any) => ({
      email: typeof m?.email === "string" ? m.email : "",
      name: typeof m?.name === "string" ? m.name : null,
      role: typeof m?.role === "string" ? m.role : null,
      joinedAt:
        typeof m?.joinedAt === "number"
          ? m.joinedAt
          : typeof m?.joined_at === "number"
            ? m.joined_at
            : null,
    }))
    .filter((m) => m.email);
}

function mergeMembers(existing: OrgMember[], next: OrgMember[]): OrgMember[] {
  const seen = new Set(existing.map((m) => m.email.toLowerCase()));
  const merged = [...existing];
  for (const member of next) {
    const key = member.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(member);
  }
  return merged;
}

function SharePanel(
  props: ShareButtonProps & {
    sharesQuery: ReturnType<typeof useActionQuery<SharesResponse>>;
    visibilityOverride: Visibility | null;
    onVisibilityChange: (visibility: Visibility) => Promise<void>;
    onClose: () => void;
  },
) {
  const {
    resourceType,
    resourceId,
    resourceTitle,
    sharesQuery,
    visibilityOverride,
    onVisibilityChange,
    onClose,
  } = props;

  const share = useActionMutation("share-resource");
  const unshare = useActionMutation("unshare-resource");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [notifyPeople, setNotifyPeople] = useState(true);
  const [shareError, setShareError] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const hasInviteEmail = email.trim().length > 0;

  // Optimistic overlays so clicks feel instant.
  const [pendingAdds, setPendingAdds] = useState<Share[]>([]);
  const [pendingRemoves, setPendingRemoves] = useState<Set<string>>(new Set());
  const [roleOverrides, setRoleOverrides] = useState<Record<string, Role>>({});
  // Principals with an in-flight share/unshare mutation. We disable the
  // role dropdown and the trash button for any share in this set so a
  // user can't race a role-change against a remove (which would otherwise
  // let the upsert silently re-grant access after the delete landed), and
  // can't rapid-fire two creates for the same pending add.
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const addInFlight = (k: string) =>
    setInFlight((prev) => new Set(prev).add(k));
  const clearInFlight = (k: string) =>
    setInFlight((prev) => {
      const next = new Set(prev);
      next.delete(k);
      return next;
    });

  useEffect(() => {
    sharesQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = sharesQuery.data;
  const isLoading = data === undefined;
  const policy: SharesPolicy = data?.policy ?? {
    allowPublic: true,
    requireOrgMemberForUserShares: false,
  };
  const visibility: Visibility =
    visibilityOverride ?? (data?.visibility as Visibility | null) ?? "private";
  const canManage = data?.role === "owner" || data?.role === "admin";
  const meta = visibilityMeta(visibility, props.visibilityCopy);
  const peopleAccessLabel = props.peopleAccessLabel ?? "People with access";
  const generalAccessLabel = props.generalAccessLabel ?? "General access";
  const shareLinks = (
    <>
      {props.shareUrl ? (
        <CopyLinkField
          value={props.shareUrl}
          label={props.shareUrlLabel}
          description={props.shareUrlDescription}
        />
      ) : props.shareUrlPlaceholder ? (
        <div className="mb-4 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
          {props.shareUrlLabel ? (
            <div className="mb-0.5 font-medium text-foreground">
              {props.shareUrlLabel}
            </div>
          ) : null}
          {props.shareUrlPlaceholder}
        </div>
      ) : null}

      {props.secondaryShareUrl ? (
        <CopyLinkField
          value={props.secondaryShareUrl}
          label={props.secondaryShareUrlLabel}
          description={props.secondaryShareUrlDescription}
        />
      ) : null}
    </>
  );
  const showShareLinks =
    Boolean(props.shareUrl) ||
    Boolean(props.shareUrlPlaceholder) ||
    Boolean(props.secondaryShareUrl);
  const shareUrlPlacement = props.shareUrlPlacement ?? "bottom";

  const serverShares = data?.shares ?? [];
  const shares: Share[] = [
    ...serverShares
      .filter((s) => !pendingRemoves.has(keyOf(s)))
      .map((s) => ({ ...s, role: roleOverrides[keyOf(s)] ?? s.role })),
    ...pendingAdds,
  ];
  const memberSearch = useOrgMemberSearch(email, canManage && suggestionsOpen);
  const excludedMemberEmails = new Set<string>();
  if (data?.ownerEmail) excludedMemberEmails.add(data.ownerEmail.toLowerCase());
  for (const s of shares) {
    if (s.principalType === "user") {
      excludedMemberEmails.add(s.principalId.toLowerCase());
    }
  }
  const memberSuggestions = memberSearch.members.filter(
    (m) => !excludedMemberEmails.has(m.email.toLowerCase()),
  );
  const knownMembers = memberSearch.members;

  const handleVisibility = (next: Visibility) => {
    if (next === visibility) return;
    setShareError(null);
    void onVisibilityChange(next).catch((err) => {
      setShareError(extractShareErrorMessage(err));
    });
  };

  const handleHideInSearch = () => {
    const control = props.hideInSearchControl;
    if (!control || control.pending || !canManage) return;
    setShareError(null);
    try {
      Promise.resolve(control.onCheckedChange(!control.checked)).catch(
        (err) => {
          setShareError(extractShareErrorMessage(err));
        },
      );
    } catch (err) {
      setShareError(extractShareErrorMessage(err));
    }
  };

  const handleAdd = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    const optimistic: Share = {
      id: `pending-${trimmed}`,
      principalType: "user",
      principalId: trimmed,
      role,
    };
    const k = keyOf(optimistic);
    // Ignore duplicate submits while an add for the same principal is in flight.
    if (inFlight.has(k)) return;
    setShareError(null);
    setPendingAdds((p) => [...p, optimistic]);
    setEmail("");
    setSuggestionsOpen(false);
    addInFlight(k);
    share.mutate(
      {
        resourceType,
        resourceId,
        principalType: "user",
        principalId: trimmed,
        role,
        notify: notifyPeople,
        resourceUrl: getNotificationUrl(props.shareUrl),
      } as any,
      {
        onSuccess: () => {
          sharesQuery.refetch().then(() => {
            setPendingAdds((p) => p.filter((s) => s.id !== optimistic.id));
            clearInFlight(k);
          });
        },
        onError: (err: any) => {
          setPendingAdds((p) => p.filter((s) => s.id !== optimistic.id));
          clearInFlight(k);
          setEmail(trimmed);
          setShareError(extractShareErrorMessage(err));
        },
      },
    );
  };

  const handleChangeRole = (s: Share, next: Role) => {
    if (s.role === next) return;
    const k = keyOf(s);
    // Don't stack a role change on top of an in-flight add/remove/role
    // change for the same principal — it can race with unshare and end up
    // re-granting access after a delete. UI already disables the control,
    // but belt-and-suspenders here too.
    if (inFlight.has(k)) return;
    setRoleOverrides((prev) => ({ ...prev, [k]: next }));
    addInFlight(k);
    // share-resource is upsert: calling with same principal + new role
    // updates the existing share row. See sharing/actions/share-resource.ts.
    share.mutate(
      {
        resourceType,
        resourceId,
        principalType: s.principalType,
        principalId: s.principalId,
        role: next,
        notify: false,
      } as any,
      {
        onSuccess: () => {
          sharesQuery.refetch().then(() => {
            setRoleOverrides((prev) => {
              const { [k]: _, ...rest } = prev;
              return rest;
            });
            clearInFlight(k);
          });
        },
        onError: () => {
          setRoleOverrides((prev) => {
            const { [k]: _, ...rest } = prev;
            return rest;
          });
          clearInFlight(k);
        },
      },
    );
  };

  const handleRemove = (s: Share) => {
    const k = keyOf(s);
    // If any other mutation is in flight for this principal, don't start a
    // remove — it can interleave with an upsert and leave the row in place.
    // The UI already disables the trash button when inFlight.has(k).
    if (inFlight.has(k)) return;
    setPendingRemoves((prev) => new Set(prev).add(k));
    addInFlight(k);
    unshare.mutate(
      {
        resourceType,
        resourceId,
        principalType: s.principalType,
        principalId: s.principalId,
      } as any,
      {
        onSuccess: () => {
          sharesQuery.refetch().then(() => {
            setPendingRemoves((prev) => {
              const next = new Set(prev);
              next.delete(k);
              return next;
            });
            clearInFlight(k);
          });
        },
        onError: () => {
          setPendingRemoves((prev) => {
            const next = new Set(prev);
            next.delete(k);
            return next;
          });
          clearInFlight(k);
        },
      },
    );
  };

  const handleDone = () => {
    if (canManage && hasInviteEmail) handleAdd();
    onClose();
  };

  const titleText = resourceTitle
    ? `Share "${resourceTitle}"`
    : `Share ${resourceType}`;

  if (isLoading) {
    return (
      <div>
        <div
          className="mb-3 truncate text-base font-semibold"
          title={titleText}
        >
          {titleText}
        </div>
        <div className="mb-4 h-9 rounded-md bg-muted animate-pulse" />
        <div className="mb-2 text-sm font-semibold">{peopleAccessLabel}</div>
        <div className="mb-4 h-7 rounded-md bg-muted animate-pulse" />
        <div className="mb-2 text-sm font-semibold">{generalAccessLabel}</div>
        <div className="mb-4 h-9 rounded-md bg-muted animate-pulse" />
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={onClose} className={BUTTON_PRIMARY_SM}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 truncate text-base font-semibold" title={titleText}>
        {titleText}
      </div>

      {showShareLinks && shareUrlPlacement === "top" ? shareLinks : null}

      {canManage ? (
        <div className="mb-4 space-y-2">
          <div className="flex items-stretch gap-2">
            <MemberAutocomplete
              value={email}
              open={suggestionsOpen}
              onOpenChange={setSuggestionsOpen}
              onValueChange={(next) => {
                setEmail(next);
                if (shareError) setShareError(null);
              }}
              onSelectMember={(member) => {
                setEmail(member.email);
                setSuggestionsOpen(false);
                if (shareError) setShareError(null);
              }}
              onSubmit={handleAdd}
              placeholder={
                policy.requireOrgMemberForUserShares
                  ? "Add people from your organization"
                  : "Add people by email"
              }
              suggestions={memberSuggestions}
              search={memberSearch}
            />
            <RoleSelect value={role} onChange={setRole} />
          </div>
          {shareError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {shareError}
            </div>
          ) : null}
          {hasInviteEmail ? (
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={notifyPeople}
                onChange={(e) => setNotifyPeople(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Notify people
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="mb-2 text-sm font-semibold">{peopleAccessLabel}</div>
      <ul className="mb-4 flex flex-col gap-1 list-none p-0 m-0">
        {data?.ownerEmail ? (
          <li className="flex items-center gap-3 px-1 py-1.5 text-sm">
            <Avatar label={displayName(data.ownerEmail, knownMembers)} />
            <span className="flex-1 min-w-0 truncate">
              {displayName(data.ownerEmail, knownMembers)}
            </span>
            <span className="text-xs text-muted-foreground">Owner</span>
          </li>
        ) : null}
        {shares.map((s) => (
          <li
            key={keyOf(s)}
            className={cn(
              "flex items-center gap-3 px-1 py-1.5 text-sm",
              inFlight.has(keyOf(s)) && "opacity-60",
            )}
          >
            <Avatar
              label={
                s.principalType === "org"
                  ? s.principalId
                  : displayName(s.principalId, knownMembers)
              }
              org={s.principalType === "org"}
            />
            <span className="flex-1 min-w-0 truncate">
              {s.principalType === "org"
                ? s.principalId
                : displayName(s.principalId, knownMembers)}
            </span>
            {canManage ? (
              <RoleSelect
                value={s.role}
                onChange={(r) => handleChangeRole(s, r)}
                disabled={inFlight.has(keyOf(s))}
                plain
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                {cap(s.role)}
              </span>
            )}
            {canManage ? (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => handleRemove(s)}
                disabled={inFlight.has(keyOf(s))}
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

      <div className="mb-2 text-sm font-semibold">{generalAccessLabel}</div>
      <div className="mb-4 flex items-center gap-3">
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
            visibilityCopy={props.visibilityCopy}
            allowPublic={policy.allowPublic}
          />
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{meta.description}</span>
            {visibility === "org" && props.hideInSearchControl ? (
              <AdvancedAccessPopover
                control={props.hideInSearchControl}
                canManage={canManage}
                onToggle={handleHideInSearch}
              />
            ) : null}
          </div>
        </div>
      </div>

      {props.accessNote ? (
        <div className="mb-4 rounded-md border border-border bg-muted/35 p-3 text-xs text-muted-foreground">
          {props.accessNote}
        </div>
      ) : null}

      {showShareLinks && shareUrlPlacement === "bottom" ? shareLinks : null}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={handleDone}
          className={BUTTON_PRIMARY_SM}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function AdvancedAccessPopover({
  control,
  canManage,
  onToggle,
}: {
  control: HideInSearchControl;
  canManage: boolean;
  onToggle: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!canManage}
          className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Advanced
          <IconChevronDown size={12} strokeWidth={1.8} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn("z-[2300] w-72 p-3 shadow-lg", SHARE_POPOVER_SURFACE)}
      >
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-foreground">
              Advanced access
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              Control how organization access appears in search.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={control.checked}
            disabled={!canManage || control.pending}
            onClick={onToggle}
            className={cn(
              "flex w-full items-start gap-3 rounded-md border border-border/70 bg-background px-3 py-2.5 text-start transition-colors hover:bg-accent/45 disabled:cursor-not-allowed disabled:opacity-60",
              control.checked && "border-border bg-accent/35 text-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-muted-foreground/25 transition-colors",
                control.checked && "border-primary/70 bg-primary",
              )}
            >
              <span
                className={cn(
                  "ml-0.5 size-4 rounded-full bg-background shadow-sm transition-transform",
                  control.checked && "translate-x-4",
                )}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <IconSearchOff size={14} strokeWidth={1.8} />
                {control.label ?? "Hide in search"}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {control.description ??
                  "People with the link can still open this."}
              </span>
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface MemberAutocompleteProps {
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  onSelectMember: (member: OrgMember) => void;
  onSubmit: () => void;
  placeholder: string;
  suggestions: OrgMember[];
  search: OrgMemberSearch;
}

function MemberAutocomplete({
  value,
  open,
  onOpenChange,
  onValueChange,
  onSelectMember,
  onSubmit,
  placeholder,
  suggestions,
  search,
}: MemberAutocompleteProps) {
  const rawListboxId = useId();
  const listboxId = rawListboxId.replace(/:/g, "");
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeMember =
    activeIndex >= 0 && activeIndex < suggestions.length
      ? suggestions[activeIndex]
      : null;

  useEffect(() => {
    setActiveIndex(-1);
  }, [value]);

  useEffect(() => {
    if (activeIndex >= suggestions.length) {
      setActiveIndex(suggestions.length > 0 ? suggestions.length - 1 : -1);
    }
  }, [activeIndex, suggestions.length]);

  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(optionId(listboxId, activeIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId]);

  const chooseMember = (member: OrgMember) => {
    onSelectMember(member);
    onOpenChange(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onOpenChange(true);
      if (suggestions.length === 0) return;
      setActiveIndex((prev) => {
        if (prev >= suggestions.length - 1) {
          if (search.hasMore && !search.isLoadingMore) search.loadMore();
          return suggestions.length - 1;
        }
        return prev + 1;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onOpenChange(true);
      if (suggestions.length === 0) return;
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
      return;
    }

    if (event.key === "Enter") {
      if (open && activeMember) {
        event.preventDefault();
        chooseMember(activeMember);
        return;
      }
      if (value.trim()) {
        event.preventDefault();
        onSubmit();
      }
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      setActiveIndex(-1);
    }
  };

  const handleScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (
      search.hasMore &&
      !search.isLoadingMore &&
      target.scrollTop + target.clientHeight >= target.scrollHeight - 24
    ) {
      search.loadMore();
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div className="relative flex-1 min-w-0">
          <IconSearch
            aria-hidden
            size={15}
            strokeWidth={1.8}
            className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            type="email"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={
              activeIndex >= 0 ? optionId(listboxId, activeIndex) : undefined
            }
            placeholder={placeholder}
            value={value}
            onChange={(event) => {
              onValueChange(event.target.value);
              onOpenChange(true);
            }}
            onFocus={() => onOpenChange(true)}
            onBlur={() => {
              setTimeout(() => {
                if (document.activeElement !== inputRef.current) {
                  onOpenChange(false);
                }
              }, 0);
            }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            className="h-9 w-full min-w-0 rounded-md border border-input bg-background ps-8 pe-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
          />
          {search.isLoading ? (
            <IconLoader2
              aria-hidden
              size={15}
              strokeWidth={1.8}
              className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          "z-[2200] w-[var(--radix-popper-anchor-width)] min-w-[18rem] rounded-md p-1 shadow-lg",
          SHARE_POPOVER_SURFACE,
        )}
      >
        <div
          id={listboxId}
          role="listbox"
          className="max-h-56 overflow-y-auto overflow-x-hidden"
          onScroll={handleScroll}
        >
          {suggestions.map((member, index) => {
            const active = index === activeIndex;
            return (
              <div
                key={member.email}
                id={optionId(listboxId, index)}
                role="option"
                aria-selected={active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseMember(member)}
                className={cn(
                  "flex cursor-pointer select-none flex-col rounded-sm px-3 py-2 text-sm outline-none",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span className="truncate font-medium">
                  {member.name?.trim() || member.email}
                </span>
                {member.name?.trim() ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {member.email}
                  </span>
                ) : null}
              </div>
            );
          })}

          {search.isLoading && suggestions.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              Searching...
            </div>
          ) : null}

          {search.error ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              Could not load people.
            </div>
          ) : null}

          {!search.isLoading && !search.error && suggestions.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              {value.trim() ? "No matches." : "No people found."}
            </div>
          ) : null}

          {search.isLoadingMore ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <IconLoader2
                aria-hidden
                size={14}
                strokeWidth={1.8}
                className="animate-spin"
              />
              Loading...
            </div>
          ) : null}

          {search.hasMore && !search.isLoadingMore ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={search.loadMore}
              className="mt-1 flex w-full items-center justify-center rounded-sm px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              Load more
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function optionId(baseId: string, index: number): string {
  return `${baseId}-option-${index}`;
}

function CopyLinkField({
  value,
  label = "Share link",
  description,
}: {
  value: string;
  label?: string;
  description?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (await writeClipboardText(value)) {
      setCopied(true);
      if (resetRef.current) clearTimeout(resetRef.current);
      resetRef.current = setTimeout(() => setCopied(false), 1400);
    } else {
      setCopied(false);
    }
  };

  return (
    <div className="mb-4">
      <div className="mb-2 text-sm font-semibold">{label}</div>
      {description ? (
        <div className="mb-2 text-xs text-muted-foreground">{description}</div>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <input
          readOnly
          value={value}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground outline-none"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent"
        >
          {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radix Select wrappers styled like shadcn Select (no native <select> anywhere)
// ---------------------------------------------------------------------------

const selectContentClass =
  "z-[2100] min-w-[12rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";
const selectItemClass =
  "relative flex w-full cursor-pointer select-none items-start gap-2 rounded-sm py-2 ps-8 pe-3 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

interface ShadSelectItemProps {
  value: string;
  label: string;
  description?: string;
}

function SelectItems({ items }: { items: ShadSelectItemProps[] }) {
  return (
    <>
      {items.map((it) => (
        <Select.Item
          key={it.value}
          value={it.value}
          className={selectItemClass}
        >
          <span className="absolute start-2 top-2 flex h-4 w-4 items-center justify-center">
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

function RoleSelect(props: {
  value: Role;
  onChange: (v: Role) => void;
  disabled?: boolean;
  /** When true, render as inline text + chevron (no border / bg) — matches
   *  the per-person role picker in Google Docs. */
  plain?: boolean;
}) {
  const current =
    ROLE_OPTIONS.find((o) => o.value === props.value) ?? ROLE_OPTIONS[0];
  return (
    <Select.Root
      value={props.value}
      onValueChange={(v) => props.onChange(v as Role)}
      disabled={props.disabled}
    >
      <Select.Trigger
        className={
          props.plain
            ? cn(
                BUTTON_BASE,
                "h-7 px-2 bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            : cn(
                BUTTON_BASE,
                "h-9 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground",
              )
        }
        aria-label="Role"
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
  visibilityCopy?: ShareButtonProps["visibilityCopy"];
  /** When false, the "Public" option is omitted. Default: true. */
  allowPublic?: boolean;
}) {
  const allowPublic = props.allowPublic !== false;
  const current = visibilityMeta(props.value, props.visibilityCopy);
  const options = (Object.keys(VIS_META) as Visibility[]).filter(
    (k) => allowPublic || k !== "public",
  );
  return (
    <Select.Root
      value={props.value}
      onValueChange={(v) => props.onChange(v as Visibility)}
      disabled={props.disabled}
    >
      <Select.Trigger
        className={cn(
          BUTTON_BASE,
          "h-7 px-1 -ms-1 bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        )}
        aria-label="General access"
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
              items={options.map((k) => ({
                value: k,
                label: visibilityMeta(k, props.visibilityCopy).label,
                description: visibilityMeta(k, props.visibilityCopy)
                  .description,
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
      {org ? <IconBuilding size={14} strokeWidth={1.75} /> : initials(label)}
    </span>
  );
}

function keyOf(s: Share): string {
  return `${s.principalType}:${s.principalId}`;
}

/**
 * Pull a user-readable error message out of a failed action call. Action
 * routes surface server-side errors as a JSON `{ error: string }` body that
 * the `useActionMutation` wrapper re-throws as
 * `Error("Action <name> failed: <message>")`. Strip the framework prefix so
 * what reaches the user is the underlying server message.
 */
function extractShareErrorMessage(err: unknown): string {
  const fallback = "Could not update sharing — please try again.";
  const pickRaw = (): string | null => {
    if (!err) return null;
    if (err instanceof Error) return err.message?.trim() || null;
    if (typeof err === "string") return err.trim() || null;
    if (typeof err === "object") {
      const any = err as { error?: unknown; message?: unknown };
      if (typeof any.error === "string" && any.error.trim()) return any.error;
      if (typeof any.message === "string" && any.message.trim())
        return any.message;
    }
    return null;
  };
  const raw = pickRaw();
  if (!raw || raw.toLowerCase() === "failed to fetch") return fallback;
  const stripped = raw.replace(/^Action\s+[\w-]+\s+failed:\s*/i, "");
  return stripped || fallback;
}
function getNotificationUrl(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (typeof window === "undefined") return undefined;
  return window.location.href;
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function initials(s: string): string {
  const name = s.split("@")[0] ?? s;
  return (name[0] ?? "?").toUpperCase();
}

function displayName(email: string, members: OrgMember[]): string {
  const match = members.find((m) => m.email === email);
  if (match?.name && match.name.trim()) return match.name;
  return email;
}
