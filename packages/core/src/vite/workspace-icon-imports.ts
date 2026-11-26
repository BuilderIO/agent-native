import { parse } from "@babel/parser";
import MagicString from "magic-string";

function rangeOf(node: {
  start?: number | null | undefined;
  end?: number | null | undefined;
}): [number, number] {
  if (typeof node.start !== "number" || typeof node.end !== "number")
    throw new Error("Parsed import node is missing its source range");
  return [node.start, node.end];
}

/** Keep initial named icons independent of a later full-catalog namespace. */
export async function rewriteWorkspaceIconImports(
  code: string,
  id: string,
  canResolve: (specifier: string) => Promise<boolean>,
) {
  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch (error) {
    // Import shortening is optional. Leave syntax owned by other transforms
    // untouched instead of turning an optimization into a build failure.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const output = new MagicString(code);
  let changed = false;
  for (const node of ast.program.body) {
    if (
      node.type !== "ImportDeclaration" ||
      node.importKind === "type" ||
      Boolean(node.attributes?.length) ||
      !/^@tabler\/icons-react(?:\/dist\/esm\/(?:tabler-icons-react|icons\/index)\.mjs)?$/.test(
        node.source.value,
      )
    )
      continue;
    const retained: string[] = [];
    const replacements: string[] = [];
    for (const specifier of node.specifiers) {
      const name =
        specifier.type === "ImportSpecifier" &&
        specifier.imported.type === "Identifier"
          ? specifier.imported.name
          : null;
      const leaf =
        name && /^Icon[A-Z0-9]\w*$/.test(name)
          ? `@tabler/icons-react/dist/esm/icons/${name}.mjs`
          : null;
      if (
        leaf &&
        specifier.type === "ImportSpecifier" &&
        specifier.importKind !== "type" &&
        (await canResolve(leaf))
      ) {
        replacements.push(
          `import ${specifier.local.name} from ${JSON.stringify(leaf)};`,
        );
      } else {
        retained.push(code.slice(...rangeOf(specifier)));
      }
    }
    if (!replacements.length) continue;
    // Namespace/default imports and non-icon exports retain their exact source.
    const remaining = node.specifiers.filter((s) =>
      retained.includes(code.slice(...rangeOf(s))),
    );
    const defaults = remaining
      .filter((s) => s.type === "ImportDefaultSpecifier")
      .map((s) => s.local.name);
    const namespaces = remaining
      .filter((s) => s.type === "ImportNamespaceSpecifier")
      .map((s) => `* as ${s.local.name}`);
    const named = remaining
      .filter((s) => s.type === "ImportSpecifier")
      .map((s) => code.slice(...rangeOf(s)));
    const clauses = [
      ...defaults,
      ...namespaces,
      ...(named.length ? [`{ ${named.join(", ")} }`] : []),
    ];
    if (clauses.length)
      replacements.push(
        `import ${clauses.join(", ")} from ${JSON.stringify(node.source.value)};`,
      );
    output.overwrite(...rangeOf(node), replacements.join("\n"));
    changed = true;
  }
  return changed
    ? {
        code: output.toString(),
        map: output.generateMap({
          hires: true,
          source: id,
          includeContent: true,
        }),
      }
    : null;
}
