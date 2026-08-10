import { useCallback, useEffect, useRef, useState } from "react";

import type { useActionQuery } from "../use-action.js";
import {
  DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS,
  DEFAULT_MEMBER_SUGGESTION_LIMIT,
  extractShareErrorMessage,
  optimisticallyUpdateShareCache,
  rollbackShareCache,
  useShareOrgMemberSearch,
  useShareMutationGuard,
  useShareMutations,
  useShareQuery,
} from "./share-controller-helpers.js";

export type ShareButtonVisibility = "private" | "org" | "public";
export type ShareButtonRole = "viewer" | "editor" | "admin";

export interface ShareButtonShare {
  id: string;
  principalType: "user" | "org";
  principalId: string;
  displayName?: string | null;
  role: ShareButtonRole;
}

export interface ShareButtonSharesResponse {
  ownerEmail: string | null;
  orgId: string | null;
  visibility: ShareButtonVisibility | null;
  role?: "owner" | ShareButtonRole;
  shares: ShareButtonShare[];
  policy?: {
    allowPublic: boolean;
    requireOrgMemberForUserShares: boolean;
  };
}

export interface ShareButtonOrgMember {
  email: string;
  name?: string | null;
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
  shareTabs?: {
    defaultValue?: string;
    onValueChange?: (value: string) => void;
  };
  shareUrl?: string;
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
  handleVisibilityChange: (visibility: ShareButtonVisibility) => Promise<void>;
  data: ShareButtonSharesResponse | undefined;
  policy: {
    allowPublic: boolean;
    requireOrgMemberForUserShares: boolean;
  };
  visibility: ShareButtonVisibility;
  triggerVisibility: ShareButtonVisibility | null;
  canManage: boolean;
  role: ShareButtonRole;
  setRole: (role: ShareButtonRole) => void;
  notifyPeople: boolean;
  setNotifyPeople: (notify: boolean) => void;
  shareError: string | null;
  setShareError: (error: string | null) => void;
  suggestionsOpen: boolean;
  setSuggestionsOpen: (open: boolean) => void;
  inFlight: Set<string>;
  memberSearch: ShareButtonOrgMemberSearch;
  memberSuggestions: ShareButtonOrgMember[];
  knownMembers: ShareButtonOrgMember[];
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
  const shareTabDefaultValue = options.shareTabs?.defaultValue ?? "share";
  const [activeShareTab, setActiveShareTab] = useState(shareTabDefaultValue);
  const [visibilityOverride, setVisibilityOverride] =
    useState<ShareButtonVisibility | null>(null);
  const appliedDefaultOpenRef = useRef(false);
  const {
    queryKey: shareQueryKey,
    query: sharesQuery,
    queryClient,
  } = useShareQuery<ShareButtonSharesResponse>(
    options.resourceType,
    options.resourceId,
  );
  const { setVisibility, share, unshare } = useShareMutations();
  const visibilityGuard = useShareMutationGuard();
  const data = sharesQuery.data;
  const canManage = data?.role === "owner" || data?.role === "admin";
  const [shareError, setShareError] = useState<string | null>(null);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      options.onOpenChange?.(nextOpen);
      if (nextOpen) {
        setActiveShareTab(shareTabDefaultValue);
        options.shareTabs?.onValueChange?.(shareTabDefaultValue);
        if (visibilityOverride === null) sharesQuery.refetch();
      }
    },
    [options, shareTabDefaultValue, sharesQuery, visibilityOverride],
  );

  useEffect(() => {
    setInviteEmail("");
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

  const handleVisibilityChange = useCallback(
    (next: ShareButtonVisibility): Promise<void> => {
      if (!canManage) {
        setShareError("Only owners and admins can change access.");
        return Promise.resolve();
      }
      const requestId = visibilityGuard.begin();
      const previous =
        optimisticallyUpdateShareCache<ShareButtonSharesResponse>(
          queryClient,
          shareQueryKey,
          (prev) => (prev ? { ...prev, visibility: next } : prev),
        );
      setVisibilityOverride(next);
      return new Promise((resolve, reject) => {
        setVisibility.mutate(
          {
            resourceType: options.resourceType,
            resourceId: options.resourceId,
            visibility: next,
          } as never,
          {
            onSuccess: (result: unknown) => {
              if (visibilityGuard.isLatest(requestId)) {
                const resultVisibility =
                  typeof result === "object" &&
                  result !== null &&
                  "visibility" in result &&
                  (result as { visibility?: unknown }).visibility;
                optimisticallyUpdateShareCache<ShareButtonSharesResponse>(
                  queryClient,
                  shareQueryKey,
                  (prev) =>
                    prev
                      ? {
                          ...prev,
                          visibility:
                            (resultVisibility as
                              | ShareButtonVisibility
                              | undefined) ?? next,
                        }
                      : prev,
                );
              }
              sharesQuery
                .refetch()
                .then(() => resolve())
                .catch(reject)
                .finally(() => {
                  if (visibilityGuard.isLatest(requestId)) {
                    setVisibilityOverride(null);
                  }
                });
            },
            onError: (error) => {
              if (visibilityGuard.isLatest(requestId)) {
                setVisibilityOverride(null);
                rollbackShareCache(queryClient, shareQueryKey, previous);
              }
              reject(error);
            },
          },
        );
      });
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
    ],
  );

  const policy = data?.policy ?? {
    allowPublic: true,
    requireOrgMemberForUserShares: false,
  };
  const visibility =
    visibilityOverride ?? data?.visibility ?? ("private" as const);
  const triggerVisibility =
    visibilityOverride ?? (data ? (data.visibility ?? "private") : null);
  // Keep draft and optimistic state in the controller so closing and reopening
  // the popover cannot drop an in-flight mutation or an unsent invite.
  const [role, setRole] = useState<ShareButtonRole>("viewer");
  const [notifyPeople, setNotifyPeople] = useState(true);
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

  useEffect(() => {
    sharesQuery.refetch();
    // The resource identity is intentionally stable for this controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const memberSearch = useShareOrgMemberSearch(
    inviteEmail,
    canManage && suggestionsOpen,
    {
      limit: DEFAULT_MEMBER_SUGGESTION_LIMIT,
      debounceMs: DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS,
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
  const knownMembers = memberSearch.members;

  const handleVisibility = useCallback(
    (next: ShareButtonVisibility) => {
      if (next === visibility) return;
      if (!canManage) {
        setShareError("Only owners and admins can change access.");
        return;
      }
      setShareError(null);
      void handleVisibilityChange(next).catch((error) => {
        setShareError(extractShareErrorMessage(error));
      });
    },
    [canManage, handleVisibilityChange, visibility],
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
    const optimistic: ShareButtonShare = {
      id: `pending-${trimmed}`,
      principalType: "user",
      principalId: trimmed,
      role,
    };
    const key = keyOf(optimistic);
    if (inFlightRef.current.has(key)) return;
    setShareError(null);
    setPendingAdds((previous) => [...previous, optimistic]);
    setInviteEmail("");
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
        principalType: "user",
        principalId: trimmed,
        role,
        notify: notifyPeople,
        resourceUrl: getNotificationUrl(options.shareUrl),
      } as never,
      {
        onSuccess: () => {
          sharesQuery.refetch().then(() => {
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
          setShareError(extractShareErrorMessage(error));
        },
      },
    );
  }, [
    addInFlight,
    canManage,
    clearInFlight,
    inFlight,
    inviteEmail,
    notifyPeople,
    options.resourceId,
    options.resourceType,
    options.shareUrl,
    role,
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
            sharesQuery.refetch().then(() => {
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
      inFlight,
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
            sharesQuery.refetch().then(() => {
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
      inFlight,
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
    setInviteEmail,
    sharesQuery,
    visibilityOverride,
    handleVisibilityChange,
    data,
    policy,
    visibility,
    triggerVisibility,
    canManage,
    role,
    setRole,
    notifyPeople,
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
