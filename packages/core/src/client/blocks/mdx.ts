import type { BlockRegistry } from "./registry.js";
import type { BlockSpec, BlockAttrReader, MdxAttrValue } from "./types.js";

export function jsonExpression(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function prop(name: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") {
    return value ? ` ${name}` : ` ${name}={false}`;
  }
  if (typeof value === "number") return ` ${name}={${value}}`;
  if (typeof value === "string") {
    if (/^[\w .:/@#,+()[\]-]+$/.test(value) && value.length < 140) {
      return ` ${name}="${escapeAttr(value)}"`;
    }
    return ` ${name}={${jsonExpression(value)}}`;
  }
  return ` ${name}={${jsonExpression(value)}}`;
}

export type MdxAttrNode = {
  type: string;
  name?: string;
  value?: string | null | MdxAttrExpression;
};

type MdxAttrExpression = {
  type: string;
  value: string;
  data?: unknown;
};

type EstreeTemplateElement = {
  type: string;
  value?: { cooked?: string | null; raw?: string };
};

type EstreeNode = {
  type: string;
  value?: unknown;
  name?: string;
  expression?: EstreeNode;
  body?: EstreeNode[];
  elements?: Array<EstreeNode | null>;
  properties?: EstreeNode[];
  key?: EstreeNode;
  computed?: boolean;
  argument?: EstreeNode;
  operator?: string;
  quasis?: EstreeTemplateElement[];
  expressions?: EstreeNode[];
};

export type MdxJsxNode = {
  type: string;
  name?: string;
  attributes?: MdxAttrNode[];
  children?: unknown[];
  [key: string]: unknown;
};

function findAttribute(
  node: MdxJsxNode,
  name: string,
): MdxAttrNode | undefined {
  return node.attributes?.find(
    (attr) => attr.type === "mdxJsxAttribute" && attr.name === name,
  );
}

export function attributeValue(attr: MdxAttrNode | undefined): unknown {
  if (!attr) return undefined;
  if (attr.value === null || attr.value === undefined) return true;
  if (typeof attr.value === "string") return attr.value;
  const astValue = literalExpressionValue(attr.value);
  if (astValue !== undefined) return astValue;
  const expression = attr.value.value.trim();
  if (!expression) return undefined;
  if (expression === "undefined") return undefined;
  try {
    return JSON.parse(expression);
  } catch {
    throw new Error(
      `Unsupported MDX attribute expression for "${attr.name}": {${expression}}. Use literal values or valid JSON.`,
    );
  }
}

function literalExpressionValue(expression: MdxAttrExpression): unknown {
  const estree = (expression.data as { estree?: EstreeNode } | undefined)
    ?.estree;
  const statement = estree?.body?.[0];
  if (!statement || statement.type !== "ExpressionStatement") return undefined;
  return literalNodeValue(statement.expression);
}

function literalNodeValue(node: EstreeNode | undefined | null): unknown {
  if (!node) return undefined;
  if (node.type === "Literal") return node.value;
  if (node.type === "TemplateLiteral") {
    if ((node.expressions?.length ?? 0) > 0) {
      throw new Error(
        "Template literal attribute values may not contain ${…} expressions; use a static string.",
      );
    }
    return node.quasis?.[0]?.value?.cooked ?? "";
  }
  if (node.type === "ArrayExpression") {
    return (node.elements ?? []).map((item) => literalNodeValue(item));
  }
  if (node.type === "ObjectExpression") {
    const out: Record<string, unknown> = {};
    for (const property of node.properties ?? []) {
      if (property.type !== "Property" || property.computed) return undefined;
      const key = property.key;
      const rawKey =
        key?.type === "Identifier"
          ? key.name
          : key?.type === "Literal" && typeof key.value === "string"
            ? key.value
            : undefined;
      if (!rawKey) return undefined;
      const value = literalNodeValue(property.value as EstreeNode | undefined);
      if (value !== undefined) out[rawKey] = value;
    }
    return out;
  }
  if (node.type === "UnaryExpression") {
    const value = literalNodeValue(node.argument);
    if (typeof value !== "number") return undefined;
    if (node.operator === "-") return -value;
    if (node.operator === "+") return value;
  }
  if (node.type === "Identifier") {
    if (node.name === "undefined") return undefined;
    if (node.name === "NaN") return Number.NaN;
    if (node.name === "Infinity") return Infinity;
  }
  return undefined;
}

export function createAttrReader(node: MdxJsxNode): BlockAttrReader {
  const read = (name: string) => attributeValue(findAttribute(node, name));
  return {
    raw: read,
    string(name) {
      const value = read(name);
      return typeof value === "string" ? value : undefined;
    },
    number(name) {
      const value = read(name);
      return typeof value === "number" ? value : undefined;
    },
    bool(name) {
      const value = read(name);
      return typeof value === "boolean" ? value : undefined;
    },
    array(name) {
      const value = read(name);
      return Array.isArray(value) ? (value as never[]) : undefined;
    },
    object(name) {
      const value = read(name);
      return value && typeof value === "object" ? (value as never) : undefined;
    },
  };
}

type MdxCodeNode = {
  type?: unknown;
  lang?: unknown;
  value?: unknown;
};

function codeFenceFor(value: string): string {
  const longestBacktickRun =
    value.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
}

function codeFenceLang(value: unknown): string | undefined {
  return typeof value === "string"
    ? value.trim().split(/\s+/)[0]?.toLowerCase()
    : undefined;
}

export function childCodeFenceFields<TData extends object>(
  childNodes: unknown[],
  fieldsByLang: Record<string, keyof TData & string>,
): Partial<TData> {
  const out: Partial<TData> = {};
  for (const node of childNodes as MdxCodeNode[]) {
    if (!node || node.type !== "code" || typeof node.value !== "string") {
      continue;
    }
    const field = fieldsByLang[codeFenceLang(node.lang) ?? ""];
    if (field) {
      (out as Record<string, string>)[field] = node.value;
    }
  }
  return out;
}

export function serializeChildCodeFenceFields<TData extends object>(
  data: TData,
  fieldsByLang: Record<string, keyof TData & string>,
): string {
  const fences: string[] = [];
  const record = data as Record<string, unknown>;
  for (const [lang, field] of Object.entries(fieldsByLang)) {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) continue;
    const fence = codeFenceFor(value);
    fences.push(`${fence}${lang}\n${value.trimEnd()}\n${fence}`);
  }
  return fences.length ? `\n${fences.join("\n\n")}\n` : "";
}

export interface SerializableBlock {
  id: string;
  title?: string;
  summary?: string;
  editable?: boolean;
  data: unknown;
}

export interface ParsedBlockBase {
  id: string;
  title?: string;
  summary?: string;
  editable?: boolean;
}

export function serializeSpecBlock(
  spec: BlockSpec<any>,
  block: SerializableBlock,
): string {
  const base =
    prop("id", block.id) +
    prop("title", block.title) +
    prop("summary", block.summary) +
    prop("editable", block.editable);

  const attrs = spec.mdx.toAttrs(block.data);
  const childrenField = spec.mdx.childrenField;
  const attrStr = Object.entries(attrs)
    .filter(([key]) => key !== childrenField)
    .map(([key, value]) => prop(key, value as MdxAttrValue | undefined))
    .join("");

  const tag = spec.mdx.tag;

  if (spec.mdx.serializeChildren) {
    const children = spec.mdx.serializeChildren(block.data);
    if (!children.trim()) return `<${tag}${base}${attrStr} />`;
    return `<${tag}${base}${attrStr}>\n${children}\n</${tag}>`;
  }

  if (childrenField) {
    const body = String(
      (block.data as Record<string, unknown>)[childrenField] ?? "",
    ).trim();
    return `<${tag}${base}${attrStr}>\n\n${body}\n\n</${tag}>`;
  }

  return `<${tag}${base}${attrStr} />`;
}

export function parseSpecBlock(
  registry: BlockRegistry,
  node: MdxJsxNode,
  base: ParsedBlockBase,
  children: string,
  idContext: string,
): { type: string; data: unknown } | null {
  const tag = node.name;
  if (!tag) return null;
  const spec = registry.getByTag(tag);
  if (!spec) return null;

  const reader = createAttrReader(node);
  let data: unknown;
  if (spec.mdx.parseChildren) {
    const fromAttrs = spec.mdx.fromAttrs(reader, children);
    const fromChildren = spec.mdx.parseChildren(
      node.children ?? [],
      `${idContext}-${base.id}`,
    );
    data = { ...(fromAttrs as object), ...(fromChildren as object) };
  } else {
    data = spec.mdx.fromAttrs(reader, children);
  }
  return { type: spec.type, data };
}
