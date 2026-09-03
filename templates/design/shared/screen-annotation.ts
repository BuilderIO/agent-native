/**
 * Server-side entry point for stamping `data-agent-native-node-id` on newly
 * persisted screens.
 *
 * `ensureCodeLayerNodeIdsInHtml` (shared/code-layer.ts) already implements a
 * safe, idempotent, whole-document annotation pass — it walks the full
 * element tree, skips non-visual tags (head/script/style/meta/link/title/
 * template/noscript) and SVG internals, preserves any existing clean id, and
 * mints fresh ids for everything else using the editor's existing `an-<hash>`
 * format. Today it only runs client-side (DesignCanvas.tsx / DesignEditor.tsx)
 * as a live-annotation effect, which means a design is only ever fully
 * annotated the first time a human opens it in the editor — until then every
 * id-keyed operation (move layer, style commit, motion/interaction targeting)
 * silently fails on a freshly generated or imported screen.
 *
 * `annotateScreenHtmlForPersist` reuses that exact function so every
 * generation/import/create persistence path can stamp ids at creation time,
 * before the client ever sees the screen — new designs are born annotated
 * instead of depending on a client-side backfill.
 */
import { ensureCodeLayerNodeIdsInHtml } from "./code-layer.js";

/**
 * Stamp missing `data-agent-native-node-id` attributes on an HTML screen
 * before it is persisted. Idempotent (a no-op when every element already has
 * a clean id) and a no-op for non-HTML file types (JSX is source-edited, not
 * DOM-projected; CSS/asset files have no elements to annotate).
 *
 * Never throws: annotation is a best-effort enhancement, not a correctness
 * requirement, so a defensive parse failure must never block a save. Worst
 * case, the existing client-side `ensureCodeLayerNodeIdsInHtml` effect
 * backfills ids the first time the screen is opened, exactly as it does
 * today for designs generated before this pass existed.
 */
export function annotateScreenHtmlForPersist(
  content: string,
  fileType: string | null | undefined,
): string {
  if ((fileType ?? "html") !== "html") return content;
  if (typeof content !== "string" || !content.trim()) return content;
  try {
    return ensureCodeLayerNodeIdsInHtml(content).content;
  } catch {
    return content;
  }
}
