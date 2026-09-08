// Sidebar is no longer used — navigation is handled by AppLayout's top bar and icon rail.
// This file is kept as an empty export so existing imports don't break.

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  onCompose: () => void;
}

export function Sidebar(_props: SidebarProps) {
  return null;
}
