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
    const pick = () =>
      Object.fromEntries(
        names
          .filter((name) => values[name] !== undefined)
          .map((name) => [name, values[name]]),
      ) as PropsOf<D>;
    const [previous, setPrevious] = React.useState(pick);
    let given = previous;
    if (
      names.some(
        (name) =>
          !Object.is((previous as Record<string, unknown>)[name], values[name]),
      )
    ) {
      given = pick();
      setPrevious(given);
    }
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
