import type { ScreenKind } from "@agent-native/shared-app-config";
import type { ComponentType } from "react";

import { useMobileThemeColors } from "@/lib/mobile-colors";
import { getScreenKind } from "@/lib/screen-registry";

export type ScreenImplementationProps<Params, Sync> = {
  params: Params;
  theme: ReturnType<typeof useMobileThemeColors>;
  sync: Sync;
};

type ScreenHostProps<Params, Sync> = {
  screen: string;
  params: Params;
  sync: Sync;
  renderers: Partial<
    Record<ScreenKind, ComponentType<ScreenImplementationProps<Params, Sync>>>
  >;
};

export default function ScreenHost<Params, Sync>({
  screen,
  params,
  sync,
  renderers,
}: ScreenHostProps<Params, Sync>) {
  const theme = useMobileThemeColors();
  const kind = getScreenKind(screen);
  const Renderer = renderers[kind];

  if (!Renderer) {
    throw new Error(`No ${kind} renderer registered for screen "${screen}"`);
  }

  return <Renderer params={params} sync={sync} theme={theme} />;
}
