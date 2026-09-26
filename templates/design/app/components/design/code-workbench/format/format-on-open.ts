import { useEffect } from "react";

import { modelRegistry } from "../model-registry";
import { useWorkbench, type BufferLoadedEvent } from "../store";
import { providerKindFromKey } from "../workspace/types";
import { shouldApplyFormatResult } from "./format-on-open-guard";
import { formatWithPrettier, isFormattablePath } from "./prettier-format";

export { shouldApplyFormatResult } from "./format-on-open-guard";


const MAX_FORMAT_ON_OPEN_BYTES = 200_000;

const attemptedKeys = new Set<string>();

function attemptKey(uri: string, event: BufferLoadedEvent): string {
  return `${uri}@${event.read.versionHash ?? ""}`;
}

export function useFormatOnFirstOpen({ enabled }: { enabled: boolean }): void {
  const { api } = useWorkbench();

  useEffect(() => {
    return api.onBufferLoaded((event) => {
      if (!enabled) return;
      if (!event.firstLoad) return;
      if (providerKindFromKey(event.providerKey) !== "inline") return;
      if (event.read.readonly) return;
      if (!isFormattablePath(event.path)) return;
      if (event.read.content.length > MAX_FORMAT_ON_OPEN_BYTES) return;

      const key = attemptKey(event.uri, event);
      if (attemptedKeys.has(key)) return;
      attemptedKeys.add(key);

      void (async () => {
        const result = await formatWithPrettier(event.read.content, event.path);
        if ("error" in result) return;

        const entry = modelRegistry.get(event.uri);
        if (!entry || entry.model.isDisposed()) return;
        if (
          !shouldApplyFormatResult(
            entry.model.getValue(),
            event.read.content,
            result.formatted,
          )
        ) {
          return;
        }
        entry.model.pushEditOperations(
          null,
          [{ range: entry.model.getFullModelRange(), text: result.formatted }],
          () => null,
        );
        api.markDirty(event.uri, true);
        void api.save(event.uri).catch(() => {
          // Save failed (e.g. stale version) — leave the buffer
          // formatted+dirty; the user or a later save will resolve it.
        });
      })();
    });
  }, [api, enabled]);
}
