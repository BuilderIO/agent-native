import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { agentNativePath } from "../api-path.js";
import { useActionMutation, useActionQuery } from "../use-action.js";

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
  handleDone: () => void;
}

const MEMBER_SUGGESTION_LIMIT = 25;
const MEMBER_SEARCH_DEBOUNCE_MS = 140;

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
  const visibilityRequestId = useRef(0);
  const queryClient = useQueryClient();
  const shareQueryParams = useMemo(
    () => ({
      resourceType: options.resourceType,
      resourceId: options.resourceId,
    }),
    [options.resourceId, options.resourceType],
  );
  const shareQueryKey = useMemo(
    () => ["action", "list-resource-shares", shareQueryParams] as const,
    [shareQueryParams],
  );
  const setVisibility = useActionMutation("set-resource-visibility");
  const sharesQuery = useActionQuery<ShareButtonSharesResponse>(
    "list-resource-shares",
    shareQueryParams,
  );
  const share = useActionMutation("share-resource");
  const unshare = useActionMutation("unshare-resource");

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

  const updateCachedVisibility = useCallback(
    (visibility: ShareButtonVisibility) => {
      queryClient.setQueryData<ShareButtonSharesResponse>(
        shareQueryKey,
        (prev) => (prev ? { ...prev, visibility } : prev),
      );
    },
    [queryClient, shareQueryKey],
  );

  const handleVisibilityChange = useCallback(
    (next: ShareButtonVisibility): Promise<void> => {
      const requestId = ++visibilityRequestId.current;
      const previous =
        queryClient.getQueryData<ShareButtonSharesResponse>(shareQueryKey);
      setVisibilityOverride(next);
      updateCachedVisibility(next);
      return new Promise((resolve, reject) => {
        setVisibility.mutate(
          {
            resourceType: options.resourceType,
            resourceId: options.resourceId,
            visibility: next,
          } as never,
          {
            onSuccess: (result: unknown) => {
              if (requestId === visibilityRequestId.current) {
                const resultVisibility =
                  typeof result === "object" &&
                  result !== null &&
                  "visibility" in result &&
                  (result as { visibility?: unknown }).visibility;
                updateCachedVisibility(
                  (resultVisibility as ShareButtonVisibility | undefined) ??
                    next,
                );
              }
              sharesQuery
                .refetch()
                .then(() => resolve())
                .catch(reject)
                .finally(() => {
                  if (requestId === visibilityRequestId.current) {
                    setVisibilityOverride(null);
                  }
                });
            },
            onError: (error) => {
              if (requestId === visibilityRequestId.current) {
                setVisibilityOverride(null);
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
    },
    [
      options.resourceId,
      options.resourceType,
      queryClient,
      setVisibility,
      shareQueryKey,
      sharesQuery,
      updateCachedVisibility,
    ],
  );

  const data = sharesQuery.data;
  const policy = data?.policy ?? {
    allowPublic: true,
    requireOrgMemberForUserShares: false,
  };
  const visibility =
    visibilityOverride ?? data?.visibility ?? ("private" as const);
  const triggerVisibility =
    visibilityOverride ?? (data ? (data.visibility ?? "private") : null);
  const canManage = data?.role === "owner" || data?.role === "admin";
  const [role, setRole] = useState<ShareButtonRole>("viewer");
  const [notifyPeople, setNotifyPeople] = useState(true);
  const [shareError, setShareError] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [pendingAdds, setPendingAdds] = useState<ShareButtonShare[]>([]);
  const [pendingRemoves, setPendingRemoves] = useState<Set<string>>(new Set());
  const [roleOverrides, setRoleOverrides] = useState<
    Record<string, ShareButtonRole>
  >({});
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());

  const addInFlight = useCallback(
    (key: string) => setInFlight((prev) => new Set(prev).add(key)),
    [],
  );
  const clearInFlight = useCallback(
    (key: string) =>
      setInFlight((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      }),
    [],
  );

  useEffect(() => {
    sharesQuery.refetch();
    // The resource identity is intentionally stable for this controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const memberSearch = useOrgMemberSearch(
    inviteEmail,
    canManage && suggestionsOpen,
  );
  const serverShares = data?.shares ?? [];
  const shares: ShareButtonShare[] = [
    ...serverShares
      .filter((share) => !pendingRemoves.has(keyOf(share)))
      .map((share) => ({
        ...share,
        role: roleOverrides[keyOf(share)] ?? share.role,
      })),
    ...pendingAdds,
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
    if (inFlight.has(key)) return;
    setShareError(null);
    setPendingAdds((previous) => [...previous, optimistic]);
    setInviteEmail("");
    setSuggestionsOpen(false);
    addInFlight(key);
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
    sharesQuery,
  ]);

  const handleChangeRole = useCallback(
    (currentShare: ShareButtonShare, next: ShareButtonRole) => {
      if (currentShare.role === next) return;
      const key = keyOf(currentShare);
      if (inFlight.has(key)) return;
      setRoleOverrides((previous) => ({ ...previous, [key]: next }));
      addInFlight(key);
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
          onError: () => {
            setRoleOverrides((previous) => {
              const { [key]: _removed, ...rest } = previous;
              return rest;
            });
            clearInFlight(key);
          },
        },
      );
    },
    [
      addInFlight,
      clearInFlight,
      inFlight,
      options.resourceId,
      options.resourceType,
      share,
      sharesQuery,
    ],
  );

  const handleRemove = useCallback(
    (currentShare: ShareButtonShare) => {
      const key = keyOf(currentShare);
      if (inFlight.has(key)) return;
      setPendingRemoves((previous) => new Set(previous).add(key));
      addInFlight(key);
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
          onError: () => {
            setPendingRemoves((previous) => {
              const next = new Set(previous);
              next.delete(key);
              return next;
            });
            clearInFlight(key);
          },
        },
      );
    },
    [
      addInFlight,
      clearInFlight,
      inFlight,
      options.resourceId,
      options.resourceType,
      sharesQuery,
      unshare,
    ],
  );

  const handleDone = useCallback(() => {
    if (canManage && inviteEmail.trim()) handleAdd();
    handleOpenChange(false);
  }, [canManage, handleAdd, handleOpenChange, inviteEmail]);

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
    handleDone,
  };
}

function useOrgMemberSearch(
  query: string,
  enabled: boolean,
): ShareButtonOrgMemberSearch {
  const search = query.trim();
  const [members, setMembers] = useState<ShareButtonOrgMember[]>([]);
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
          return response.json() as Promise<{
            members?: unknown[];
            hasMore?: boolean;
            nextOffset?: number | null;
          }>;
        })
        .then((result) => {
          if (controller.signal.aborted || requestId !== requestIdRef.current)
            return;
          const nextMembers = normalizeMembers(result?.members);
          setMembers((previous) =>
            append ? mergeMembers(previous, nextMembers) : nextMembers,
          );
          setHasMore(result?.hasMore === true);
          setNextOffset(
            typeof result?.nextOffset === "number" ? result.nextOffset : null,
          );
        })
        .catch(() => {
          if (controller.signal.aborted || requestId !== requestIdRef.current)
            return;
          setError(true);
          setHasMore(false);
          setNextOffset(null);
          if (!append) setMembers([]);
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

function normalizeMembers(value: unknown): ShareButtonOrgMember[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((member: any) => ({
      email: typeof member?.email === "string" ? member.email : "",
      name: typeof member?.name === "string" ? member.name : null,
      role: typeof member?.role === "string" ? member.role : null,
      joinedAt:
        typeof member?.joinedAt === "number"
          ? member.joinedAt
          : typeof member?.joined_at === "number"
            ? member.joined_at
            : null,
    }))
    .filter((member) => member.email);
}

function mergeMembers(
  existing: ShareButtonOrgMember[],
  next: ShareButtonOrgMember[],
): ShareButtonOrgMember[] {
  const seen = new Set(existing.map((member) => member.email.toLowerCase()));
  const merged = [...existing];
  for (const member of next) {
    const key = member.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(member);
  }
  return merged;
}

function keyOf(share: ShareButtonShare): string {
  return `${share.principalType}:${share.principalId}`;
}

function getNotificationUrl(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (typeof window === "undefined") return undefined;
  return window.location.href;
}

function extractShareErrorMessage(error: unknown): string {
  const fallback = "Could not update sharing — please try again.";
  if (!error) return fallback;
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null
          ? ((error as { error?: unknown; message?: unknown }).error ??
            (error as { message?: unknown }).message)
          : null;
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  if (raw.trim().toLowerCase() === "failed to fetch") return fallback;
  return raw.replace(/^Action\s+[\w-]+\s+failed:\s*/i, "") || fallback;
}
