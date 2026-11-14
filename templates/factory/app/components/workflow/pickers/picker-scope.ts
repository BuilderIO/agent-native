import { createContext, useContext } from "react";

/**
 * Which factory's connections the pickers list from. The details modal
 * provides it around its parameters; without it a field stays a plain text
 * box, as it is wherever the inspector is shown outside a factory.
 */
export const PickerScope = createContext<{ factoryId: string } | null>(null);

export function usePickerScope(): { factoryId: string } | null {
  return useContext(PickerScope);
}
