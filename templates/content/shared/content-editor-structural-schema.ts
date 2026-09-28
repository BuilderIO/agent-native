import {
  Schema,
  type AttributeSpec,
  type MarkSpec,
  type NodeSpec,
  type SchemaSpec,
} from "@tiptap/pm/model";

import generated from "./content-editor-structural-schema.generated.json";

type StructuralAttribute = {
  name: string;
  hasDefault: boolean;
  default?: unknown;
  validate?: string;
};

type StructuralType = {
  name: string;
  attrs: readonly StructuralAttribute[];
  [key: string]: unknown;
};

const NODE_FIELDS = [
  "content",
  "marks",
  "group",
  "inline",
  "atom",
  "selectable",
  "draggable",
  "code",
  "whitespace",
  "defining",
  "definingAsContext",
  "definingForContent",
  "isolating",
  "linebreakReplacement",
] as const;

const MARK_FIELDS = [
  "inclusive",
  "excludes",
  "group",
  "spanning",
  "code",
] as const;

function attributes(entries: readonly StructuralAttribute[]) {
  return Object.fromEntries(
    entries.map((entry) => {
      const spec: AttributeSpec = entry.hasDefault
        ? { default: entry.default }
        : {};
      if (entry.validate !== undefined) spec.validate = entry.validate;
      return [entry.name, spec];
    }),
  );
}

function structuralSpec<T extends NodeSpec | MarkSpec>(
  entry: StructuralType,
  fields: readonly string[],
): T {
  const spec: Record<string, unknown> = {};
  if (entry.attrs.length) spec.attrs = attributes(entry.attrs);
  for (const field of fields) {
    const value = entry[field];
    if (value !== undefined) spec[field] = value;
  }
  return spec as T;
}

export function createContentEditorStructuralSchema(): Schema {
  const snapshot = generated as unknown as {
    topNode: string;
    nodes: readonly StructuralType[];
    marks: readonly StructuralType[];
  };
  const spec: SchemaSpec = {
    topNode: snapshot.topNode,
    nodes: Object.fromEntries(
      snapshot.nodes.map((entry) => [
        entry.name,
        structuralSpec<NodeSpec>(entry, NODE_FIELDS),
      ]),
    ),
    marks: Object.fromEntries(
      snapshot.marks.map((entry) => [
        entry.name,
        structuralSpec<MarkSpec>(entry, MARK_FIELDS),
      ]),
    ),
  };
  return new Schema(spec);
}
