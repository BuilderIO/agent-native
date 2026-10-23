import { lexer, parse, type CssNode } from "css-tree";

export type EmailTextColor =
  | { kind: "resolved"; alpha: number }
  | { kind: "inherit" }
  | { kind: "initial" }
  | { kind: "unsupported" };

const ABSOLUTE_COLOR_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
]);

function alphaValue(node: CssNode): EmailTextColor {
  if (node.type !== "Number" && node.type !== "Percentage")
    return { kind: "unsupported" };
  const alpha = Number(node.value) / (node.type === "Percentage" ? 100 : 1);
  return Number.isFinite(alpha)
    ? { kind: "resolved", alpha: Math.max(0, Math.min(1, alpha)) }
    : { kind: "unsupported" };
}

export function classifyEmailTextColor(
  value: string | undefined,
): EmailTextColor {
  if (!value?.trim()) return { kind: "inherit" };
  try {
    const ast = parse(value, { context: "value" });
    if (ast.type !== "Value" || ast.children.size !== 1)
      return { kind: "unsupported" };
    const node = ast.children.first!;
    if (node.type === "Identifier") {
      const name = node.name.toLowerCase();
      if (["currentcolor", "inherit", "unset"].includes(name))
        return { kind: "inherit" };
      if (name === "initial") return { kind: "initial" };
      if (name === "transparent") return { kind: "resolved", alpha: 0 };
    }
    if (!lexer.matchType("color", ast).matched) return { kind: "unsupported" };
    if (node.type === "Identifier") return { kind: "resolved", alpha: 1 };
    if (node.type === "Hash") {
      const alpha =
        node.value.length === 4
          ? Number.parseInt(node.value.slice(-1), 16) / 15
          : node.value.length === 8
            ? Number.parseInt(node.value.slice(-2), 16) / 255
            : 1;
      return { kind: "resolved", alpha };
    }
    if (
      node.type !== "Function" ||
      !ABSOLUTE_COLOR_FUNCTIONS.has(node.name.toLowerCase())
    )
      return { kind: "unsupported" };
    const parts = node.children.toArray();
    if (
      parts.some(
        (part) =>
          part.type === "Function" ||
          (part.type === "Identifier" && part.name.toLowerCase() === "from"),
      )
    )
      return { kind: "unsupported" };
    const slash = parts.findIndex(
      (part) => part.type === "Operator" && part.value === "/",
    );
    if (slash !== -1) return alphaValue(parts[slash + 1]);
    const commas = parts.filter(
      (part) => part.type === "Operator" && part.value === ",",
    ).length;
    return commas === 3
      ? alphaValue(parts[parts.length - 1])
      : { kind: "resolved", alpha: 1 };
  } catch {
    return { kind: "unsupported" };
  }
}
