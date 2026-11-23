import { useMemo, useRef, type ComponentType } from "react";

/**
 * A slot component for a settings row or dialog body. Its identity never
 * changes, so the skin keeps it mounted, and each time the skin renders it, it
 * draws `Component` with the newest `own` props of the hook that made it. The
 * skin supplies the remaining props.
 */
export function useSettingsSlot<
  Props extends object,
  Own extends Partial<Props>,
>(
  Component: ComponentType<Props>,
  own: Own,
): ComponentType<Omit<Props, keyof Own>> {
  const latest = useRef(own);
  latest.current = own;
  return useMemo(() => {
    function SettingsSlot(given: Omit<Props, keyof Own>) {
      const props = { ...latest.current, ...given } as unknown as Props;
      return <Component {...props} />;
    }
    return SettingsSlot;
  }, [Component]);
}
