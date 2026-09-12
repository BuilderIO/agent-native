import {
  ComposerRuntimeAdaptersProvider,
  type ComposerRuntimeAdapters,
} from "@agent-native/toolkit/composer/runtime-adapters";
import { useMemo, type ReactNode } from "react";

import { coreComposerAdapters } from "../composer/runtime-adapters.js";
import { useFormatters, useT } from "../i18n.js";

/**
 * Supplies Core's full composer integrations without a second async module
 * boundary after the Chat route has mounted.
 */
export function CoreComposerRuntimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const translate = useT();
  const formatters = useFormatters();

  const adapters = useMemo<ComposerRuntimeAdapters>(
    () => ({
      ...coreComposerAdapters,
      translate,
      formatNumber: (value, options) => formatters.formatNumber(value, options),
    }),
    [formatters, translate],
  );

  return (
    <ComposerRuntimeAdaptersProvider adapters={adapters}>
      {children}
    </ComposerRuntimeAdaptersProvider>
  );
}
