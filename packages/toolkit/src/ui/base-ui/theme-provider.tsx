import type {
  Appearance,
  AppThemeName,
  Density,
  RadiusPreset,
  TokenName,
} from "@agent-native/design-system";
import {
  DirectionProvider,
  useDirection,
} from "@base-ui/react/direction-provider";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { OverlayScope } from "./overlay-scope.js";

interface ThemeAxes {
  appearance?: Appearance | "system";
  appTheme?: AppThemeName;
  density?: Density;
  radius?: RadiusPreset;
  corners?: "round" | "squircle";
  palette?: string;
}

export interface ThemeProviderProps
  extends ThemeAxes, useRender.ComponentProps<"div"> {
  /** CSS properties and token overrides applied to the theme root. */
  style?:
    | React.CSSProperties
    | (React.CSSProperties & Partial<Record<TokenName, string | number>>);
}

const inheritAppearance = () => undefined;
const inheritedAppearance = {
  subscribe: () => () => {},
  read: inheritAppearance,
};

function observeAppearance(query: MediaQueryList) {
  const subscribers = new Set<() => void>();
  const notify = () => subscribers.forEach((subscriber) => subscriber());
  return {
    read: (): Appearance => (query.matches ? "dark" : "light"),
    subscribe(subscriber: () => void) {
      if (!subscribers.size) query.addEventListener("change", notify);
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
        if (!subscribers.size) query.removeEventListener("change", notify);
      };
    },
  };
}

const appearanceStores = new WeakMap<
  Window,
  ReturnType<typeof observeAppearance>
>();
function systemPreference(win: Window | null | undefined) {
  if (!win?.matchMedia) return inheritedAppearance;
  let store = appearanceStores.get(win);
  if (!store) {
    store = observeAppearance(win.matchMedia("(prefers-color-scheme: dark)"));
    appearanceStores.set(win, store);
  }
  return store;
}

/** Scopes theme tokens and portals to one element. Omitted axes inherit from enclosing theme regions. The palette prop accepts an identifier registered with paletteCss.
 * @import import { ThemeProvider } from "@agent-native/toolkit/ui/base-ui/theme-provider";
 */
export function ThemeProvider({
  appearance,
  appTheme,
  density,
  radius,
  corners,
  palette,
  render,
  ref,
  ...props
}: ThemeProviderProps) {
  const [host, setHost] = React.useState<HTMLDivElement | null>(null);
  const preference =
    appearance === "system"
      ? systemPreference(host?.ownerDocument.defaultView)
      : inheritedAppearance;
  const systemAppearance = React.useSyncExternalStore<Appearance | undefined>(
    preference.subscribe,
    preference.read,
    inheritAppearance,
  );
  const attributes = {
    className: appearance === "system" ? systemAppearance : appearance,
    "data-app-theme": appTheme,
    "data-density": density,
    "data-radius": radius,
    "data-corners": corners,
    "data-palette": palette,
  };
  const element = useRender<Record<string, never>, HTMLDivElement>({
    defaultTagName: "div",
    render,
    ref: ref ? [setHost, ref] : setHost,
    props: mergeProps<"div">(attributes, props),
  });
  const inheritedDirection = useDirection();
  const dir = React.isValidElement<React.HTMLAttributes<HTMLElement>>(element)
    ? (element.props.dir ?? props.dir)
    : props.dir;
  const [automaticDirection, setAutomaticDirection] = React.useState<
    "ltr" | "rtl"
  >();
  React.useLayoutEffect(() => {
    const win = host?.ownerDocument.defaultView;
    if (dir !== "auto" || !host || !win) return;
    const sync = () =>
      setAutomaticDirection(host.matches(":dir(rtl)") ? "rtl" : "ltr");
    sync();
    const observer = new win.MutationObserver(sync);
    observer.observe(host, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["dir"],
    });
    return () => observer.disconnect();
  }, [dir, host, inheritedDirection]);
  const direction =
    dir === "rtl" || dir === "ltr"
      ? dir
      : dir === "auto"
        ? (automaticDirection ?? inheritedDirection)
        : inheritedDirection;
  return (
    <DirectionProvider direction={direction}>
      <OverlayScope container={host}>{element}</OverlayScope>
    </DirectionProvider>
  );
}
