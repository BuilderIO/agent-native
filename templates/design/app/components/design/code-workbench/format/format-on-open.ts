import { useEffect } from "react";

import { modelRegistry } from "../model-registry";
import { useWorkbench, type BufferLoadedEvent } from "../store";
import { providerKindFromKey } from "../workspace/types";
import { shouldApplyFormatResult } from "./format-on-open-guard";
import { formatWithPrettier, isFormattablePath } from "./prettier-format";

export { shouldApplyFormatResult } from "./format-on-open-guard";

/**
 * Auto-format-on-first-open policy: the design's SQL-backed (inline) files
 * are machine-generated, so the first time a formattable inline buffer is
 * opened in a session we silently run Prettier over it and persist the
 * result. This is idempotent cleanup, not a user edit — no toast, no visible
 * "formatting…" state. Never runs against localhost (real disk) files.
 */

const MAX_FORMAT_ON_OPEN_BYTES = 200_000;

// Attempt at most once per (uri, versionHash) per session, regardless of how
// many times the buffer gets reloaded.
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
        // Formatting is async (dynamic plugin imports + Prettier itself), so
        // the user may have started typing in the buffer while we were
        // awaiting the result. Applying `result.formatted` — derived from the
        // pre-format snapshot — over the model unconditionally would silently
        // clobber those in-progress edits. Bail out if the live model no
        // longer matches the snapshot that was formatted; a later save or
        // manual format can pick it up.
        if (
          !shouldApplyFormatResult(
            entry.model.getValue(),
            event.read.content,
            result.formatted,
          )
        ) {
          return;
        }
        // Push the formatted text without touching savedAltVersionId, so the
        // buffer becomes dirty (matches the "formatted but unsaved" state a
        // real edit would produce) — then save silently.
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
