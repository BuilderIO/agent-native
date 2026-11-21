import type { PropDefs, PropsOf } from "@agent-native/design-system";
import * as React from "react";

/**
 * A group's design-system props, handed to the items inside it as their
 * defaults, the way Radix Themes' groups pass `size`, `variant` and `color`
 * to their items. An item's own prop wins, and an item outside a group gets
 * nothing. Only the props the group was given travel, so an item still
 * fills in its own definition's defaults.
 */
export function createGroupProps<D extends PropDefs>(defs: D) {
  const Context = React.createContext<PropsOf<D>>({});

  function GroupProps({
    value,
    children,
  }: {
    value: PropsOf<D>;
    children?: React.ReactNode;
  }) {
    const values: Record<string, unknown> = value;
    const given: Record<string, unknown> = {};
    for (const name of Object.keys(defs)) {
      if (values[name] !== undefined) given[name] = values[name];
    }
    return (
      <Context.Provider value={given as PropsOf<D>}>
        {children}
      </Context.Provider>
    );
  }

  function useGroupProps<P extends object>(props: P): P {
    const group: Record<string, unknown> = React.useContext(Context);
    const merged: Record<string, unknown> = Object.fromEntries(
      Object.entries(props),
    );
    for (const [name, value] of Object.entries(group)) {
      if (merged[name] === undefined) merged[name] = value;
    }
    return merged as P;
  }

  return { GroupProps, useGroupProps };
}
