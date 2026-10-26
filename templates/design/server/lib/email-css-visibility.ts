import { lexer, parse } from "css-tree";

export type EmailVisibilityDeclaration = { prop: string; value: string };

function zeroExtentAxes({ prop, value }: EmailVisibilityDeclaration): number {
  const dimension = prop.toLowerCase().match(/^(?:max-)?(width|height)$/)?.[1];
  if (!dimension || !lexer.matchType("length-percentage", value).matched)
    return 0;
  const ast = parse(value, { context: "value" });
  if (ast.type !== "Value" || ast.children.size !== 1) return 0;
  const node = ast.children.first!;
  return ["Number", "Dimension", "Percentage"].includes(node.type) &&
    "value" in node &&
    Number(node.value) === 0
    ? dimension === "width"
      ? 1
      : 2
    : 0;
}

function overflowAxes({ prop, value }: EmailVisibilityDeclaration): number {
  const property = prop.toLowerCase();
  if (
    !/^overflow(?:-[xy])?$/.test(property) ||
    !lexer.matchProperty(property, value).matched
  )
    return 0;
  const ast = parse(value, { context: "value" });
  if (ast.type !== "Value") return 0;
  const nodes = ast.children.toArray();
  if (
    !nodes.length ||
    nodes.length > (property === "overflow" ? 2 : 1) ||
    nodes.some((node) => node.type !== "Identifier")
  )
    return 0;
  const values = nodes.map((node) =>
    node.type === "Identifier" ? node.name.toLowerCase() : "",
  );
  if (
    values.some(
      (entry) =>
        !["visible", "hidden", "clip", "auto", "scroll"].includes(entry),
    )
  )
    return 0;
  // A scrolling overflow axis also makes the other axis's default visible compute to auto.
  if (values.some((entry) => ["hidden", "auto", "scroll"].includes(entry)))
    return 3;
  if (property === "overflow-x") return values[0] === "clip" ? 1 : 0;
  if (property === "overflow-y") return values[0] === "clip" ? 2 : 0;
  return (
    (values[0] === "clip" ? 1 : 0) |
    ((values[1] ?? values[0]) === "clip" ? 2 : 0)
  );
}

export function canClipText(declaration: EmailVisibilityDeclaration): boolean {
  return !!(zeroExtentAxes(declaration) || overflowAxes(declaration));
}

export function hasClippedText(
  declarations: Iterable<EmailVisibilityDeclaration>,
): boolean {
  let zeroAxes = 0;
  let clippedAxes = 0;
  for (const declaration of declarations) {
    zeroAxes |= zeroExtentAxes(declaration);
    clippedAxes |= overflowAxes(declaration);
  }
  return !!(zeroAxes & clippedAxes);
}
