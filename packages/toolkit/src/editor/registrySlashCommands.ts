export interface RegistrySlashBlockSpec {
  type: string;
  label: string;
  description: string;
  notionCompatible?: boolean;
}

export interface RegistrySlashBlockRegistry<
  TSpec extends RegistrySlashBlockSpec = RegistrySlashBlockSpec,
> {
  list: (placement: "block") => TSpec[];
}

const COMPACT_REGISTRY_BLOCK_DESCRIPTIONS: Record<string, string> = {
  callout: "Emphasized note",
  diagram: "Inline diagram",
  wireframe: "Screen mockup",
  "question-form": "Interactive questions",
  checklist: "Checklist items",
  table: "Editable grid",
  "table-block": "Editable grid",
  "code-tabs": "Tabbed code snippets",
  "custom-html": "Sandboxed HTML",
  tabs: "Tabbed block group",
  columns: "Side-by-side columns",
  mermaid: "Mermaid diagram",
  "api-endpoint": "API reference",
  "openapi-spec": "OpenAPI document",
  "data-model": "ERD schema",
  diff: "Code diff",
  "file-tree": "File/change tree",
  "json-explorer": "JSON tree",
  "annotated-code": "Code walkthrough",
};

export function getRegistryBlockSlashDescription(
  spec: Pick<RegistrySlashBlockSpec, "type" | "description">,
): string {
  return (
    COMPACT_REGISTRY_BLOCK_DESCRIPTIONS[spec.type] ??
    spec.description.trim().replace(/\s+/g, " ")
  );
}

export function getRegistryBlockSlashSearchText(
  spec: Pick<RegistrySlashBlockSpec, "type" | "label" | "description">,
): string {
  return [spec.label, spec.description, spec.type]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export interface BuildRegistryBlockSlashItemsOptions<
  TItem,
  TEditor,
  TSpec extends RegistrySlashBlockSpec = RegistrySlashBlockSpec,
> {
  notionCompatibleOnly?: boolean;
  isNotionCompatible?: (spec: TSpec) => boolean;
  toItem: (spec: TSpec, insert: (editor: TEditor) => void) => TItem;
  includeSpec?: (spec: TSpec) => boolean;
  insertBlock: (editor: TEditor, spec: TSpec) => void;
}

export function buildRegistryBlockSlashItems<
  TItem,
  TEditor,
  TSpec extends RegistrySlashBlockSpec = RegistrySlashBlockSpec,
>(
  registry: RegistrySlashBlockRegistry<TSpec>,
  options: BuildRegistryBlockSlashItemsOptions<TItem, TEditor, TSpec>,
): TItem[] {
  const isCompatible =
    options.isNotionCompatible ?? ((spec) => Boolean(spec.notionCompatible));
  return registry
    .list("block")
    .filter((spec) => options.includeSpec?.(spec) ?? true)
    .filter((spec) => !options.notionCompatibleOnly || isCompatible(spec))
    .map((spec) =>
      options.toItem(spec, (editor) => options.insertBlock(editor, spec)),
    );
}
