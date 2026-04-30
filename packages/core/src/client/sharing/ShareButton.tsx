import { forwardRef, useEffect, useState, type ReactNode } from "react";
import {
  IconLock,
  IconBuilding,
  IconWorld,
  IconTrash,
  IconCheck,
  IconChevronDown,
} from "@tabler/icons-react";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import { useActionQuery, useActionMutation } from "../use-action.js";
import { cn } from "../utils.js";

export interface ShareButtonProps {
  resourceType: string;
  resourceId: string;
  resourceTitle?: string;
  /** @deprecated No longer affects rendering — trigger always says
   *  "Share". Kept for callsite compatibility. */
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

// Mirror shadcn's <Button size="sm" variant="outline"> class string so the
// trigger sits flush next to other sm outline buttons in the template.
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
  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType: props.resourceType,
    resourceId: props.resourceId,
  });

  // The trigger always says "Share" — the icon reflects the resource's
  // current visibility (lock / building / globe), matching Google Docs.
  // While the query is loading and we don't know the visibility yet,
  // render a skeleton placeholder in the icon slot instead of guessing.
  const loaded = sharesQuery.data !== undefined;
  const serverVisibility =
    (sharesQuery.data?.visibility as Visibility | null) ?? "private";
  const TriggerIcon =
    serverVisibility === "public"
      ? IconWorld
      : serverVisibility === "org"
        ? IconBuilding
        : IconLock;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={BUTTON_OUTLINE_SM}>
          {loaded ? (
            <TriggerIcon size={16} strokeWidth={1.75} />
          ) : (
            <span
              aria-hidden
              className="inline-block h-4 w-4 rounded-sm bg-muted animate-pulse"
            />
          )}
          <span>Share</span>
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
  const serverVisibility = (data?.visibility as Visibility | null) ?? "private";
  const visibility: Visibility = visibilityOverride ?? serverVisibility;
  const canManage =
    data === undefined || data?.role === "owner" || data?.role === "admin";
  const meta = VIS_META[visibility];

  const serverShares = data?.shares ?? [];
  const shares: Share[] = [
    ...serverShares
      .filter((s) => !pendingRemoves.has(keyOf(s)))
      .map((s) => ({ ...s, role: roleOverrides[keyOf(s)] ?? s.role })),
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
    const k = keyOf(optimistic);
    // Ignore duplicate submits while an add for the same principal is in flight.
    if (inFlight.has(k)) return;
    setPendingAdds((p) => [...p, optimistic]);
    setEmail("");
    addInFlight(k);
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
            clearInFlight(k);
          });
        },
        onError: () => {
          setPendingAdds((p) => p.filter((s) => s.id !== optimistic.id));
          clearInFlight(k);
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
          <RoleSelect value={role} onChange={setRole} />
        </div>
      ) : null}

      <div className="mb-2 text-sm font-semibold">People with access</div>
      <ul className="mb-4 flex flex-col gap-1 list-none p-0 m-0">
        {data?.ownerEmail ? (
          <li className="flex items-center gap-3 px-1 py-1.5 text-sm">
            <Avatar label={displayName(data.ownerEmail, orgMembers)} />
            <span className="flex-1 min-w-0 truncate">
              {displayName(data.ownerEmail, orgMembers)}
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
                  : displayName(s.principalId, orgMembers)
              }
              org={s.principalType === "org"}
            />
            <span className="flex-1 min-w-0 truncate">
              {s.principalType === "org"
                ? s.principalId
                : displayName(s.principalId, orgMembers)}
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

      <div className="mb-2 text-sm font-semibold">General access</div>
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

// ---------------------------------------------------------------------------
// Radix Select wrappers styled like shadcn Select (no native <select> anywhere)
// ---------------------------------------------------------------------------

const selectContentClass =
  "z-[2100] min-w-[12rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";
const selectItemClass =
  "relative flex w-full cursor-pointer select-none items-start gap-2 rounded-sm py-2 pl-8 pr-3 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

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
          <span className="absolute left-2 top-2 flex h-4 w-4 items-center justify-center">
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
}) {
  const current = VIS_META[props.value];
  return (
    <Select.Root
      value={props.value}
      onValueChange={(v) => props.onChange(v as Visibility)}
      disabled={props.disabled}
    >
      <Select.Trigger
        className={cn(
          BUTTON_BASE,
          "h-7 px-1 -ml-1 bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
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
              items={(Object.keys(VIS_META) as Visibility[]).map((k) => ({
                value: k,
                label: VIS_META[k].label,
                description: VIS_META[k].description,
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
