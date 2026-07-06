import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  IconBuilding,
  IconCheck,
  IconCopy,
  IconLock,
  IconTrash,
  IconWorld,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared types + constants
// ---------------------------------------------------------------------------

export type Visibility = "private" | "org" | "public";
export type Role = "viewer" | "editor" | "admin";

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
    Icon: IconBuilding,
  },
  public: {
    Icon: IconWorld,
  },
};

export const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Admin" },
];

export function copyToClipboard(value: string): void {
  navigator.clipboard.writeText(value).catch(() => {});
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
// Header (title + owner)
// ---------------------------------------------------------------------------

export function ShareCardHeader({
  title,
  ownerEmail,
  reserveCloseButton = false,
}: {
  title: string;
  ownerEmail?: string | null;
  reserveCloseButton?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "min-w-0 border-b border-border px-4 pb-3 pt-3",
        reserveCloseButton && "pe-12",
      )}
    >
      <div className="min-w-0 truncate text-sm font-semibold" title={title}>
        {title}
      </div>
      {ownerEmail ? (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {t("shareUi.owner", { email: ownerEmail })}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// General-access (visibility) selector
// ---------------------------------------------------------------------------

export function GeneralAccessSelect({
  visibility,
  canManage,
  isPending,
  onChange,
  publicDescription,
}: {
  visibility: Visibility;
  canManage: boolean;
  isPending: boolean;
  onChange: (next: Visibility) => void;
  /** Override for the "public" visibility description (e.g. Clips comment hint). */
  publicDescription?: string;
}) {
  const t = useT();
  const meta = VIS_META[visibility];
  const description =
    visibility === "public" && publicDescription
      ? publicDescription
      : t(`shareUi.visibility.${visibility}.description`);

  return (
    <div>
      <div className="mb-2 text-xs font-semibold">
        {t("shareUi.generalAccess")}
      </div>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <meta.Icon size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <Select
            value={visibility}
            onValueChange={(v) => onChange(v as Visibility)}
            disabled={!canManage || isPending}
          >
            <SelectTrigger className="h-8 border-0 -ms-2 bg-transparent px-2 shadow-none focus:ring-0 [&>span]:text-start">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(VIS_META) as Visibility[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`shareUi.visibility.${k}.label`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Make public and copy" card (shown for private/org links the user manages)
// ---------------------------------------------------------------------------

export function MakePublicCard({
  isPending,
  onMakePublic,
}: {
  isPending: boolean;
  onMakePublic: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">
        {t("shareUi.restrictedLinkDescription")}
      </p>
      <Button
        type="button"
        size="sm"
        className="mt-2 h-7"
        onClick={onMakePublic}
        disabled={isPending}
      >
        {isPending ? t("shareUi.makingPublic") : t("shareUi.makePublicAndCopy")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy-to-clipboard field
// ---------------------------------------------------------------------------

export function CopyField({
  label,
  value,
  disabled,
}: {
  label: string;
  value: string;
  disabled?: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (disabled) return;
    copyToClipboard(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div>
      {label ? (
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {label}
        </div>
      ) : null}
      <div className="flex items-stretch gap-2">
        <Input
          readOnly
          value={value}
          className="flex-1 h-9 font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label={t("shareUi.copy")}
          disabled={disabled}
          className="h-9 w-9"
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatar chip
// ---------------------------------------------------------------------------

export function Avatar({ label, org }: { label: string; org?: boolean }) {
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

// ---------------------------------------------------------------------------
// Invite tab — invite-by-email + shares list
// ---------------------------------------------------------------------------

export function SharePeopleTab({
  resourceType,
  resourceId,
  resourceUrl,
  sharesQuery,
  canManage,
  onError,
}: {
  resourceType: string;
  resourceId: string;
  /** Optional notification deep-link passed to `share-resource`. */
  resourceUrl?: string;
  sharesQuery: SharesQuery;
  canManage: boolean;
  onError?: (err: unknown, action: "invite" | "remove") => void;
}) {
  const t = useT();
  const share = useActionMutation("share-resource");
  const unshare = useActionMutation("unshare-resource");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [notifyPeople, setNotifyPeople] = useState(true);
  const hasInviteEmail = email.trim().length > 0;

  const data = sharesQuery.data;
  const shares = data?.shares ?? [];

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
        onError: (err: unknown) => onError?.(err, "invite"),
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
    <div className="space-y-3">
      {canManage ? (
        <div className="space-y-2">
          <div className="flex items-stretch gap-2">
            <Input
              type="email"
              placeholder={t("shareUi.addPeopleByEmail")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              autoComplete="off"
              className="flex-1 h-9"
            />
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger className="h-9 w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(`shareUi.roles.${opt.value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
      ) : null}

      <div>
        <div className="mb-2 text-xs font-semibold">
          {t("shareUi.peopleWithAccess")}
        </div>
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto p-0 m-0">
          {data?.ownerEmail ? (
            <li className="flex items-center gap-3 px-1 py-1.5 text-sm">
              <Avatar label={data.ownerEmail} />
              <span className="flex-1 min-w-0 truncate">{data.ownerEmail}</span>
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
              <span className="flex-1 min-w-0 truncate">{s.principalId}</span>
              <span className="text-xs text-muted-foreground">
                {t(`shareUi.roles.${s.role}`)}
              </span>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("shareUi.remove")}
                  onClick={() => handleRemove(s)}
                  className="h-7 w-7"
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
      </div>
    </div>
  );
}
