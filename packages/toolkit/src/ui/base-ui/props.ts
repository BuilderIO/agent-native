import {
  propAttributes,
  type PropDefs,
  type PropsOf,
} from "@agent-native/design-system";

/**
 * Splits a component's design-system props from everything else: the
 * definitions' props become the data attributes the part CSS reads, defaults
 * filled in; the rest pass through to the element.
 */
export function splitProps<D extends PropDefs, P extends PropsOf<D>>(
  defs: D,
  props: P,
): [Record<string, string | undefined>, Omit<P, keyof D>] {
  const rest: Record<string, unknown> = {};
  for (const name in props) {
    if (Object.hasOwn(props, name) && !(name in defs)) rest[name] = props[name];
  }
  return [propAttributes(defs, props), rest as Omit<P, keyof D>];
}
