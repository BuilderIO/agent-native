/**
 * Component library scan — cross-file component instance discovery.
 *
 * `index-components` (and `get-component-details`) only ever look at ONE
 * design file at a time (the active file, or an explicit `fileId`).
 * `component_index` metadata is therefore scoped to whichever file was last
 * indexed, and its `runtimeSelectors` do not reliably span every screen in a
 * multi-file design.
 *
 * "Go to main component" and "Swap instance" both need to find OTHER
 * instances of a component name that may live on a different screen (design
 * file) than the one currently open. This module scans a caller-supplied set
 * of already-fetched design files (any order the caller wants — typically
 * `createdAt` ascending, oldest/"most original" first) and returns every
 * component instance found across all of them, in that same order.
 *
 * Pure — no DB / IO. Callers fetch file rows (respecting `accessFilter`) and
 * pass the rows in here.
 */

import {
  buildCodeLayerProjection,
  type CodeLayerSource,
} from "./code-layer.js";
import { componentNameFor, isComponentInstance } from "./component-model.js";

export interface ComponentLibraryFile {
  id: string;
  designId: string;
  filename: string;
  content: string | null;
}

export interface ComponentLibraryEntry {
  /** Component name from `data-agent-native-component`. */
  name: string;
  fileId: string;
  filename: string;
  /** `data-agent-native-node-id` (or fallback) of the instance root. */
  nodeId: string;
  /** CSS selector that addresses this instance on its screen. */
  selector: string;
}

/**
 * Scan every file for component instances, preserving the caller's file
 * order and each file's document order. Files with empty/missing content are
 * skipped rather than throwing.
 */
export function scanComponentLibrary(
  files: ComponentLibraryFile[],
): ComponentLibraryEntry[] {
  const entries: ComponentLibraryEntry[] = [];

  for (const file of files) {
    const html = file.content ?? "";
    if (!html) continue;

    const codeLayerSource: CodeLayerSource = {
      kind: "design-file",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
    };

    const projection = buildCodeLayerProjection(html, {
      source: codeLayerSource,
    });

    for (const node of projection.nodes) {
      if (!isComponentInstance(node)) continue;
      const name = componentNameFor(node);
      if (!name) continue;

      // `node.id` is an ephemeral id scoped to this one projection call — it
      // is NOT the same as the durable `data-agent-native-node-id` attribute
      // stamped into the HTML (see `ensureCodeLayerNodeIdsInHtml`). Callers
      // that navigate to / re-select this entry on a LATER read (a different
      // projection call — e.g. after a `navigate` round-trip) need the stable
      // attribute value, not this run's ephemeral id, so prefer it here and
      // only fall back to `node.id` for the rare case a component-annotated
      // node hasn't been stamped with a durable id yet.
      const nodeId =
        node.dataAttributes["data-agent-native-node-id"] ?? node.id;

      entries.push({
        name,
        fileId: file.id,
        filename: file.filename,
        nodeId,
        selector: node.selector,
      });
    }
  }

  return entries;
}

/**
 * Filter a scanned library to instances of one component name, optionally
 * excluding a specific (fileId, nodeId) — typically the instance the caller
 * is acting on, so it doesn't get offered back as its own "main"/swap
 * source.
 */
export function entriesForComponent(
  entries: ComponentLibraryEntry[],
  name: string,
  exclude?: { fileId: string; nodeId: string },
): ComponentLibraryEntry[] {
  return entries.filter((entry) => {
    if (entry.name !== name) return false;
    if (
      exclude &&
      entry.fileId === exclude.fileId &&
      entry.nodeId === exclude.nodeId
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Aggregate scanned entries into one row per distinct component name — the
 * shape the Swap Instance picker needs (a name to pick, a count, and a
 * representative instance to source markup/props from).
 */
export interface ComponentLibrarySummary {
  name: string;
  instanceCount: number;
  sampleFileId: string;
  sampleFilename: string;
  sampleNodeId: string;
  sampleSelector: string;
}

export function summarizeComponentLibrary(
  entries: ComponentLibraryEntry[],
): ComponentLibrarySummary[] {
  const byName = new Map<string, ComponentLibrarySummary>();

  for (const entry of entries) {
    const existing = byName.get(entry.name);
    if (existing) {
      existing.instanceCount += 1;
      continue;
    }
    byName.set(entry.name, {
      name: entry.name,
      instanceCount: 1,
      sampleFileId: entry.fileId,
      sampleFilename: entry.filename,
      sampleNodeId: entry.nodeId,
      sampleSelector: entry.selector,
    });
  }

  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
