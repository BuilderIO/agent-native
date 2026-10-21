import { useCallback, useEffect, useRef, useState } from "react";

import { useActionQuery } from "../use-action.js";
import {
  DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS,
  DEFAULT_MEMBER_SUGGESTION_LIMIT,
  extractShareErrorMessage,
  notifyShareChanged,
  optimisticallyUpdateShareCache,
  optimisticallyUpdateShareVisibility,
  rollbackShareCache,
  useShareOrgMemberSearch,
  useShareMutationGuard,
  useShareMutations,
  useShareQuery,
} from "./share-controller-helpers.js";
import {
  useShareVisibilityTransition,
  type ShareVisibilityTransition,
} from "./useShareVisibilityTransition.js";

export type ShareButtonVisibility = "private" | "org" | "public";
export type ShareButtonRole = "viewer" | "commenter" | "editor" | "admin";

export interface ShareButtonShare {
  id: string;
  principalType: "user" | "group" | "org";
  principalId: string;
  displayName?: string | null;
  role: ShareButtonRole;
}

export interface ShareButtonGroup {
  id: string;
  name: string;
  memberEmails?: string[];
}

export interface ShareButtonSharesResponse {
  ownerEmail: string | null;
  orgId: string | null;
  visibility: ShareButtonVisibility | null;
  role?: "owner" | ShareButtonRole;
  agentReadable?: boolean;
  shares: ShareButtonShare[];
  policy?: {
    allowPublic: boolean;
    requireOrgMemberForUserShares: boolean;
    supportsGroupShares?: boolean;
  };
}

export interface ShareButtonOrgMember {
  email: string;
  name?: string | null;
  image?: string | null;
  role?: string | null;
  joinedAt?: number | null;
}

export interface ShareButtonOrgMemberSearch {
  members: ShareButtonOrgMember[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: boolean;
  loadMore: () => void;
}

export interface ShareButtonControllerOptions {
  resourceType: string;
  resourceId: string;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onShareSuccess?: () => void;
  shareTabs?: {
    defaultValue?: string;
    onValueChange?: (value: string) => void;
  };
  shareUrl?: string;
  allowedRoles?: readonly ShareButtonRole[];
  hideInSearchControl?: {
    checked: boolean;
    pending?: boolean;
    onCheckedChange: (checked: boolean) => void | Promise<void>;
  };
}

export interface ShareButtonController {
  open: boolean;
  handleOpenChange: (open: boolean) => void;
  activeShareTab: string;
  handleShareTabChange: (value: string) => void;
  inviteEmail: string;
  setInviteEmail: (email: string) => void;
  sharesQuery: ReturnType<typeof useActionQuery<ShareButtonSharesResponse>>;
  visibilityOverride: ShareButtonVisibility | null;
  /**
   * @deprecated Use `visibilityTransition.request`, which this calls. It
   * resolves only once the change is persisted. A direct change rejects when
   * its save fails. A private-to-Organization change stays pending through
   * `visibilityTransition.confirm()` failures (retry is possible) and rejects
   * with `ShareVisibilityNotSavedError` once it is cancelled or invalidated.
   * Without manage rights it
   * sets `shareError` and resolves, as it always has.
   */
  handleVisibilityChange: (visibility: ShareButtonVisibility) => Promise<void>;
  /** Request, confirm and cancel a visibility change that needs confirming. */
  visibilityTransition: ShareVisibilityTransition;
  data: ShareButtonSharesResponse | undefined;
  policy: {
    allowPublic: boolean;
    requireOrgMemberForUserShares: boolean;
    supportsGroupShares?: boolean;
  };
  visibility: ShareButtonVisibility;
  triggerVisibility: ShareButtonVisibility | null;
  canManage: boolean;
  role: ShareButtonRole;
  setRole: (role: ShareButtonRole) => void;
  notifyPeople: boolean;
  setNotifyPeople: (notify: boolean) => void;
  shareMessage: string;
  setShareMessage: (message: string) => void;
  messageOpen: boolean;
  setMessageOpen: (open: boolean) => void;
  shareError: string | null;
  setShareError: (error: string | null) => void;
  suggestionsOpen: boolean;
  setSuggestionsOpen: (open: boolean) => void;
  inFlight: Set<string>;
  memberSearch: ShareButtonOrgMemberSearch;
  memberSuggestions: ShareButtonOrgMember[];
  groupSuggestions: ShareButtonGroup[];
  knownMembers: ShareButtonOrgMember[];
  selectedGroup: ShareButtonGroup | null;
  selectGroup: (group: ShareButtonGroup) => void;
  shares: ShareButtonShare[];
  handleVisibility: (visibility: ShareButtonVisibility) => void;
  handleHideInSearch: () => void;
  handleAdd: () => void;
  handleChangeRole: (share: ShareButtonShare, role: ShareButtonRole) => void;
  handleRemove: (share: ShareButtonShare) => void;
}

export function useShareButtonController(
  options: ShareButtonControllerOptions,
): ShareButtonController {
  const [open, setOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<ShareButtonGroup | null>(
    null,
  );
  const shareTabDefaultValue = options.shareTabs?.defaultValue ?? "share";
  const [activeShareTab, setActiveShareTab] = useState(shareTabDefaultValue);
  const resourceKey = `${options.resourceType}:${options.resourceId}`;
  // Tied to the resource it was made for: a click that lands on a new resource
  // before any effect runs must not see the previous resource's value.
  const [visibilityOverrideState, setVisibilityOverrideState] = useState<{
    resourceKey: string;
    token: object;
    value: ShareButtonVisibility;
  } | null>(null);
  const visibilityOverride =
    visibilityOverrideState?.resourceKey === resourceKey
      ? visibilityOverrideState.value
      : null;
  const clearVisibilityOverride = useCallback(
    (key: string, token: object) =>
      setVisibilityOverrideState((state) =>
        state?.resourceKey === key && state.token === token ? null : state,
      ),
    [],
  );
  const appliedDefaultOpenRef = useRef(false);
  const {
    queryKey: shareQueryKey,
    query: sharesQuery,
    queryClient,
  } = useShareQuery<ShareButtonSharesResponse>(
    options.resourceType,
    options.resourceId,
    open,
    0,
  );
  const { setVisibility, share, unshare } = useShareMutations();
  const visibilityGuard = useShareMutationGuard(resourceKey);
  const data = sharesQuery.data;
  const canManage = data?.role === "owner" || data?.role === "admin";
  const [shareError, setShareError] = useState<string | null>(null);
  const visibility =
    visibilityOverride ?? data?.visibility ?? ("private" as const);
  const triggerVisibility =
    visibilityOverride ?? (data ? (data.visibility ?? "private") : null);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      options.onOpenChange?.(nextOpen);
      if (nextOpen) {
        setActiveShareTab(shareTabDefaultValue);
        options.shareTabs?.onValueChange?.(shareTabDefaultValue);
      }
    },
    [options, shareTabDefaultValue],
  );

  useEffect(() => {
    setInviteEmail("");
    setSelectedGroup(null);
    setShareMessage("");
    setMessageOpen(false);
  }, [options.resourceId, options.resourceType]);

  useEffect(() => {
    if (!options.defaultOpen || appliedDefaultOpenRef.current) return;
    appliedDefaultOpenRef.current = true;
    handleOpenChange(true);
  }, [handleOpenChange, options.defaultOpen]);

  const handleShareTabChange = useCallback(
    (value: string) => {
      setActiveShareTab(value);
      options.shareTabs?.onValueChange?.(value);
    },
    [options.shareTabs],
  );

  const applyVisibility = useCallback(
    async (next: ShareButtonVisibility): Promise<void> => {
      if (!canManage) {
        setShareError("Only owners and admins can change access.");
        return;
      }
      const requestId = visibilityGuard.begin();
      const token = {};
      const mutation =
        optimisticallyUpdateShareVisibility<ShareButtonSharesResponse>(
          queryClient,
          shareQueryKey,
          next,
        );
      setVisibilityOverrideState({ resourceKey, token, value: next });
      let result: unknown;
      try {
        // Settles for this call alone: per-call mutate callbacks are skipped
        // once a newer call supersedes it or the observer unmounts.
        result = await setVisibility.mutateAsync({
          resourceType: options.resourceType,
          resourceId: options.resourceId,
          visibility: next,
        } as never);
      } catch (error) {
        mutation.rollback();
        clearVisibilityOverride(resourceKey, token);
        if (visibilityGuard.isLatest(requestId)) {
          void sharesQuery.refetch();
        }
        throw error;
      }
      notifyShareChanged(options.resourceType);
      const resultVisibility =
        typeof result === "object" &&
        result !== null &&
        "visibility" in result &&
        (result as { visibility?: unknown }).visibility;
      mutation.commit(
        (resultVisibility as ShareButtonVisibility | undefined) ?? next,
      );
      if (visibilityGuard.isLatest(requestId)) {
        if (
          visibility === "private" &&
          (resultVisibility === "org" || resultVisibility === "public")
        ) {
          options.onShareSuccess?.();
        }
      }
      try {
        if (visibilityGuard.isLatest(requestId)) await sharesQuery.refetch();
      } finally {
        clearVisibilityOverride(resourceKey, token);
      }
    },
    [
      options.resourceId,
      options.resourceType,
      queryClient,
      setVisibility,
      shareQueryKey,
      sharesQuery,
      canManage,
      visibilityGuard,
      options.onShareSuccess,
      visibility,
      resourceKey,
      clearVisibilityOverride,
    ],
  );

  const policy = data?.policy ?? {
    allowPublic: true,
    requireOrgMemberForUserShares: false,
  };
  const [role, setRole] = useState<ShareButtonRole>("viewer");
  useEffect(() => {
    const allowedRoles = options.allowedRoles;
    if (!allowedRoles || allowedRoles.includes(role)) return;
    const fallbackRole = allowedRoles[0];
    if (fallbackRole) setRole(fallbackRole);
  }, [options.allowedRoles, role]);
  const [notifyPeople, setNotifyPeople] = useState(true);
  const [shareMessage, setShareMessage] = useState("");
  const [messageOpen, setMessageOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [pendingAdds, setPendingAdds] = useState<ShareButtonShare[]>([]);
  const [pendingRemoves, setPendingRemoves] = useState<Set<string>>(new Set());
  const [roleOverrides, setRoleOverrides] = useState<
    Record<string, ShareButtonRole>
  >({});
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());

  const addInFlight = useCallback((key: string) => {
    inFlightRef.current.add(key);
    setInFlight((prev) => new Set(prev).add(key));
  }, []);
  const clearInFlight = useCallback((key: string) => {
    inFlightRef.current.delete(key);
    setInFlight((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const memberSearch = useShareOrgMemberSearch(
    inviteEmail,
    canManage && suggestionsOpen,
    {
      limit: DEFAULT_MEMBER_SUGGESTION_LIMIT,
      debounceMs: DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS,
    },
  );
  const groupsQuery = useActionQuery<ShareButtonGroup[]>(
    "list-workspace-user-groups",
    {},
    {
      enabled:
        canManage && policy.supportsGroupShares === true && suggestionsOpen,
      staleTime: 30_000,
    },
  );
  const serverShares = data?.shares ?? [];
  const shares: ShareButtonShare[] = [
    ...serverShares
      .filter((share) => !pendingRemoves.has(keyOf(share)))
      .map((share) => ({
        ...share,
        role: roleOverrides[keyOf(share)] ?? share.role,
      })),
    ...pendingAdds.filter(
      (pending) =>
        !serverShares.some((share) => keyOf(share) === keyOf(pending)),
    ),
  ];
  const excludedMemberEmails = new Set<string>();
  if (data?.ownerEmail) excludedMemberEmails.add(data.ownerEmail.toLowerCase());
  for (const currentShare of shares) {
    if (currentShare.principalType === "user") {
      excludedMemberEmails.add(currentShare.principalId.toLowerCase());
    }
  }
  const memberSuggestions = memberSearch.members.filter(
    (member) => !excludedMemberEmails.has(member.email.toLowerCase()),
  );
  const excludedGroupIds = new Set(
    shares
      .filter((share) => share.principalType === "group")
      .map((share) => share.principalId),
  );
  const groupSuggestions = (
    Array.isArray(groupsQuery.data) ? groupsQuery.data : []
  ).filter(
    (group) =>
      !excludedGroupIds.has(group.id) &&
      (!inviteEmail.trim() ||
        group.name.toLowerCase().includes(inviteEmail.trim().toLowerCase())),
  );
  const knownMembers = memberSearch.members;

  const setInviteEmailValue = useCallback((email: string) => {
    setSelectedGroup(null);
    setInviteEmail(email);
  }, []);
  const selectGroup = useCallback((group: ShareButtonGroup) => {
    setSelectedGroup(group);
    setInviteEmail(group.name);
  }, []);

  const visibilityTransition = useShareVisibilityTransition({
    resourceType: options.resourceType,
    resourceId: options.resourceId,
    current: visibility,
    orgId: data?.orgId ?? null,
    canManage,
    active: open,
    apply: applyVisibility,
    onDirectError: (error) => setShareError(extractShareErrorMessage(error)),
  });
  const requestVisibility = visibilityTransition.request;

  const handleVisibility = useCallback(
    (next: ShareButtonVisibility) => {
      if (next === visibility) return;
      if (!canManage) {
        setShareError("Only owners and admins can change access.");
        return;
      }
      setShareError(null);
      void requestVisibility(next);
    },
    [canManage, requestVisibility, visibility],
  );
  const handleVisibilityChange = useCallback(
    (next: ShareButtonVisibility): Promise<void> => {
      if (!canManage) {
        setShareError("Only owners and admins can change access.");
        return Promise.resolve();
      }
      setShareError(null);
      return requestVisibility(next);
    },
    [canManage, requestVisibility],
  );

  const handleHideInSearch = useCallback(() => {
    const control = options.hideInSearchControl;
    if (!control || control.pending || !canManage) return;
    setShareError(null);
    try {
      Promise.resolve(control.onCheckedChange(!control.checked)).catch(
        (error) => setShareError(extractShareErrorMessage(error)),
      );
    } catch (error) {
      setShareError(extractShareErrorMessage(error));
    }
  }, [canManage, options.hideInSearchControl]);

  const handleAdd = useCallback(() => {
    const trimmed = inviteEmail.trim();
    if (!trimmed || !canManage) return;
    const principalType = selectedGroup ? "group" : "user";
    const principalId = selectedGroup?.id ?? trimmed;
    const message =
      principalType === "user" && notifyPeople ? shareMessage.trim() : "";
    const optimistic: ShareButtonShare = {
      id: `pending-${principalType}-${principalId}`,
      principalType,
      principalId,
      ...(selectedGroup ? { displayName: selectedGroup.name } : {}),
      role,
    };
    const key = keyOf(optimistic);
    if (inFlightRef.current.has(key)) return;
    setShareError(null);
    setPendingAdds((previous) => [...previous, optimistic]);
    setInviteEmail("");
    setSelectedGroup(null);
    setShareMessage("");
    setMessageOpen(false);
    setSuggestionsOpen(false);
    addInFlight(key);
    const previous = optimisticallyUpdateShareCache<ShareButtonSharesResponse>(
      queryClient,
      shareQueryKey,
      (cached) =>
        cached ? { ...cached, shares: [...cached.shares, optimistic] } : cached,
    );
    share.mutate(
      {
        resourceType: options.resourceType,
        resourceId: options.resourceId,
        principalType,
        principalId,
        role,
        notify: principalType === "user" && notifyPeople,
        resourceUrl: getNotificationUrl(options.shareUrl),
        ...(message ? { message } : {}),
      } as never,
      {
        onSuccess: (result: unknown) => {
          notifyShareChanged(options.resourceType);
          if (
            !(
              typeof result === "object" &&
              result !== null &&
              "updated" in result &&
              (result as { updated?: unknown }).updated === true
            )
          ) {
            options.onShareSuccess?.();
          }
          void sharesQuery.refetch().then(() => {
            setPendingAdds((previous) =>
              previous.filter((item) => item.id !== optimistic.id),
            );
            clearInFlight(key);
          });
        },
        onError: (error: unknown) => {
          rollbackShareCache(queryClient, shareQueryKey, previous);
          setPendingAdds((previous) =>
            previous.filter((item) => item.id !== optimistic.id),
          );
          clearInFlight(key);
          setInviteEmail(trimmed);
          setSelectedGroup(selectedGroup);
          setShareMessage((current) => current || message);
          setMessageOpen((current) => current || Boolean(message));
          setShareError(extractShareErrorMessage(error));
        },
      },
    );
  }, [
    addInFlight,
    canManage,
    clearInFlight,
    inviteEmail,
    notifyPeople,
    options.resourceId,
    options.resourceType,
    options.onShareSuccess,
    options.shareUrl,
    role,
    selectedGroup,
    shareMessage,
    share,
    queryClient,
    shareQueryKey,
    sharesQuery,
  ]);

  const handleChangeRole = useCallback(
    (currentShare: ShareButtonShare, next: ShareButtonRole) => {
      if (currentShare.role === next) return;
      if (!canManage) {
        setShareError("Only owners and admins can change access.");
        return;
      }
      const key = keyOf(currentShare);
      if (inFlightRef.current.has(key)) return;
      setRoleOverrides((previous) => ({ ...previous, [key]: next }));
      addInFlight(key);
      const previous =
        optimisticallyUpdateShareCache<ShareButtonSharesResponse>(
          queryClient,
          shareQueryKey,
          (cached) =>
            cached
              ? {
                  ...cached,
                  shares: cached.shares.map((share) =>
                    keyOf(share) === key ? { ...share, role: next } : share,
                  ),
                }
              : cached,
        );
      share.mutate(
        {
          resourceType: options.resourceType,
          resourceId: options.resourceId,
          principalType: currentShare.principalType,
          principalId: currentShare.principalId,
          role: next,
          notify: false,
        } as never,
        {
          onSuccess: () => {
            notifyShareChanged(options.resourceType);
            void sharesQuery.refetch().then(() => {
              setRoleOverrides((previous) => {
                const { [key]: _removed, ...rest } = previous;
                return rest;
              });
              clearInFlight(key);
            });
          },
          onError: (error: unknown) => {
            rollbackShareCache(queryClient, shareQueryKey, previous);
            setRoleOverrides((previous) => {
              const { [key]: _removed, ...rest } = previous;
              return rest;
            });
            clearInFlight(key);
            setShareError(extractShareErrorMessage(error));
          },
        },
      );
    },
    [
      addInFlight,
      canManage,
      clearInFlight,
      options.resourceId,
      options.resourceType,
      queryClient,
      shareQueryKey,
      share,
      sharesQuery,
    ],
  );

  const handleRemove = useCallback(
    (currentShare: ShareButtonShare) => {
      if (!canManage) {
        setShareError("Only owners and admins can change access.");
        return;
      }
      const key = keyOf(currentShare);
      if (inFlightRef.current.has(key)) return;
      setPendingRemoves((previous) => new Set(previous).add(key));
      addInFlight(key);
      const previous =
        optimisticallyUpdateShareCache<ShareButtonSharesResponse>(
          queryClient,
          shareQueryKey,
          (cached) =>
            cached
              ? {
                  ...cached,
                  shares: cached.shares.filter((share) => keyOf(share) !== key),
                }
              : cached,
        );
      unshare.mutate(
        {
          resourceType: options.resourceType,
          resourceId: options.resourceId,
          principalType: currentShare.principalType,
          principalId: currentShare.principalId,
        } as never,
        {
          onSuccess: () => {
            notifyShareChanged(options.resourceType);
            void sharesQuery.refetch().then(() => {
              setPendingRemoves((previous) => {
                const next = new Set(previous);
                next.delete(key);
                return next;
              });
              clearInFlight(key);
            });
          },
          onError: (error: unknown) => {
            rollbackShareCache(queryClient, shareQueryKey, previous);
            setPendingRemoves((previous) => {
              const next = new Set(previous);
              next.delete(key);
              return next;
            });
            clearInFlight(key);
            setShareError(extractShareErrorMessage(error));
          },
        },
      );
    },
    [
      addInFlight,
      canManage,
      clearInFlight,
      options.resourceId,
      options.resourceType,
      queryClient,
      shareQueryKey,
      sharesQuery,
      unshare,
    ],
  );

  return {
    open,
    handleOpenChange,
    activeShareTab,
    handleShareTabChange,
    inviteEmail,
    setInviteEmail: setInviteEmailValue,
    sharesQuery,
    visibilityOverride,
    handleVisibilityChange,
    visibilityTransition,
    data,
    policy,
    visibility,
    triggerVisibility,
    canManage,
    role,
    setRole,
    notifyPeople,
    shareMessage,
    setShareMessage,
    messageOpen,
    setMessageOpen,
    setNotifyPeople,
    shareError,
    setShareError,
    suggestionsOpen,
    setSuggestionsOpen,
    inFlight,
    memberSearch,
    memberSuggestions,
    knownMembers,
    shares,
    handleVisibility,
    handleHideInSearch,
    handleAdd,
    handleChangeRole,
    handleRemove,
    groupSuggestions,
    selectedGroup,
    selectGroup,
  };
}

function keyOf(share: ShareButtonShare): string {
  return `${share.principalType}:${share.principalId}`;
}

function getNotificationUrl(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (typeof window === "undefined") return undefined;
  return window.location.href;
}
