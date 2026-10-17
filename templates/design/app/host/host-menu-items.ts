/**
 * Entries a host page adds to the top of the editor's app menu (the logo
 * menu). Set once when the host mounts the editor; the standalone app never
 * sets any, so its menu is unchanged.
 */
export interface DesignHostMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
}

let hostMenuItems: readonly DesignHostMenuItem[] = [];

export function setDesignHostMenuItems(items: readonly DesignHostMenuItem[]): void {
  hostMenuItems = items;
}

export function getDesignHostMenuItems(): readonly DesignHostMenuItem[] {
  return hostMenuItems;
}
