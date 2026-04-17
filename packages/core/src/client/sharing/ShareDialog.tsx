import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconX,
  IconTrash,
  IconLock,
  IconBuilding,
  IconWorld,
  IconCheck,
} from "@tabler/icons-react";
import { useActionQuery, useActionMutation } from "../use-action.js";

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  resourceType: string;
  resourceId: string;
  resourceTitle?: string;
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
 * Framework-standard share dialog. Drop into any template next to a resource
 * header via `<ShareButton resourceType resourceId />`. Uses inline styles to
 * avoid coupling to a specific shadcn setup — templates can reimplement if
 * they want a tighter visual fit.
 */
export function ShareDialog(props: ShareDialogProps) {
  const { open, onClose, resourceType, resourceId, resourceTitle } = props;

  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType,
    resourceId,
  });

  const setVisibility = useActionMutation("set-resource-visibility");
  const share = useActionMutation("share-resource");
  const unshare = useActionMutation("unshare-resource");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");

  useEffect(() => {
    if (!open) setEmail("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

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

  return createPortal(
    <div style={backdropStyle} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={headerStyle}>
          <div>
            <div style={titleStyle}>
              Share {resourceTitle ? `"${resourceTitle}"` : resourceType}
            </div>
            {data?.ownerEmail ? (
              <div style={subtitleStyle}>Owner: {data.ownerEmail}</div>
            ) : null}
          </div>
          <button aria-label="Close" onClick={onClose} style={iconBtnStyle}>
            <IconX size={16} />
          </button>
        </div>

        <div style={sectionStyle}>
          <div style={sectionLabelStyle}>General access</div>
          <div style={visRowStyle}>
            <VisOption
              active={visibility === "private"}
              disabled={!canManage}
              label="Private"
              sublabel="Only people with explicit access"
              icon={<IconLock size={16} />}
              onClick={() => handleVisibility("private")}
            />
            <VisOption
              active={visibility === "org"}
              disabled={!canManage}
              label="Organization"
              sublabel="Anyone in your org can view"
              icon={<IconBuilding size={16} />}
              onClick={() => handleVisibility("org")}
            />
            <VisOption
              active={visibility === "public"}
              disabled={!canManage}
              label="Public"
              sublabel="Any signed-in user can view"
              icon={<IconWorld size={16} />}
              onClick={() => handleVisibility("public")}
            />
          </div>
        </div>

        <div style={sectionStyle}>
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
                <span
                  style={{
                    ...principalStyle,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {s.principalType === "org" ? (
                    <IconBuilding size={14} strokeWidth={1.75} />
                  ) : null}
                  {s.principalId}
                </span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={roleStyle}>{cap(s.role)}</span>
                  {canManage ? (
                    <button
                      aria-label="Remove"
                      onClick={() => handleRemove(s)}
                      style={iconBtnStyle}
                    >
                      <IconTrash size={14} />
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
            {!data?.shares?.length && !data?.ownerEmail ? (
              <li style={{ ...itemStyle, color: "#6b7280" }}>
                No one has access yet.
              </li>
            ) : null}
          </ul>
        </div>

        {canManage ? (
          <div style={sectionStyle}>
            <div style={sectionLabelStyle}>Invite by email</div>
            <div style={inviteRowStyle}>
              <input
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
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
                onClick={handleAdd}
                disabled={!email.trim() || share.isPending}
                style={primaryBtnStyle(!email.trim() || share.isPending)}
              >
                <IconCheck size={14} /> Share
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
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
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px solid ${props.active ? "#111827" : "#e5e7eb"}`,
        background: props.active ? "#111827" : "#fff",
        color: props.active ? "#fff" : "#111827",
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.6 : 1,
        textAlign: "left",
        font: "inherit",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {props.icon}
        <strong style={{ fontSize: 13 }}>{props.label}</strong>
      </span>
      <span style={{ fontSize: 11, opacity: 0.75 }}>{props.sublabel}</span>
    </button>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};

const panelStyle: React.CSSProperties = {
  background: "#fff",
  color: "#111827",
  borderRadius: 12,
  width: "min(520px, 92vw)",
  maxHeight: "86vh",
  overflowY: "auto",
  boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
  padding: 20,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: 12,
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginTop: 2,
};

const sectionStyle: React.CSSProperties = {
  marginTop: 14,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "#6b7280",
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const visRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  overflow: "hidden",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 12px",
  borderBottom: "1px solid #f3f4f6",
  fontSize: 13,
};

const principalStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const roleStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
};

const inviteRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  fontSize: 13,
};

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  fontSize: 13,
  background: "#fff",
};

const primaryBtnStyle = (disabled: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "8px 12px",
  border: "none",
  borderRadius: 6,
  background: disabled ? "#9ca3af" : "#111827",
  color: "#fff",
  fontSize: 13,
  cursor: disabled ? "not-allowed" : "pointer",
});

const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#6b7280",
  cursor: "pointer",
  padding: 4,
  display: "inline-flex",
  alignItems: "center",
};
