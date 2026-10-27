import { parse, walk } from "css-tree";

const BROWSER_FUNCTIONS = new Set([
  "var",
  "expression",
  "image",
  "image-set",
  "-webkit-image-set",
]);

export function inspectEmailCssValue(
  value: string,
): "supported" | "browser" | "invalid" {
  try {
    const ast = parse(value, {
      context: "value",
      parseCustomProperty: true,
      onParseError(error) {
        throw error;
      },
    });
    if (ast.type !== "Value" || ast.children.isEmpty) return "invalid";
    let browser = false;
    walk(ast, (node) => {
      if (
        node.type === "Url" ||
        (node.type === "Function" &&
          BROWSER_FUNCTIONS.has(node.name.toLowerCase()))
      )
        browser = true;
    });
    return browser ? "browser" : "supported";
  } catch {
    return "invalid";
  }
}
