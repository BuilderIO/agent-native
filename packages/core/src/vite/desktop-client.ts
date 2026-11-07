import { parse } from "@babel/parser";
import MagicString from "magic-string";
import type { Plugin } from "vite";

/** Build-time switch shared by the CLI, router config, and Vite plugin. */
export function isDesktopClientBuild(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AGENT_NATIVE_CLIENT_ONLY === "1";
}

export function desktopClientBasePath(
  env: Record<string, string | undefined> = process.env,
): string {
  if (!isDesktopClientBuild(env)) return "/";
  const value = env.VITE_APP_BASE_PATH ?? "/";
  if (!value.startsWith("/") || value.startsWith("//") || /[?#\\]/.test(value))
    throw new Error("Desktop client base must be an absolute URL path");
  return value;
}

export function desktopClientRouteSource(
  code: string,
  filename: string,
): string {
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const names = new Set<string>();
  for (const node of ast.program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;
    const declaration = node.declaration;
    if (declaration?.type === "FunctionDeclaration" && declaration.id)
      names.add(declaration.id.name);
    if (declaration?.type === "VariableDeclaration") {
      for (const item of declaration.declarations)
        if (item.id.type === "Identifier") names.add(item.id.name);
    }
    for (const item of node.specifiers) {
      if (item.type === "ExportSpecifier")
        names.add(
          item.exported.type === "Identifier"
            ? item.exported.name
            : item.exported.value,
        );
    }
  }
  const serverNames = new Set(["loader", "action", "headers"]);
  if (
    [...serverNames].some((name) => names.has(name)) &&
    !names.has("clientLoader")
  ) {
    throw new Error(
      `Desktop client build: ${filename} needs an explicit clientLoader before server exports can be removed.`,
    );
  }
  if (names.has("action") && !names.has("clientAction")) {
    throw new Error(
      `Desktop client build: ${filename} needs a clientAction equivalent.`,
    );
  }
  const output = new MagicString(code);
  for (const node of ast.program.body) {
    if (
      node.type !== "ExportNamedDeclaration" ||
      node.start == null ||
      node.end == null
    )
      continue;
    const declaration = node.declaration;
    if (declaration) {
      const declared =
        declaration.type === "FunctionDeclaration" && declaration.id
          ? [declaration.id.name]
          : declaration.type === "VariableDeclaration"
            ? declaration.declarations.flatMap((item) =>
                item.id.type === "Identifier" ? [item.id.name] : [],
              )
            : [];
      if (declared.some((name) => serverNames.has(name))) {
        if (
          declared.some((name) => !serverNames.has(name)) ||
          declaration.start == null
        ) {
          throw new Error(
            `Desktop client build: split mixed server/client export declarations in ${filename}.`,
          );
        }
        output.remove(node.start, declaration.start);
      }
    } else {
      const kept = node.specifiers.filter(
        (item) =>
          item.type !== "ExportSpecifier" ||
          !serverNames.has(
            item.exported.type === "Identifier"
              ? item.exported.name
              : item.exported.value,
          ),
      );
      if (kept.length === node.specifiers.length) continue;
      const text = kept
        .map((item) => code.slice(item.start ?? 0, item.end ?? 0))
        .join(", ");
      output.overwrite(
        node.start,
        node.end,
        kept.length
          ? `export { ${text} }${node.source ? ` from ${JSON.stringify(node.source.value)}` : ""};`
          : "",
      );
    }
  }
  return output.toString();
}

export function desktopClientPlugin(): Plugin {
  return {
    name: "agent-native:desktop-client",
    enforce: "pre",
    transform(code, id) {
      const filename = id.split("?")[0] ?? id;
      if (
        !isDesktopClientBuild() ||
        !/\/app\/(?:routes\/.*|root)\.[jt]sx?$/.test(filename) ||
        /\.(?:spec|test)\./.test(filename)
      )
        return null;
      return { code: desktopClientRouteSource(code, filename), map: null };
    },
  };
}
