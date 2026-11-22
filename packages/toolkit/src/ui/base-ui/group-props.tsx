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
  const names = Object.keys(defs);
  const Context = React.createContext<PropsOf<D>>({});

  function GroupProps({
    value,
    children,
  }: {
    value: PropsOf<D>;
    children?: React.ReactNode;
  }) {
    const values: Record<string, unknown> = value;
    const inherited = names.map((name) => values[name]);
    const given = React.useMemo(() => {
      const result: Record<string, unknown> = {};
      names.forEach((name, index) => {
        if (inherited[index] !== undefined) result[name] = inherited[index];
      });
      return result as PropsOf<D>;
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- The static prop definition fixes the dependency order and length.
    }, inherited);
    return <Context.Provider value={given}>{children}</Context.Provider>;
  }

  function useGroupProps<P extends object>(props: P): P {
    const group: Record<string, unknown> = React.useContext(Context);
    const own = props as Record<string, unknown>;
    let merged: Record<string, unknown> | undefined;
    for (const name in group) {
      if (own[name] === undefined) {
        merged ??= { ...own };
        merged[name] = group[name];
      }
    }
    return merged ? (merged as P) : props;
  }

  return { GroupProps, useGroupProps };
}
