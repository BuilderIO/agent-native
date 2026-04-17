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
 * opens a Google-Docs-style popover: a people-input at the top, a
 * "People with access" list, and a "General access" row with a single
 * visibility dropdown. All colors use CSS variables so dark mode works
 * out of the box in any shadcn template.
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
        <button type="button" style={triggerStyle}>
          <TriggerIcon size={16} strokeWidth={1.75} />
          <span>{triggerLabel}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          style={panelStyle}
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

  // Optimistic overlays on top of server state so clicks feel instant.
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

  return (
    <div style={panelInner}>
      <div style={titleStyle}>
        Share {resourceTitle ? `"${resourceTitle}"` : resourceType}
      </div>

      {canManage ? (
        <div style={inviteRow}>
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
            style={inputStyle}
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
          <div style={selectWrap}>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              style={selectStyle}
              aria-label="Role"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
            <IconChevronDown size={14} style={selectChevron} />
          </div>
        </div>
      ) : null}

      <div style={sectionLabel}>People with access</div>
      <ul style={listStyle}>
        {data?.ownerEmail ? (
          <li style={rowStyle}>
            <span style={avatarStyle} aria-hidden>
              {initials(data.ownerEmail)}
            </span>
            <span style={{ ...principalStyle, flex: 1, minWidth: 0 }}>
              {data.ownerEmail}
            </span>
            <span style={roleStyle}>Owner</span>
          </li>
        ) : null}
        {shares.map((s) => (
          <li key={keyOf(s)} style={rowStyle}>
            <span style={avatarStyle} aria-hidden>
              {s.principalType === "org" ? "🏢" : initials(s.principalId)}
            </span>
            <span style={{ ...principalStyle, flex: 1, minWidth: 0 }}>
              {s.principalId}
            </span>
            <span style={roleStyle}>{cap(s.role)}</span>
            {canManage ? (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => handleRemove(s)}
                style={iconBtnStyle}
              >
                <IconTrash size={14} />
              </button>
            ) : null}
          </li>
        ))}
        {!shares.length && !data?.ownerEmail ? (
          <li style={{ ...rowStyle, color: "hsl(var(--muted-foreground))" }}>
            No one has access yet.
          </li>
        ) : null}
      </ul>

      <div style={sectionLabel}>General access</div>
      <div style={generalRow}>
        <span style={generalIcon} aria-hidden>
          <meta.Icon size={16} strokeWidth={1.75} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={selectWrap}>
            <select
              value={visibility}
              disabled={!canManage}
              onChange={(e) => handleVisibility(e.target.value as Visibility)}
              style={generalSelectStyle}
              aria-label="General access"
            >
              <option value="private">{VIS_META.private.label}</option>
              <option value="org">{VIS_META.org.label}</option>
              <option value="public">{VIS_META.public.label}</option>
            </select>
            <IconChevronDown size={14} style={selectChevron} />
          </div>
          <div style={generalHint}>{meta.description}</div>
        </div>
      </div>

      <div style={footerRow}>
        <button type="button" onClick={onClose} style={doneBtnStyle}>
          Done
        </button>
      </div>
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

// ---------------------------------------------------------------------------
// Theme-aware styles — use shadcn CSS variables so the same component
// renders correctly in light and dark mode without extra plumbing.
// ---------------------------------------------------------------------------

const triggerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 36,
  padding: "0 12px",
  borderRadius: 6,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  font: "inherit",
  lineHeight: 1,
  whiteSpace: "nowrap",
};

const panelStyle: React.CSSProperties = {
  width: "min(460px, 92vw)",
  background: "hsl(var(--popover, var(--background)))",
  color: "hsl(var(--popover-foreground, var(--foreground)))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 10,
  boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
  zIndex: 2000,
};

const panelInner: React.CSSProperties = {
  padding: 16,
  fontFamily: "inherit",
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  marginBottom: 12,
  paddingRight: 24,
};

const inviteRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  marginBottom: 16,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 36,
  padding: "0 12px",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  fontSize: 14,
  background: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
  outline: "none",
};

const selectWrap: React.CSSProperties = {
  position: "relative",
  display: "inline-block",
};

const selectStyle: React.CSSProperties = {
  appearance: "none" as any,
  WebkitAppearance: "none" as any,
  MozAppearance: "none" as any,
  height: 36,
  padding: "0 28px 0 12px",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  fontSize: 14,
  background: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
  cursor: "pointer",
  font: "inherit",
  lineHeight: 1,
};

const selectChevron: React.CSSProperties = {
  position: "absolute",
  right: 8,
  top: "50%",
  transform: "translateY(-50%)",
  pointerEvents: "none",
  color: "hsl(var(--muted-foreground))",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 8,
  marginTop: 4,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 2,
  marginBottom: 16,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "6px 4px",
  fontSize: 13,
};

const avatarStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 28,
  width: 28,
  borderRadius: "50%",
  background: "hsl(var(--muted))",
  color: "hsl(var(--muted-foreground))",
  fontSize: 11,
  fontWeight: 600,
  flexShrink: 0,
};

const principalStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const roleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "hsl(var(--muted-foreground))",
};

const generalRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "4px 0",
  marginBottom: 16,
};

const generalIcon: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 36,
  width: 36,
  borderRadius: "50%",
  background: "hsl(var(--muted))",
  color: "hsl(var(--muted-foreground))",
  flexShrink: 0,
};

const generalSelectStyle: React.CSSProperties = {
  ...selectStyle,
  // The general-access select is inline with its description below it;
  // hide the border so it reads as plain text with a chevron, matching
  // Google Docs' "Builder.io ▾" presentation.
  border: "none",
  padding: "0 24px 0 0",
  background: "transparent",
  height: 22,
  fontSize: 14,
  fontWeight: 600,
};

const generalHint: React.CSSProperties = {
  fontSize: 12,
  color: "hsl(var(--muted-foreground))",
  marginTop: 2,
};

const footerRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 8,
};

const doneBtnStyle: React.CSSProperties = {
  height: 36,
  padding: "0 20px",
  borderRadius: 999,
  border: "none",
  background: "hsl(var(--primary, var(--foreground)))",
  color: "hsl(var(--primary-foreground, var(--background)))",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  font: "inherit",
  lineHeight: 1,
};

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 24,
  width: 24,
  padding: 0,
  border: "none",
  background: "transparent",
  color: "hsl(var(--muted-foreground))",
  cursor: "pointer",
  borderRadius: 4,
};
