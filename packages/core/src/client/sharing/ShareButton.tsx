import { useEffect, useState } from "react";
import {
  IconShare,
  IconLock,
  IconBuilding,
  IconWorld,
  IconTrash,
  IconChevronDown,
} from "@tabler/icons-react";
import * as Popover from "@radix-ui/react-popover";
import { useActionQuery, useActionMutation } from "../use-action.js";
import { cn } from "../utils.js";

export interface ShareButtonProps {
  resourceType: string;
  resourceId: string;
  resourceTitle?: string;
  /** "compact" reflects the current visibility in the trigger label;
   *  "label" always says "Share". */
  variant?: "compact" | "label";
}

type Visibility = "private" | "org" | "public";
type Role = "viewer" | "editor" | "admin";

interface Share {
  id: string;
  principalType: "user" | "org";
  principalId: string;
  role: Role;
}

interface SharesResponse {
  ownerEmail: string | null;
  orgId: string | null;
  visibility: Visibility | null;
  role?: "owner" | Role;
  shares: Share[];
}

// Match the exact Tailwind classes emitted by shadcn's `<Button size="sm"
// variant="outline">`. Templates vendor their own Button component, but
// every template uses the same shadcn theme + preset, so the same class
// string renders identically. Keeping them as literal strings here means
// this component looks native in every template without importing from
// the template itself (which wouldn't be possible from core).
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";
const BUTTON_OUTLINE_SM = cn(
  BUTTON_BASE,
  "h-9 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground",
);
const BUTTON_PRIMARY_SM = cn(
  BUTTON_BASE,
  "h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90",
);
const BUTTON_GHOST_ICON = cn(
  BUTTON_BASE,
  "h-7 w-7 p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
);
const BUTTON_GHOST_INLINE = cn(
  BUTTON_BASE,
  "h-7 px-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
);

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
    description: "Anyone signed in with the link can view",
    Icon: IconWorld,
  },
};

/**
 * Framework share control. Renders a shadcn-outline-styled trigger that
 * opens a Google-Docs-style popover anchored beneath it. Uses CSS
 * variables and Tailwind classes that every shadcn template already
 * ships, so the same component renders natively in light and dark mode.
 */
export function ShareButton(props: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType: props.resourceType,
    resourceId: props.resourceId,
  });

  const serverVisibility =
    (sharesQuery.data?.visibility as Visibility | null) ?? "private";
  const TriggerIcon =
    serverVisibility === "public"
      ? IconWorld
      : serverVisibility === "org"
        ? IconBuilding
        : props.variant === "compact"
          ? IconLock
          : IconShare;
  const triggerLabel =
    props.variant === "compact" ? VIS_META[serverVisibility].label : "Share";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={BUTTON_OUTLINE_SM}>
          <TriggerIcon size={16} strokeWidth={1.75} />
          <span>{triggerLabel}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-[2000] w-[min(460px,92vw)] rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SharePanel
            {...props}
            sharesQuery={sharesQuery}
            onClose={() => setOpen(false)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface OrgMember {
  email: string;
  name?: string | null;
}

function useOrgMembers(): OrgMember[] {
  const [members, setMembers] = useState<OrgMember[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/_agent-native/org/members")
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

function SharePanel(
  props: ShareButtonProps & {
    sharesQuery: ReturnType<typeof useActionQuery<SharesResponse>>;
    onClose: () => void;
  },
) {
  const { resourceType, resourceId, resourceTitle, sharesQuery, onClose } =
    props;

  const setVisibility = useActionMutation("set-resource-visibility");
  const share = useActionMutation("share-resource");
  const unshare = useActionMutation("unshare-resource");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const orgMembers = useOrgMembers();
  const datalistId = `share-autocomplete-${resourceType}-${resourceId}`;

  // Optimistic overlays so clicks feel instant.
  const [visibilityOverride, setVisibilityOverride] =
    useState<Visibility | null>(null);
  const [pendingAdds, setPendingAdds] = useState<Share[]>([]);
  const [pendingRemoves, setPendingRemoves] = useState<Set<string>>(new Set());

  useEffect(() => {
    sharesQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = sharesQuery.data;
  const serverVisibility = (data?.visibility as Visibility | null) ?? "private";
  const visibility: Visibility = visibilityOverride ?? serverVisibility;
  const canManage =
    data?.role === "owner" || data?.role === "admin" || !data?.role;
  const meta = VIS_META[visibility];

  const serverShares = data?.shares ?? [];
  const shares: Share[] = [
    ...serverShares.filter((s) => !pendingRemoves.has(keyOf(s))),
    ...pendingAdds,
  ];

  const handleVisibility = (next: Visibility) => {
    if (next === visibility) return;
    setVisibilityOverride(next);
    setVisibility.mutate(
      { resourceType, resourceId, visibility: next } as any,
      {
        onSuccess: () => {
          sharesQuery.refetch().then(() => setVisibilityOverride(null));
        },
        onError: () => setVisibilityOverride(null),
      },
    );
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
    setPendingAdds((p) => [...p, optimistic]);
    setEmail("");
    share.mutate(
      {
        resourceType,
        resourceId,
        principalType: "user",
        principalId: trimmed,
        role,
      } as any,
      {
        onSuccess: () => {
          sharesQuery.refetch().then(() => {
            setPendingAdds((p) => p.filter((s) => s.id !== optimistic.id));
          });
        },
        onError: () => {
          setPendingAdds((p) => p.filter((s) => s.id !== optimistic.id));
        },
      },
    );
  };

  const handleRemove = (s: Share) => {
    const k = keyOf(s);
    setPendingRemoves((prev) => new Set(prev).add(k));
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
          });
        },
        onError: () => {
          setPendingRemoves((prev) => {
            const next = new Set(prev);
            next.delete(k);
            return next;
          });
        },
      },
    );
  };

  const titleText = resourceTitle
    ? `Share "${resourceTitle}"`
    : `Share ${resourceType}`;

  return (
    <div>
      <div className="mb-3 truncate text-base font-semibold" title={titleText}>
        {titleText}
      </div>

      {canManage ? (
        <div className="mb-4 flex items-stretch gap-2">
          <input
            type="email"
            placeholder="Add people by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            list={orgMembers.length > 0 ? datalistId : undefined}
            autoComplete="off"
            className="flex-1 min-w-0 h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
          />
          {orgMembers.length > 0 ? (
            <datalist id={datalistId}>
              {orgMembers
                .filter(
                  (m) =>
                    m.email !== sharesQuery.data?.ownerEmail &&
                    !(sharesQuery.data?.shares ?? []).some(
                      (s) =>
                        s.principalType === "user" && s.principalId === m.email,
                    ),
                )
                .map((m) => (
                  <option
                    key={m.email}
                    value={m.email}
                    label={m.name ?? undefined}
                  />
                ))}
            </datalist>
          ) : null}
          <ChevronSelect
            value={role}
            onChange={(v) => setRole(v as Role)}
            options={[
              { value: "viewer", label: "Viewer" },
              { value: "editor", label: "Editor" },
              { value: "admin", label: "Admin" },
            ]}
          />
        </div>
      ) : null}

      <div className="mb-2 text-sm font-semibold">People with access</div>
      <ul className="mb-4 flex flex-col gap-1 list-none p-0 m-0">
        {data?.ownerEmail ? (
          <li className="flex items-center gap-3 px-1 py-1.5 text-sm">
            <Avatar label={data.ownerEmail} />
            <span className="flex-1 min-w-0 truncate">{data.ownerEmail}</span>
            <span className="text-xs text-muted-foreground">Owner</span>
          </li>
        ) : null}
        {shares.map((s) => (
          <li
            key={keyOf(s)}
            className="flex items-center gap-3 px-1 py-1.5 text-sm"
          >
            <Avatar label={s.principalId} org={s.principalType === "org"} />
            <span className="flex-1 min-w-0 truncate">{s.principalId}</span>
            <span className="text-xs text-muted-foreground">{cap(s.role)}</span>
            {canManage ? (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => handleRemove(s)}
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

      <div className="mb-2 text-sm font-semibold">General access</div>
      <div className="mb-4 flex items-center gap-3">
        <span
          aria-hidden
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <meta.Icon size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <ChevronSelect
            value={visibility}
            onChange={(v) => handleVisibility(v as Visibility)}
            disabled={!canManage}
            plain
            options={[
              { value: "private", label: VIS_META.private.label },
              { value: "org", label: VIS_META.org.label },
              { value: "public", label: VIS_META.public.label },
            ]}
          />
          <div className="mt-0.5 text-xs text-muted-foreground">
            {meta.description}
          </div>
        </div>
      </div>

      <div className="mt-2 flex justify-end">
        <button type="button" onClick={onClose} className={BUTTON_PRIMARY_SM}>
          Done
        </button>
      </div>
    </div>
  );
}

function Avatar({ label, org }: { label: string; org?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
    >
      {org ? "🏢" : initials(label)}
    </span>
  );
}

function ChevronSelect(props: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  /** When true, render as inline text (no border/background) — matches
   *  Google Docs' "General access" presentation. */
  plain?: boolean;
}) {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        className={
          props.plain
            ? "appearance-none bg-transparent border-0 pr-6 pl-0 text-sm font-medium text-foreground cursor-pointer focus:outline-none disabled:opacity-60"
            : "appearance-none h-9 rounded-md border border-input bg-background pl-3 pr-7 text-sm text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        }
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <IconChevronDown
        size={14}
        className="pointer-events-none absolute right-1.5 text-muted-foreground"
      />
    </div>
  );
}

function keyOf(s: Share): string {
  return `${s.principalType}:${s.principalId}`;
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function initials(s: string): string {
  const name = s.split("@")[0] ?? s;
  return (name[0] ?? "?").toUpperCase();
}
