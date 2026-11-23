import type { ShellContentOwner } from "@agent-native/toolkit/app-shell/sidebar-shell";

export function ContentSlot({ owner }: { owner: ShellContentOwner }) {
  if (!owner.key) throw new Error("Shell content slots require an owner key");
  return null;
}
