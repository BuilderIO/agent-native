import {
  buildCodeLayerProjection,
  type CodeLayerSource,
} from "./code-layer.js";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_REF_ATTR,
  componentNameFor,
} from "./component-model.js";

export interface ComponentLibraryFile {
  id: string;
  designId: string;
  filename: string;
  content: string | null;
}

export interface ComponentLibraryEntry {
  name: string;
  componentId?: string;
  componentRef?: string;
  fileId: string;
  filename: string;
  nodeId: string;
  selector: string;
}

export function scanComponentLibrary(
  files: ComponentLibraryFile[],
): ComponentLibraryEntry[] {
  const entries: Array<
    Omit<ComponentLibraryEntry, "name"> & {
      name?: string;
    }
  > = [];
  const namesByIdentity = new Map<string, string>();

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
      const name = componentNameFor(node) ?? undefined;
      const componentId =
        node.dataAttributes[COMPONENT_ID_ATTR]?.trim() || undefined;
      const componentRef =
        node.dataAttributes[COMPONENT_REF_ATTR]?.trim() || undefined;
      if (!name && !componentId && !componentRef) continue;

      if (name && componentId) namesByIdentity.set(componentId, name);
      if (name && componentRef) namesByIdentity.set(componentRef, name);

      const nodeId =
        node.dataAttributes["data-agent-native-node-id"] ?? node.id;

      entries.push({
        name,
        componentId,
        componentRef,
        fileId: file.id,
        filename: file.filename,
        nodeId,
        selector: node.selector,
      });
    }
  }

  return entries.flatMap((entry) => {
    const name =
      entry.name ??
      (entry.componentRef
        ? namesByIdentity.get(entry.componentRef)
        : entry.componentId
          ? namesByIdentity.get(entry.componentId)
          : undefined);
    return name ? [{ ...entry, name }] : [];
  });
}

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
