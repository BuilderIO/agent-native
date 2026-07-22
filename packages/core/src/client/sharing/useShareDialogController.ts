import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { writeClipboardText } from "../clipboard.js";
import { useT } from "../i18n.js";
import {
  extractShareErrorMessage,
  optimisticallyUpdateShareCache,
  rollbackShareCache,
  useShareMutationGuard,
  useShareMutations,
  useShareOrgMemberSearch,
  useShareQuery,
} from "./share-controller-helpers.js";
import type { ShareOrgMember } from "./share-controller-helpers.js";

export type ShareVisibility = "private" | "org" | "public";
export type ShareRole = "viewer" | "editor" | "admin";
export type ShareDialogTab = "link" | "invite" | "embed";

export interface ResourceShare {
  id: string;
  principalType: "user" | "org";
  principalId: string;
  displayName?: string | null;
  role: ShareRole;
}

export interface ResourceSharesResponse {
  ownerEmail: string | null;
  orgId: string | null;
  visibility: ShareVisibility | null;
  role?: "owner" | ShareRole;
  shares: ResourceShare[];
  policy?: { allowPublic: boolean; requireOrgMemberForUserShares?: boolean };
}

export interface ShareDialogControllerOptions {
  open: boolean;
  onClose: () => void;
  resourceType: string;
  resourceId: string;
  resourceTitle?: string;
  shareUrl?: string;
  embedUrl?: string;
}

export interface ShareOption<TValue extends string> {
  value: TValue;
  label: string;
  description: string;
}

export interface ShareDialogPerson {
  key: string;
  label: string;
  roleLabel: string;
  principalType: "owner" | "user" | "org";
  avatarText: string | null;
  share: ResourceShare | null;
}

export interface ShareDialogController {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  close: () => void;
  title: string;
  ownerLabel: string | null;
  activeTab: ShareDialogTab;
  setActiveTab: (tab: ShareDialogTab) => void;
  tabsEnabled: boolean;
  tabs: Array<{ value: ShareDialogTab; label: string }>;
  labels: {
    close: string;
    done: string;
    shareOptions: string;
    generalAccess: string;
    shareLink: string;
    peopleWithAccess: string;
    addPeopleByEmail: string;
    notifyPeople: string;
    role: string;
    remove: string;
    noAccess: string;
    copy: string;
    embedUrl: string;
    embedCode: string;
  };
  visibility: {
    value: ShareVisibility;
    label: string;
    description: string;
    options: Array<ShareOption<ShareVisibility>>;
    disabled: boolean;
    pending: boolean;
    set: (visibility: ShareVisibility) => void;
  };
  invite: {
    email: string;
    setEmail: (email: string) => void;
    role: ShareRole;
    setRole: (role: ShareRole) => void;
    roleOptions: Array<ShareOption<ShareRole>>;
    notifyPeople: boolean;
    setNotifyPeople: (notify: boolean) => void;
    showNotifyPeople: boolean;
    disabled: boolean;
    pending: boolean;
    submit: () => void;
  };
  people: ShareDialogPerson[];
  removeShare: (share: ResourceShare) => void;
  removing: boolean;
  shareUrl?: string;
  embedUrl?: string;
  embedCode?: string;
  copiedField: string | null;
  copy: (field: string, value: string) => Promise<boolean>;
  loading: boolean;
  error: unknown;
  refetch: () => unknown;
  canManage: boolean;
}

export function useShareDialogController({
  open,
  onClose,
  resourceType,
  resourceId,
  resourceTitle,
  shareUrl,
  embedUrl,
}: ShareDialogControllerOptions): ShareDialogController {
  const t = useT();
  const {
    query: sharesQuery,
    queryKey: shareQueryKey,
    queryClient,
  } = useShareQuery<ResourceSharesResponse>(resourceType, resourceId);
  const {
    share: shareMutation,
    unshare: unshareMutation,
    setVisibility: visibilityMutation,
  } = useShareMutations();
  const memberSearch = useShareOrgMemberSearch("", true, {
    limit: undefined,
    debounceMs: 0,
  });
  const orgMembers = memberSearch.members;
  const hasLinkTab = Boolean(shareUrl);
  const hasEmbedTab = Boolean(embedUrl);
  const tabsEnabled = hasLinkTab || hasEmbedTab;
  const [activeTab, setActiveTab] = useState<ShareDialogTab>(
    hasLinkTab ? "link" : "invite",
  );
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [notifyPeople, setNotifyPeople] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [visibilityOverride, setVisibilityOverride] =
    useState<ShareVisibility | null>(null);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const visibilityGuard = useShareMutationGuard();
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) setActiveTab(hasLinkTab ? "link" : "invite");
  }, [hasLinkTab, open]);

  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const data = sharesQuery.data;
  const visibility = visibilityOverride ?? data?.visibility ?? "private";
  const canManage = data?.role === "owner" || data?.role === "admin";
  const visibilityOptions = useMemo(
    () =>
      (["private", "org", "public"] as const)
        .filter(
          (value) =>
            value !== "public" ||
            value === visibility ||
            data?.policy?.allowPublic !== false,
        )
        .map((value) => visibilityOption(value, t)),
    [data?.policy?.allowPublic, t, visibility],
  );
  const roleOptions = useMemo(
    () =>
      (["viewer", "editor", "admin"] as const).map((value) =>
        roleOption(value, t),
      ),
    [t],
  );

  const refetch = useCallback(() => sharesQuery.refetch(), [sharesQuery]);
  const setVisibility = useCallback(
    (next: ShareVisibility) => {
      if (!canManage || next === visibility) return;
      const requestId = visibilityGuard.begin();
      const previous = optimisticallyUpdateShareCache<ResourceSharesResponse>(
        queryClient,
        shareQueryKey,
        (cached) => (cached ? { ...cached, visibility: next } : cached),
      );
      setMutationError(null);
      setVisibilityOverride(next);
      visibilityMutation.mutate(
        { resourceType, resourceId, visibility: next } as never,
        {
          onSuccess: (result: unknown) => {
            if (visibilityGuard.isLatest(requestId)) {
              const resultVisibility =
                typeof result === "object" &&
                result !== null &&
                "visibility" in result &&
                (result as { visibility?: unknown }).visibility;
              optimisticallyUpdateShareCache<ResourceSharesResponse>(
                queryClient,
                shareQueryKey,
                (cached) =>
                  cached
                    ? {
                        ...cached,
                        visibility:
                          (resultVisibility as ShareVisibility | undefined) ??
                          next,
                      }
                    : cached,
              );
            }
            if (!visibilityGuard.isLatest(requestId)) return;
            Promise.resolve(refetch())
              .catch((error) => {
                if (visibilityGuard.isLatest(requestId)) {
                  setMutationError(extractShareErrorMessage(error));
                }
              })
              .finally(() => {
                if (visibilityGuard.isLatest(requestId)) {
                  setVisibilityOverride(null);
                }
              });
          },
          onError: (error: unknown) => {
            if (visibilityGuard.isLatest(requestId)) {
              rollbackShareCache(queryClient, shareQueryKey, previous);
              setVisibilityOverride(null);
              setMutationError(extractShareErrorMessage(error));
            }
          },
        },
      );
    },
    [
      canManage,
      refetch,
      resourceId,
      resourceType,
      queryClient,
      shareQueryKey,
      visibility,
      visibilityGuard,
      visibilityMutation,
    ],
  );
  const submitInvite = useCallback(() => {
    const principalId = email.trim();
    if (!canManage || !principalId) return;
    const optimistic: ResourceShare = {
      id: `pending-${principalId}`,
      principalType: "user",
      principalId,
      role,
    };
    const previous = optimisticallyUpdateShareCache<ResourceSharesResponse>(
      queryClient,
      shareQueryKey,
      (cached) =>
        cached ? { ...cached, shares: [...cached.shares, optimistic] } : cached,
    );
    setMutationError(null);
    shareMutation.mutate(
      {
        resourceType,
        resourceId,
        principalType: "user",
        principalId,
        role,
        notify: notifyPeople,
        resourceUrl: getNotificationUrl(shareUrl),
      } as never,
      {
        onSuccess: () => {
          setEmail("");
          void refetch();
        },
        onError: (error: unknown) => {
          rollbackShareCache(queryClient, shareQueryKey, previous);
          setMutationError(extractShareErrorMessage(error));
        },
      },
    );
  }, [
    canManage,
    email,
    notifyPeople,
    refetch,
    resourceId,
    resourceType,
    role,
    queryClient,
    shareQueryKey,
    shareMutation,
    shareUrl,
  ]);
  const removeShare = useCallback(
    (share: ResourceShare) => {
      if (!canManage) return;
      const previous = optimisticallyUpdateShareCache<ResourceSharesResponse>(
        queryClient,
        shareQueryKey,
        (cached) =>
          cached
            ? {
                ...cached,
                shares: cached.shares.filter(
                  (current) =>
                    !(
                      current.principalType === share.principalType &&
                      current.principalId === share.principalId
                    ),
                ),
              }
            : cached,
      );
      setMutationError(null);
      unshareMutation.mutate(
        {
          resourceType,
          resourceId,
          principalType: share.principalType,
          principalId: share.principalId,
        } as never,
        {
          onSuccess: refetch,
          onError: (error: unknown) => {
            rollbackShareCache(queryClient, shareQueryKey, previous);
            setMutationError(extractShareErrorMessage(error));
          },
        },
      );
    },
    [
      canManage,
      queryClient,
      refetch,
      resourceId,
      resourceType,
      shareQueryKey,
      unshareMutation,
    ],
  );
  const copy = useCallback(async (field: string, value: string) => {
    const copied = await writeClipboardText(value);
    if (!copied) {
      setCopiedField(null);
      return false;
    }
    setCopiedField(field);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopiedField(null), 1_400);
    return true;
  }, []);

  const currentVisibility = visibilityOption(visibility, t);
  const people = buildPeople(data, orgMembers, t);

  return {
    open,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) onClose();
    },
    close: onClose,
    title: resourceTitle
      ? t("share.titleWithResource", { title: resourceTitle })
      : t("share.titleWithType", { type: resourceType }),
    ownerLabel: data?.ownerEmail
      ? t("share.owner", {
          name: displayName(data.ownerEmail, orgMembers),
        })
      : null,
    activeTab,
    setActiveTab,
    tabsEnabled,
    tabs: [
      ...(hasLinkTab
        ? [{ value: "link" as const, label: t("share.link") }]
        : []),
      { value: "invite", label: t("share.invite") },
      ...(hasEmbedTab
        ? [{ value: "embed" as const, label: t("share.embed") }]
        : []),
    ],
    labels: {
      close: t("share.close"),
      done: t("share.done"),
      shareOptions: t("share.shareOptions"),
      generalAccess: t("share.generalAccess"),
      shareLink: t("share.shareLink"),
      peopleWithAccess: t("share.peopleWithAccess"),
      addPeopleByEmail: t("share.addPeopleByEmail"),
      notifyPeople: t("share.notifyPeople"),
      role: t("share.role"),
      remove: t("share.remove"),
      noAccess: t("share.noAccess"),
      copy: t("share.copy"),
      embedUrl: t("share.embedUrl"),
      embedCode: t("share.embedCode"),
    },
    visibility: {
      value: visibility,
      label: currentVisibility.label,
      description: currentVisibility.description,
      options: visibilityOptions,
      disabled: !canManage,
      pending: visibilityMutation.isPending,
      set: setVisibility,
    },
    invite: {
      email,
      setEmail,
      role,
      setRole,
      roleOptions,
      notifyPeople,
      setNotifyPeople,
      showNotifyPeople: email.trim().length > 0,
      disabled: !canManage || email.trim().length === 0,
      pending: shareMutation.isPending,
      submit: submitInvite,
    },
    people,
    removeShare,
    removing: unshareMutation.isPending,
    shareUrl,
    embedUrl,
    embedCode: embedUrl ? createEmbedCode(embedUrl) : undefined,
    copiedField,
    copy,
    loading: sharesQuery.isLoading,
    error: sharesQuery.error ?? mutationError,
    refetch,
    canManage,
  };
}

function visibilityOption(
  visibility: ShareVisibility,
  t: ReturnType<typeof useT>,
): ShareOption<ShareVisibility> {
  const keys = {
    private: ["share.private", "share.privateDescription"],
    org: ["share.organization", "share.organizationDescription"],
    public: ["share.public", "share.publicDescription"],
  } as const;
  return {
    value: visibility,
    label: t(keys[visibility][0]),
    description: t(keys[visibility][1]),
  };
}

function roleOption(
  role: ShareRole,
  t: ReturnType<typeof useT>,
): ShareOption<ShareRole> {
  const keys = {
    viewer: ["share.viewer", "share.viewerDescription"],
    editor: ["share.editor", "share.editorDescription"],
    admin: ["share.admin", "share.adminDescription"],
  } as const;
  return {
    value: role,
    label: t(keys[role][0]),
    description: t(keys[role][1]),
  };
}

function buildPeople(
  data: ResourceSharesResponse | undefined,
  members: ShareOrgMember[],
  t: ReturnType<typeof useT>,
): ShareDialogPerson[] {
  const people: ShareDialogPerson[] = [];
  if (data?.ownerEmail) {
    const label = displayName(data.ownerEmail, members);
    people.push({
      key: `owner:${data.ownerEmail}`,
      label,
      roleLabel: t("share.ownerRole"),
      principalType: "owner",
      avatarText: avatarText(label),
      share: null,
    });
  }
  for (const share of data?.shares ?? []) {
    const label = principalLabel(share, members);
    people.push({
      key: `${share.principalType}:${share.principalId}`,
      label,
      roleLabel: capitalize(share.role),
      principalType: share.principalType,
      avatarText: share.principalType === "org" ? null : avatarText(label),
      share,
    });
  }
  return people;
}

function displayName(email: string, members: ShareOrgMember[]): string {
  const normalized = email.trim().toLowerCase();
  const match = members.find(
    (member) => member.email.toLowerCase() === normalized,
  );
  if (match?.name?.trim()) return match.name;
  return normalized.includes("@") ? email : "Unknown person";
}

function principalLabel(
  share: ResourceShare,
  members: ShareOrgMember[],
): string {
  const serverLabel = share.displayName?.trim();
  if (serverLabel) return serverLabel;
  if (share.principalType === "org") return "Organization";
  return displayName(share.principalId, members);
}

function avatarText(label: string): string {
  return (label.split("@")[0]?.[0] ?? label[0] ?? "?").toUpperCase();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getNotificationUrl(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (typeof window === "undefined") return undefined;
  return window.location.href;
}

function createEmbedCode(embedUrl: string): string {
  return `<div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="${embedUrl}" frameborder="0" allowfullscreen allow="autoplay; picture-in-picture" style="position:absolute;inset:0;width:100%;height:100%"></iframe></div>`;
}
