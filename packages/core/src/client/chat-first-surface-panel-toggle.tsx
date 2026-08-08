import { IconLayoutSidebarRightCollapse } from "@tabler/icons-react";

export function ChatFirstSurfacePanelToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="chat-first-surface-panel-toggle"
      data-chat-first-surface-toggle
      aria-label={open ? "Hide side surface" : "Show side surface"}
      aria-pressed={open}
      title={`${open ? "Hide" : "Show"} side surface · ⌘⌥B`}
      onClick={onToggle}
    >
      <IconLayoutSidebarRightCollapse size={15} aria-hidden="true" />
    </button>
  );
}
