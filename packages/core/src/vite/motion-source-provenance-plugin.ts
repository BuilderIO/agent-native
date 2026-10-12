import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import MagicString from "magic-string";
import type { Plugin, ResolvedConfig } from "vite";

import {
  generatedMotionNodeId,
  isMotionSourceHostElementTag,
} from "../shared/motion-source-node-id.js";

const NODE_ID_ATTRIBUTE = "data-agent-native-node-id";
const SOURCE_FILE_ATTRIBUTE = "data-agent-native-motion-source-file";
const SOURCE_HASH_ATTRIBUTE = "data-agent-native-motion-source-hash";

type TypeScriptApi = {
  ScriptKind: { JSX: number; TSX: number };
  ScriptTarget: { Latest: number };
  createSourceFile: (
    fileName: string,
    sourceText: string,
    languageVersion: number,
    setParentNodes: boolean,
    scriptKind: number,
  ) => any;
  isIdentifier: (node: unknown) => boolean;
  isJsxAttribute: (node: unknown) => boolean;
  isJsxElement: (node: unknown) => boolean;
  isJsxSelfClosingElement: (node: unknown) => boolean;
  isJsxSpreadAttribute: (node: unknown) => boolean;
  isStringLiteral: (node: unknown) => boolean;
  forEachChild: (node: unknown, callback: (child: any) => void) => void;
};

/** Adds dev-only JSX identity evidence so source edits follow rendered nodes. */
export function motionSourceProvenancePlugin(): Plugin {
  let root = process.cwd();
  let command: ResolvedConfig["command"] = "serve";
  let ts: TypeScriptApi | null | undefined;

  return {
    name: "agent-native-motion-source-provenance",
    enforce: "pre",
    configResolved(config) {
      root = path.resolve(config.root);
      command = config.command;
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

      ts ??= loadTypeScript(root);
      if (!ts || !code.includes("<")) return null;

      const sourceFile = ts.createSourceFile(
        absolutePath,
        code,
        ts.ScriptTarget.Latest,
        true,
        extension === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.JSX,
      );
      if (sourceFile.parseDiagnostics?.length) return null;

      const sourceHash = createHash("sha256").update(diskSource).digest("hex");
      const magic = new MagicString(code, { filename: absolutePath });
      let hostElementOrdinal = 0;
      let changed = false;

      const visit = (node: any): void => {
        if (ts!.isJsxElement(node) || ts!.isJsxSelfClosingElement(node)) {
          const opening = ts!.isJsxElement(node) ? node.openingElement : node;
          const tag = opening.tagName;
          if (ts!.isIdentifier(tag) && isMotionSourceHostElementTag(tag.text)) {
            const ordinal = hostElementOrdinal++;
            const properties = opening.attributes.properties as any[];
            const hasSpread = properties.some((property) =>
              ts!.isJsxSpreadAttribute(property),
            );
            const attributes = new Map<string, any[]>();
            for (const property of properties) {
              if (!ts!.isJsxAttribute(property)) continue;
              const name = property.name.getText(sourceFile);
              const matching = attributes.get(name) ?? [];
              matching.push(property);
              attributes.set(name, matching);
            }

            const idAttributes = attributes.get(NODE_ID_ATTRIBUTE) ?? [];
            const hasDynamicNodeId =
              idAttributes.length > 0 &&
              (idAttributes.length !== 1 ||
                !idAttributes[0].initializer ||
                !ts!.isStringLiteral(idAttributes[0].initializer));
            const authoredNodeId =
              idAttributes.length === 1 && !hasDynamicNodeId
                ? idAttributes[0].initializer.text
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
                (matches.length === 1 &&
                  (!matches[0].initializer ||
                    !ts!.isStringLiteral(matches[0].initializer)))
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
                  magic.appendLeft(
                    opening.attributes.end,
                    ` ${name}=${JSON.stringify(value)}`,
                  );
                  changed = true;
                  continue;
                }
                if (
                  existing.length !== 1 ||
                  !existing[0].initializer ||
                  !ts!.isStringLiteral(existing[0].initializer)
                ) {
                  continue;
                }
                if (existing[0].initializer.text !== value) {
                  magic.update(
                    existing[0].getStart(sourceFile),
                    existing[0].end,
                    `${name}=${JSON.stringify(value)}`,
                  );
                  changed = true;
                }
              }
            }
          }
        }
        ts!.forEachChild(node, visit);
      };
      visit(sourceFile);
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

function loadTypeScript(root: string): TypeScriptApi | null {
  const require = createRequire(path.join(root, "package.json"));
  for (const name of ["typescript", "typescript-7"]) {
    try {
      return require(name) as TypeScriptApi;
    } catch (error) {
      if (!isMissingPackage(error, name)) throw error;
      // JSX provenance is optional in a dev server without a TypeScript parser.
    }
  }
  return null;
}

function isMissingPackage(error: unknown, name: string): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const missingPackage = error.message.match(
    /Cannot find module ['"]([^'"]+)['"]/,
  );
  return (
    (error as Error & { code?: unknown }).code === "MODULE_NOT_FOUND" &&
    missingPackage?.[1] === name
  );
}
