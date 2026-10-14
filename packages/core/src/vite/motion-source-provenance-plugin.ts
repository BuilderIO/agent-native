import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "@babel/parser";
import MagicString from "magic-string";
import { parse as parseHtml } from "parse5";
import type { Plugin, ResolvedConfig } from "vite";

import {
  generatedMotionNodeId,
  isMotionSourceHostElementTag,
} from "../shared/motion-source-node-id.js";

const NODE_ID_ATTRIBUTE = "data-agent-native-node-id";
const SOURCE_FILE_ATTRIBUTE = "data-agent-native-motion-source-file";
const SOURCE_HASH_ATTRIBUTE = "data-agent-native-motion-source-hash";
const HTML_NODE_ID_ATTRIBUTE = "data-agent-native-node-id";

type BabelNode = {
  end?: number;
  name?: unknown;
  start?: number;
  type: string;
  value?: unknown;
  [key: string]: unknown;
};

type HtmlNode = {
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  sourceCodeLocation?: {
    startTag?: {
      startOffset: number;
      endOffset: number;
      attrs?: Record<string, { startOffset: number; endOffset: number }>;
    };
  };
};

type SourceEdit = { start: number; end: number; text: string };

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function instrumentMotionHtmlProvenance(args: {
  html: string;
  modulePath: string;
  moduleVersionHash: string;
}): string | null {
  const parseErrors: unknown[] = [];
  const document = parseHtml(args.html, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      parseErrors.push(error);
    },
  }) as unknown as HtmlNode;
  if (parseErrors.length > 0) return null;

  const hostNodes: Array<{ node: HtmlNode; ordinal: number }> = [];
  const visit = (node: HtmlNode) => {
    if (node.tagName && isMotionSourceHostElementTag(node.tagName)) {
      hostNodes.push({ node, ordinal: hostNodes.length });
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(document);

  const nodeIds = hostNodes.map(({ node, ordinal }) => {
    const matches = (node.attrs ?? []).filter(
      (attribute) => attribute.name === HTML_NODE_ID_ATTRIBUTE,
    );
    if (matches.length > 1) return null;
    const authoredId = matches[0]?.value;
    const nodeId =
      authoredId ?? generatedMotionNodeId(args.modulePath, ordinal);
    return /^[A-Za-z0-9_-]+$/.test(nodeId) ? nodeId : null;
  });
  const counts = new Map<string, number>();
  for (const nodeId of nodeIds) {
    if (nodeId) counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
  }

  const edits: SourceEdit[] = [];
  for (const [index, { node }] of hostNodes.entries()) {
    const nodeId = nodeIds[index];
    const tag = node.sourceCodeLocation?.startTag;
    if (!nodeId || counts.get(nodeId) !== 1 || !tag) continue;

    const attrs = new Map(
      (node.attrs ?? []).map((attribute) => [attribute.name, attribute.value]),
    );
    const values: Array<[string, string]> = [
      [HTML_NODE_ID_ATTRIBUTE, nodeId],
      [SOURCE_FILE_ATTRIBUTE, args.modulePath],
      [SOURCE_HASH_ATTRIBUTE, args.moduleVersionHash],
    ];
    const additions: string[] = [];
    for (const [name, value] of values) {
      const existingValue = attrs.get(name);
      if (existingValue === value) continue;
      const location = tag.attrs?.[name];
      const attribute = `${name}="${escapeHtmlAttribute(value)}"`;
      if (location) {
        edits.push({
          start: location.startOffset,
          end: location.endOffset,
          text: attribute,
        });
      } else {
        if (
          name === HTML_NODE_ID_ATTRIBUTE &&
          node.attrs?.some((entry) => entry.name === HTML_NODE_ID_ATTRIBUTE)
        ) {
          continue;
        }
        additions.push(attribute);
      }
    }
    if (additions.length === 0) continue;

    const tagEnd =
      args.html[tag.endOffset - 2] === "/"
        ? tag.endOffset - 2
        : tag.endOffset - 1;
    edits.push({ start: tagEnd, end: tagEnd, text: ` ${additions.join(" ")}` });
  }

  if (edits.length === 0) return null;
  const ordered = [...edits].sort(
    (left, right) => right.start - left.start || right.end - left.end,
  );
  let result = args.html;
  let previousStart = args.html.length + 1;
  for (const edit of ordered) {
    if (edit.end > previousStart || edit.end > args.html.length) return null;
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    previousStart = edit.start;
  }
  return result;
}

/** Adds dev-only JSX identity evidence so source edits follow rendered nodes. */
export function motionSourceProvenancePlugin(): Plugin {
  let root = process.cwd();
  let command: ResolvedConfig["command"] = "serve";

  return {
    name: "agent-native-motion-source-provenance",
    enforce: "pre",
    configResolved(config) {
      root = path.resolve(config.root);
      command = config.command;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        if (command !== "serve" || !context.filename) return;
        const absolutePath = path.resolve(context.filename);
        const modulePath = path
          .relative(root, absolutePath)
          .split(path.sep)
          .join("/");
        const extension = path.extname(modulePath).toLowerCase();
        if (
          !modulePath ||
          path.isAbsolute(modulePath) ||
          modulePath === ".." ||
          modulePath.startsWith("../") ||
          ![".html", ".htm"].includes(extension) ||
          modulePath
            .split("/")
            .some((segment) =>
              ["node_modules", ".vite", "dist", "build"].includes(segment),
            )
        ) {
          return;
        }

        let diskSource: string;
        try {
          diskSource = readFileSync(absolutePath, "utf8");
        } catch (error) {
          throw new Error(
            `Unable to read the Motion HTML source at ${absolutePath}.`,
            { cause: error },
          );
        }
        if (diskSource !== html) return;

        const moduleVersionHash = createHash("sha256")
          .update(diskSource)
          .digest("hex");
        return (
          instrumentMotionHtmlProvenance({
            html,
            modulePath,
            moduleVersionHash,
          }) ?? undefined
        );
      },
    },
    transform(code, id) {
      if (command !== "serve" || !id || id.startsWith("\0")) return null;
      const fileName = id.split("?", 1)[0];
      const extension = path.extname(fileName).toLowerCase();
      if (extension !== ".tsx" && extension !== ".jsx") return null;

      const absolutePath = path.resolve(fileName);
      let diskSource: string;
      try {
        diskSource = readFileSync(absolutePath, "utf8");
      } catch (error) {
        throw new Error(
          `Unable to read the Motion source module at ${absolutePath}.`,
          { cause: error },
        );
      }
      if (diskSource !== code) return null;

      const modulePath = path
        .relative(root, absolutePath)
        .split(path.sep)
        .join("/");
      if (
        !modulePath ||
        modulePath === ".." ||
        modulePath.startsWith("../") ||
        modulePath
          .split("/")
          .some((segment) =>
            ["node_modules", ".vite", "dist", "build"].includes(segment),
          )
      ) {
        return null;
      }

      if (!code.includes("<")) return null;

      let syntaxTree: BabelNode;
      try {
        syntaxTree = parse(code, {
          plugins: extension === ".tsx" ? ["jsx", "typescript"] : ["jsx"],
          sourceType: "unambiguous",
        }) as unknown as BabelNode;
      } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
      }

      const sourceHash = createHash("sha256").update(diskSource).digest("hex");
      const magic = new MagicString(code, { filename: absolutePath });
      let hostElementOrdinal = 0;
      let changed = false;

      const visit = (node: BabelNode): void => {
        if (node.type === "JSXElement") {
          const opening = asBabelNode(node.openingElement);
          const tag = asBabelNode(opening?.name);
          if (
            opening?.type === "JSXOpeningElement" &&
            tag?.type === "JSXIdentifier" &&
            typeof tag.name === "string" &&
            isMotionSourceHostElementTag(tag.name)
          ) {
            const ordinal = hostElementOrdinal++;
            const properties = Array.isArray(opening.attributes)
              ? opening.attributes
                  .map(asBabelNode)
                  .filter(
                    (property): property is BabelNode => property !== null,
                  )
              : [];
            const hasSpread = properties.some(
              (property) => property.type === "JSXSpreadAttribute",
            );
            const attributes = new Map<string, BabelNode[]>();
            for (const property of properties) {
              if (property.type !== "JSXAttribute") continue;
              const name = asBabelNode(property.name);
              if (
                name?.type !== "JSXIdentifier" ||
                typeof name.name !== "string"
              ) {
                continue;
              }
              const matching = attributes.get(name.name) ?? [];
              matching.push(property);
              attributes.set(name.name, matching);
            }

            const isStaticStringAttribute = (property: BabelNode): boolean => {
              const value = asBabelNode(property.value);
              return (
                value?.type === "StringLiteral" &&
                typeof value.value === "string"
              );
            };
            const staticStringValue = (
              property: BabelNode | undefined,
            ): string | undefined => {
              const value = property ? asBabelNode(property.value) : null;
              return value?.type === "StringLiteral" &&
                typeof value.value === "string"
                ? value.value
                : undefined;
            };
            const idAttributes = attributes.get(NODE_ID_ATTRIBUTE) ?? [];
            const hasDynamicNodeId =
              idAttributes.length > 0 &&
              (idAttributes.length !== 1 ||
                !isStaticStringAttribute(idAttributes[0]!));
            const authoredNodeId =
              idAttributes.length === 1 && !hasDynamicNodeId
                ? staticStringValue(idAttributes[0])
                : undefined;
            const nodeId =
              authoredNodeId ?? generatedMotionNodeId(modulePath, ordinal);
            const malformedReservedAttribute = [
              NODE_ID_ATTRIBUTE,
              SOURCE_FILE_ATTRIBUTE,
              SOURCE_HASH_ATTRIBUTE,
            ].some((name) => {
              const matches = attributes.get(name) ?? [];
              return (
                matches.length > 1 ||
                (matches.length === 1 && !isStaticStringAttribute(matches[0]!))
              );
            });

            if (
              !hasSpread &&
              !hasDynamicNodeId &&
              !malformedReservedAttribute &&
              /^[A-Za-z0-9_-]+$/.test(nodeId)
            ) {
              const expectedAttributes = [
                ...(!authoredNodeId
                  ? [[NODE_ID_ATTRIBUTE, nodeId] as const]
                  : []),
                [SOURCE_FILE_ATTRIBUTE, modulePath] as const,
                [SOURCE_HASH_ATTRIBUTE, sourceHash] as const,
              ];
              for (const [name, value] of expectedAttributes) {
                const existing = attributes.get(name) ?? [];
                if (existing.length === 0) {
                  const insertionPoint = properties.at(-1)?.end ?? tag.end;
                  if (typeof insertionPoint !== "number") {
                    throw new Error(
                      `Unable to locate JSX attributes in ${absolutePath}.`,
                    );
                  }
                  magic.appendLeft(
                    insertionPoint,
                    ` ${name}=${JSON.stringify(value)}`,
                  );
                  changed = true;
                  continue;
                }
                const attribute = existing[0]!;
                const start = attribute.start;
                const end = attribute.end;
                if (
                  existing.length !== 1 ||
                  !isStaticStringAttribute(attribute) ||
                  typeof start !== "number" ||
                  typeof end !== "number"
                ) {
                  continue;
                }
                if (staticStringValue(attribute) !== value) {
                  magic.update(start, end, `${name}=${JSON.stringify(value)}`);
                  changed = true;
                }
              }
            }
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const child of value) {
              const astChild = asBabelNode(child);
              if (astChild) visit(astChild);
            }
          } else {
            const astChild = asBabelNode(value);
            if (astChild) visit(astChild);
          }
        }
      };
      const program = asBabelNode(syntaxTree.program);
      if (!program) return null;
      visit(program);
      if (!changed) return null;

      return {
        code: magic.toString(),
        map: magic.generateMap({
          hires: "boundary",
          includeContent: true,
          source: modulePath,
        }),
      };
    },
  };
}

function asBabelNode(value: unknown): BabelNode | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("type" in value) ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  return value as BabelNode;
}
