import { useState } from "react";
import {
  IconShare,
  IconLock,
  IconBuilding,
  IconWorld,
} from "@tabler/icons-react";
import { ShareDialog } from "./ShareDialog.js";
import { useActionQuery } from "../use-action.js";

export interface ShareButtonProps {
  resourceType: string;
  resourceId: string;
  resourceTitle?: string;
  /** Visual style: "compact" (icon + current visibility) or "label". */
  variant?: "compact" | "label";
}

/**
 * Drop-in share button. Opens the framework-standard ShareDialog. Reflects the
 * current visibility with an icon so users can tell at a glance whether the
 * resource is private, org-visible, or public.
 */
export function ShareButton(props: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const q = useActionQuery<{ visibility: "private" | "org" | "public" | null }>(
    "list-resource-shares",
    { resourceType: props.resourceType, resourceId: props.resourceId },
  );
  const visibility = q.data?.visibility ?? "private";
  const Icon =
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
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          border: "1px solid #e5e7eb",
          borderRadius: 6,
          background: "#fff",
          color: "#111827",
          fontSize: 13,
          cursor: "pointer",
          font: "inherit",
        }}
      >
        <Icon size={14} />
        {label}
      </button>
      <ShareDialog
        open={open}
        onClose={() => setOpen(false)}
        resourceType={props.resourceType}
        resourceId={props.resourceId}
        resourceTitle={props.resourceTitle}
      />
    </>
  );
}
