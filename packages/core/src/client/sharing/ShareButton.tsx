import { useEffect, useState } from "react";
import {
  IconShare,
  IconLock,
  IconBuilding,
  IconWorld,
  IconTrash,
  IconCheck,
  IconX,
} from "@tabler/icons-react";
import * as Popover from "@radix-ui/react-popover";
import { useActionQuery, useActionMutation } from "../use-action.js";

export interface ShareButtonProps {
  resourceType: string;
  resourceId: string;
  resourceTitle?: string;
  /** Visual style: "compact" (icon + current visibility) or "label". */
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

/**
 * Drop-in share control. Renders as a shadcn-outline-styled trigger that
 * opens a popover anchored beneath it — picks up the template's theme
 * (including dark mode) via CSS variables, so the same component looks
 * native in every template.
 */
export function ShareButton(props: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType: props.resourceType,
    resourceId: props.resourceId,
  });
  const visibility: Visibility =
    (sharesQuery.data?.visibility as Visibility | null) ?? "private";

  const VisIcon =
    visibility === "public"
      ? IconWorld
      : visibility === "org"
        ? IconBuilding
        : props.variant === "compact"
          ? IconLock
          : IconShare;
  const label =
    props.variant === "compact"
      ? visibility === "private"
        ? "Private"
        : visibility === "org"
          ? "Organization"
          : "Public"
      : "Share";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" style={triggerStyle}>
          <VisIcon size={14} strokeWidth={1.75} />
          <span>{label}</span>
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

  useEffect(() => {
    sharesQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = sharesQuery.data;
  const visibility: Visibility =
    (data?.visibility as Visibility | null) ?? "private";
  const canManage =
    data?.role === "owner" || data?.role === "admin" || !data?.role;

  const handleVisibility = (next: Visibility) => {
    setVisibility.mutate(
      { resourceType, resourceId, visibility: next } as any,
      { onSuccess: () => sharesQuery.refetch() },
    );
  };
  const handleAdd = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
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
          setEmail("");
          sharesQuery.refetch();
        },
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
      { onSuccess: () => sharesQuery.refetch() },
    );
  };

  return (
    <div style={panelInnerStyle}>
      <div style={headerRow}>
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>
            Share {resourceTitle ? `"${resourceTitle}"` : resourceType}
          </div>
          {data?.ownerEmail ? (
            <div style={subtitleStyle}>Owner: {data.ownerEmail}</div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={iconBtnStyle}
        >
          <IconX size={14} />
        </button>
      </div>

      <div style={sectionLabelStyle}>General access</div>
      <div style={visRow}>
        <VisOption
          active={visibility === "private"}
          disabled={!canManage}
          label="Private"
          sublabel="Only people with explicit access"
          icon={<IconLock size={14} strokeWidth={1.75} />}
          onClick={() => handleVisibility("private")}
        />
        <VisOption
          active={visibility === "org"}
          disabled={!canManage}
          label="Organization"
          sublabel="Anyone in your org can view"
          icon={<IconBuilding size={14} strokeWidth={1.75} />}
          onClick={() => handleVisibility("org")}
        />
        <VisOption
          active={visibility === "public"}
          disabled={!canManage}
          label="Public"
          sublabel="Any signed-in user can view"
          icon={<IconWorld size={14} strokeWidth={1.75} />}
          onClick={() => handleVisibility("public")}
        />
      </div>

      <div style={sectionLabelStyle}>People with access</div>
      <ul style={listStyle}>
        {data?.ownerEmail ? (
          <li style={itemStyle}>
            <span style={principalStyle}>{data.ownerEmail}</span>
            <span style={roleStyle}>Owner</span>
          </li>
        ) : null}
        {(data?.shares ?? []).map((s) => (
          <li key={s.id} style={itemStyle}>
            <span style={principalStyle}>
              {s.principalType === "org" ? "🏢 " : ""}
              {s.principalId}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={roleStyle}>{cap(s.role)}</span>
              {canManage ? (
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => handleRemove(s)}
                  style={iconBtnStyle}
                >
                  <IconTrash size={13} />
                </button>
              ) : null}
            </span>
          </li>
        ))}
        {!data?.shares?.length && !data?.ownerEmail ? (
          <li style={{ ...itemStyle, color: mutedText }}>
            No one has access yet.
          </li>
        ) : null}
      </ul>

      {canManage ? (
        <>
          <div style={sectionLabelStyle}>Invite by email</div>
          <div style={inviteRow}>
            <input
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              style={inputStyle}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              style={selectStyle}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!email.trim() || share.isPending}
              style={primaryBtnStyle(!email.trim() || share.isPending)}
            >
              <IconCheck size={13} /> Share
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function VisOption(props: {
  active: boolean;
  disabled?: boolean;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        padding: "8px 10px",
        borderRadius: 6,
        border: `1px solid ${props.active ? "hsl(var(--foreground))" : "hsl(var(--border))"}`,
        background: props.active
          ? "hsl(var(--foreground))"
          : "hsl(var(--background))",
        color: props.active
          ? "hsl(var(--background))"
          : "hsl(var(--foreground))",
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.6 : 1,
        textAlign: "left",
        font: "inherit",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {props.icon}
        <strong style={{ fontSize: 12, fontWeight: 600 }}>{props.label}</strong>
      </span>
      <span style={{ fontSize: 11, opacity: 0.75 }}>{props.sublabel}</span>
    </button>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- theme-aware styles (use shadcn CSS variables so the same component
//     renders correctly in light and dark mode without extra plumbing) ---

const mutedText = "hsl(var(--muted-foreground))";

const triggerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 32,
  padding: "0 12px",
  borderRadius: 6,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  font: "inherit",
  lineHeight: 1,
};

const panelStyle: React.CSSProperties = {
  width: "min(420px, 92vw)",
  background: "hsl(var(--popover, var(--background)))",
  color: "hsl(var(--popover-foreground, var(--foreground)))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
  zIndex: 2000,
};

const panelInnerStyle: React.CSSProperties = {
  padding: 14,
  fontFamily: "inherit",
};

const headerRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 8,
  marginBottom: 12,
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: mutedText,
  marginTop: 2,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: mutedText,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  marginTop: 10,
  marginBottom: 6,
};

const visRow: React.CSSProperties = {
  display: "flex",
  gap: 6,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  overflow: "hidden",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "6px 10px",
  borderBottom: "1px solid hsl(var(--border))",
  fontSize: 12,
};

const principalStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const roleStyle: React.CSSProperties = {
  fontSize: 11,
  color: mutedText,
};

const inviteRow: React.CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "center",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 30,
  padding: "0 10px",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  fontSize: 12,
  background: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
};

const selectStyle: React.CSSProperties = {
  height: 30,
  padding: "0 8px",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  fontSize: 12,
  background: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
};

const primaryBtnStyle = (disabled: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 30,
  padding: "0 12px",
  border: "none",
  borderRadius: 6,
  background: disabled
    ? "hsl(var(--muted))"
    : "hsl(var(--primary, var(--foreground)))",
  color: disabled
    ? "hsl(var(--muted-foreground))"
    : "hsl(var(--primary-foreground, var(--background)))",
  fontSize: 12,
  fontWeight: 500,
  cursor: disabled ? "not-allowed" : "pointer",
});

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 22,
  width: 22,
  padding: 0,
  border: "none",
  background: "transparent",
  color: mutedText,
  cursor: "pointer",
  borderRadius: 4,
};
