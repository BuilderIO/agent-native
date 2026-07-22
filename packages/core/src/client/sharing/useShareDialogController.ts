import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { agentNativePath } from "../api-path.js";
import { writeClipboardText } from "../clipboard.js";
import { useT } from "../i18n.js";
import { useActionMutation, useActionQuery } from "../use-action.js";

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
  policy?: { allowPublic: boolean };
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

interface OrgMember {
  email: string;
  name?: string | null;
}

function useOrgMembers(): OrgMember[] {
  const [members, setMembers] = useState<OrgMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(agentNativePath("/_agent-native/org/members"))
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list: unknown[] = Array.isArray(data?.members)
          ? data.members
          : [];
        setMembers(
          list
            .map((member: unknown) => normalizeOrgMember(member))
            .filter((member): member is OrgMember => member !== null),
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return members;
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
  const sharesQuery = useActionQuery<ResourceSharesResponse>(
    "list-resource-shares",
    { resourceType, resourceId },
  );
  const shareMutation = useActionMutation("share-resource");
  const unshareMutation = useActionMutation("unshare-resource");
  const visibilityMutation = useActionMutation("set-resource-visibility");
  const orgMembers = useOrgMembers();
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
  const visibility = data?.visibility ?? "private";
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
      visibilityMutation.mutate(
        { resourceType, resourceId, visibility: next } as never,
        { onSuccess: refetch },
      );
    },
    [
      canManage,
      refetch,
      resourceId,
      resourceType,
      visibility,
      visibilityMutation,
    ],
  );
  const submitInvite = useCallback(() => {
    const principalId = email.trim();
    if (!canManage || !principalId) return;
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
          refetch();
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
    shareMutation,
    shareUrl,
  ]);
  const removeShare = useCallback(
    (share: ResourceShare) => {
      if (!canManage) return;
      unshareMutation.mutate(
        {
          resourceType,
          resourceId,
          principalType: share.principalType,
          principalId: share.principalId,
        } as never,
        { onSuccess: refetch },
      );
    },
    [canManage, refetch, resourceId, resourceType, unshareMutation],
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
    error: sharesQuery.error,
    refetch,
    canManage,
  };
}

function normalizeOrgMember(value: unknown): OrgMember | null {
  if (!value || typeof value !== "object") return null;
  const member = value as { email?: unknown; name?: unknown };
  if (typeof member.email !== "string" || !member.email) return null;
  return {
    email: member.email,
    name: typeof member.name === "string" ? member.name : null,
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
  members: OrgMember[],
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

function displayName(email: string, members: OrgMember[]): string {
  const normalized = email.trim().toLowerCase();
  const match = members.find(
    (member) => member.email.toLowerCase() === normalized,
  );
  if (match?.name?.trim()) return match.name;
  return normalized.includes("@") ? email : "Unknown person";
}

function principalLabel(share: ResourceShare, members: OrgMember[]): string {
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
