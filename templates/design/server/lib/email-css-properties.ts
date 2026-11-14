import { ident } from "css-tree";

const SIDES = ["top", "right", "bottom", "left"];
const BORDER_COMPONENTS = ["width", "style", "color"];
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
const shorthands = new Map<string, string[]>([
  [
    "border-image",
    ["source", "slice", "width", "outset", "repeat"].map(
      (part) => `border-image-${part}`,
    ),
  ],
  ["border-radius", CORNERS.map((corner) => `border-${corner}-radius`)],
  [
    "background",
    [
      "image",
      "position",
      "size",
      "repeat",
      "origin",
      "clip",
      "attachment",
      "color",
    ].map((part) => `background-${part}`),
  ],
  ["background-position", ["background-position-x", "background-position-y"]],
  ["background-repeat", ["background-repeat-x", "background-repeat-y"]],
  ["outline", ["outline-width", "outline-style", "outline-color"]],
  [
    "list-style",
    ["list-style-type", "list-style-position", "list-style-image"],
  ],
  [
    "text-decoration",
    ["line", "style", "color", "thickness"].map(
      (part) => `text-decoration-${part}`,
    ),
  ],
  ["overflow", ["overflow-x", "overflow-y"]],
  ["columns", ["column-width", "column-count", "column-height"]],
  [
    "column-rule",
    ["column-rule-width", "column-rule-style", "column-rule-color"],
  ],
]);
const physicalAliases = new Map<string, string[]>();

for (const family of ["padding", "margin", "inset"]) {
  const sides = SIDES.map((side) =>
    family === "inset" ? side : `${family}-${side}`,
  );
  shorthands.set(family, sides);
  for (const axis of ["block", "inline"]) {
    const edges = ["start", "end"].map((edge) => `${family}-${axis}-${edge}`);
    shorthands.set(`${family}-${axis}`, edges);
    for (const edge of edges) physicalAliases.set(edge, sides);
  }
}

shorthands.set("border", [
  ...SIDES.map((side) => `border-${side}`),
  "border-image",
]);
for (const side of SIDES) {
  shorthands.set(
    `border-${side}`,
    BORDER_COMPONENTS.map((part) => `border-${side}-${part}`),
  );
}
for (const part of BORDER_COMPONENTS) {
  shorthands.set(
    `border-${part}`,
    SIDES.map((side) => `border-${side}-${part}`),
  );
}
for (const axis of ["block", "inline"]) {
  const edges = ["start", "end"].map((edge) => `border-${axis}-${edge}`);
  shorthands.set(`border-${axis}`, edges);
  for (const part of BORDER_COMPONENTS) {
    shorthands.set(
      `border-${axis}-${part}`,
      edges.map((edge) => `${edge}-${part}`),
    );
  }
  for (const edge of edges) {
    const parts = BORDER_COMPONENTS.map((part) => `${edge}-${part}`);
    shorthands.set(edge, parts);
    for (const part of BORDER_COMPONENTS) {
      physicalAliases.set(
        `${edge}-${part}`,
        SIDES.map((side) => `border-${side}-${part}`),
      );
    }
  }
  physicalAliases.set(`overflow-${axis}`, ["overflow-x", "overflow-y"]);
}
for (const block of ["start", "end"]) {
  for (const inline of ["start", "end"]) {
    physicalAliases.set(
      `border-${block}-${inline}-radius`,
      CORNERS.map((corner) => `border-${corner}-radius`),
    );
  }
}

function longhands(property: string): string[] {
  return shorthands.get(property)?.flatMap(longhands) ?? [property];
}

function normalize(property: string): string {
  const decoded = ident.decode(property.trim());
  return decoded.startsWith("--") ? decoded : decoded.toLowerCase();
}

// This compares property coverage, not whether two authored values are equivalent.
export function propertiesOverlap(first: string, second: string): boolean {
  const firstProperties = longhands(normalize(first));
  const secondProperties = longhands(normalize(second));
  return firstProperties.some((left) =>
    secondProperties.some(
      (right) =>
        left === right ||
        physicalAliases.get(left)?.includes(right) ||
        physicalAliases.get(right)?.includes(left),
    ),
  );
}
