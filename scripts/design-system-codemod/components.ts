import ts from "typescript";

import type { Edits } from "./edits.ts";
import {
  classNames,
  containsJsx,
  elementOf,
  findAttr,
  hasSpread,
  HEIGHT_CLASS,
  insideForm,
  type JsxTag,
  meaningfulChildren,
  readAttr,
} from "./jsx.ts";
import { toastComponent } from "./toast.ts";
import type {
  Analysis,
  ComponentDef,
  ComponentName,
  ImportName,
  SiteContext,
} from "./types.ts";

const TOOLKIT_UI = "@agent-native/toolkit/ui";
const BASE_UI = `${TOOLKIT_UI}/base-ui`;

function skip(reason: string): Analysis {
  return { ok: false, reason };
}

function editTag(
  edits: Edits,
  tag: JsxTag,
  {
    remove = [],
    add = [],
    rename,
  }: {
    remove?: (ts.JsxAttribute | null)[];
    add?: string[];
    rename?: string;
  },
) {
  for (const attribute of remove) {
    if (attribute) edits.add(attribute.getFullStart(), attribute.end, "");
  }
  if (rename) renameTag(edits, tag, rename);
  if (add.length > 0) {
    edits.add(tag.tagName.end, tag.tagName.end, ` ${add.join(" ")}`);
  }
}

function renameTag(edits: Edits, tag: JsxTag, name: string) {
  edits.add(tag.tagName.getStart(), tag.tagName.end, name);
  if (ts.isJsxOpeningElement(tag)) {
    const closing = tag.parent.closingElement.tagName;
    edits.add(closing.getStart(), closing.end, name);
  }
}

function heightClasses(tag: JsxTag): string[] | null {
  const className = readAttr(tag, "className");
  if (className.kind === "absent") return [];
  if (className.kind !== "string") return null;
  return classNames(className.value).filter((name) => HEIGHT_CLASS.test(name));
}

function heightReview(tag: JsxTag): string[] {
  const classes = heightClasses(tag);
  return classes && classes.length > 0
    ? [
        `className sets a height (${classes.join(" ")}) that now fights the size prop`,
      ]
    : [];
}

function localFor(context: SiteContext, next: string): string {
  return context.local === context.imported ? next : context.local;
}

const BUTTON_VARIANTS: Readonly<Record<string, string[] | "link">> = {
  default: [],
  destructive: ['color="danger"'],
  outline: ['variant="surface"', 'color="gray"'],
  "outline-destructive": ['variant="surface"', 'color="danger"'],
  secondary: ['variant="soft"', 'color="gray"'],
  ghost: ['variant="ghost"', 'color="gray"'],
  "ghost-inset": ['variant="ghost"', 'color="gray"'],
  link: "link",
};

type ControlSize = "sm" | "md";

const BUTTON_SIZES: Readonly<
  Record<string, { size: ControlSize; icon: boolean; legacyPx: number }>
> = {
  xs: { size: "md", icon: false, legacyPx: 24 },
  sm: { size: "md", icon: false, legacyPx: 32 },
  default: { size: "md", icon: false, legacyPx: 36 },
  lg: { size: "md", icon: false, legacyPx: 40 },
  icon: { size: "md", icon: true, legacyPx: 36 },
  "icon-xs": { size: "md", icon: true, legacyPx: 24 },
  "icon-sm": { size: "md", icon: true, legacyPx: 32 },
  "icon-lg": { size: "md", icon: true, legacyPx: 40 },
};

const CONTROL_SIZE_PX: Readonly<Record<ControlSize, number>> = {
  sm: 20,
  md: 24,
};

const DEFAULT_CONTROL_SIZE = "md";

const LINK_TAGS = new Set(["a", "Link", "NavLink"]);

function isLinkTag(tag: JsxTag, source: ts.SourceFile): boolean {
  return (
    LINK_TAGS.has(tag.tagName.getText(source)) ||
    findAttr(tag, "href") !== null ||
    findAttr(tag, "to") !== null
  );
}

function buttonJsx(tag: JsxTag, context: SiteContext): Analysis {
  if (hasSpread(tag)) {
    return skip("spread props may carry variant, size or asChild");
  }
  for (const legacy of ["intent", "emphasis"]) {
    if (findAttr(tag, legacy)) return skip(`legacy \`${legacy}\` prop`);
  }
  const variant = readAttr(tag, "variant");
  const size = readAttr(tag, "size");
  const asChild = readAttr(tag, "asChild");
  if (variant.kind !== "absent" && variant.kind !== "string") {
    return skip("variant isn't a string literal");
  }
  if (size.kind !== "absent" && size.kind !== "string") {
    return skip("size isn't a string literal");
  }
  if (asChild.kind !== "absent" && asChild.kind !== "boolean") {
    return skip("asChild isn't a literal");
  }
  const variantName = variant.kind === "string" ? variant.value : "default";
  const sizeName = size.kind === "string" ? size.value : "default";
  const variantProps = new Map(Object.entries(BUTTON_VARIANTS)).get(
    variantName,
  );
  const sizeProps = new Map(Object.entries(BUTTON_SIZES)).get(sizeName);
  if (variantProps === undefined) {
    return skip(`unknown variant "${variantName}"`);
  }
  if (variantProps === "link") {
    return skip('variant="link" becomes the Link component by hand');
  }
  if (sizeProps === undefined) return skip(`unknown size "${sizeName}"`);

  const reviews = [...heightReview(tag)];
  const newPx = CONTROL_SIZE_PX[sizeProps.size];
  if (newPx !== sizeProps.legacyPx) {
    reviews.push(
      `size "${sizeName}" was ${sizeProps.legacyPx}px and is now ${newPx}px`,
    );
  }
  if (variantName === "ghost-inset") {
    reviews.push('variant="ghost-inset" is now a plain ghost; inset is gone');
  }
  const isAsChild = asChild.kind === "boolean" && asChild.value;
  const element = elementOf(tag);
  let child: ts.JsxElement | ts.JsxSelfClosingElement | null = null;
  if (isAsChild) {
    if (!ts.isJsxElement(element)) return skip("asChild with no child");
    const children = meaningfulChildren(element);
    const only = children.at(0);
    if (
      children.length !== 1 ||
      only === undefined ||
      !(ts.isJsxElement(only) || ts.isJsxSelfClosingElement(only))
    ) {
      return skip("asChild child isn't a single element");
    }
    child = only;
    const onlyTag = ts.isJsxElement(only) ? only.openingElement : only;
    if (containsJsx(onlyTag.attributes)) {
      return skip("asChild child's props hold JSX");
    }
  }

  const childTag =
    child === null
      ? null
      : ts.isJsxElement(child)
        ? child.openingElement
        : child;
  const isLink = childTag !== null && isLinkTag(childTag, context.source);
  if (isLink && findAttr(tag, "disabled")) {
    reviews.push(
      "a link has no disabled state; render text or a Button instead",
    );
  }

  const add: string[] = [
    ...variantProps,
    ...(sizeProps.size === DEFAULT_CONTROL_SIZE
      ? []
      : [`size="${sizeProps.size}"`]),
  ];
  const base = sizeProps.icon ? "IconButton" : "Button";
  const partName = isLink ? `${base}Link` : base;
  let name = context.local;
  if (sizeProps.icon || isLink) {
    if (context.nameInUse(partName)) {
      return skip(`${partName} is already a name in this file`);
    }
    name = partName;
  }
  if (sizeProps.icon) {
    const named = (candidate: JsxTag) =>
      ["aria-label", "title", "aria-labelledby"].some(
        (attribute) => findAttr(candidate, attribute) !== null,
      );
    if (!named(tag) && !(isLink && named(childTag))) {
      reviews.push("IconButton has no aria-label or title; it needs a name");
    }
  }
  if (
    !isAsChild &&
    !findAttr(tag, "type") &&
    (insideForm(tag) || findAttr(tag, "form"))
  ) {
    add.push('type="submit"');
  }

  const uses: ImportName[] = [
    sizeProps.icon || isLink
      ? { imported: partName, local: partName }
      : { imported: "Button", local: context.local },
  ];
  return {
    ok: true,
    uses,
    reviews,
    build(edits) {
      if (child && childTag) {
        const tagText = childTag.tagName.getText(context.source);
        const attributes = edits
          .slice(childTag.attributes.pos, childTag.attributes.end)
          .trim();
        if (isLink && tagText === "a") {
          if (attributes) add.push(attributes);
        } else {
          add.push(
            `render={<${tagText}${attributes ? ` ${attributes}` : ""} />}`,
          );
          if (!isLink && tagText !== "button") {
            add.push("nativeButton={false}");
          }
        }
        if (ts.isJsxElement(child)) {
          edits.add(
            child.openingElement.getStart(),
            child.openingElement.end,
            "",
          );
          edits.add(
            child.closingElement.getStart(),
            child.closingElement.end,
            "",
          );
        } else {
          edits.add(child.getStart(), child.end, "");
        }
      }
      editTag(edits, tag, {
        remove: [
          findAttr(tag, "variant"),
          findAttr(tag, "size"),
          findAttr(tag, "asChild"),
        ],
        add,
        ...(name === context.local ? {} : { rename: name }),
      });
    },
  };
}

const BADGE_VARIANTS: Readonly<Record<string, string[]>> = {
  default: ['variant="solid"'],
  secondary: ['variant="soft"', 'color="gray"'],
  destructive: ['variant="solid"', 'color="danger"'],
  outline: ['variant="outline"', 'color="gray"'],
};

const BADGE_SIZES: Readonly<Record<string, string[]>> = {
  default: [],
  sm: [],
};

function badgeJsx(tag: JsxTag): Analysis {
  if (hasSpread(tag)) return skip("spread props may carry variant or size");
  const variant = readAttr(tag, "variant");
  const size = readAttr(tag, "size");
  if (variant.kind !== "absent" && variant.kind !== "string") {
    return skip("variant isn't a string literal");
  }
  if (size.kind !== "absent" && size.kind !== "string") {
    return skip("size isn't a string literal");
  }
  const variantProps = new Map(Object.entries(BADGE_VARIANTS)).get(
    variant.kind === "string" ? variant.value : "default",
  );
  const sizeProps = new Map(Object.entries(BADGE_SIZES)).get(
    size.kind === "string" ? size.value : "default",
  );
  if (!variantProps) return skip("unknown variant");
  if (!sizeProps) return skip("unknown size");
  const className = readAttr(tag, "className");
  const reviews =
    className.kind === "absent"
      ? []
      : ["className may restyle what variant and color now set"];
  return {
    ok: true,
    uses: [{ imported: "Badge", local: "Badge" }],
    reviews,
    build(edits) {
      editTag(edits, tag, {
        remove: [findAttr(tag, "variant"), findAttr(tag, "size")],
        add: [...variantProps, ...sizeProps],
      });
    },
  };
}

const NOT_TEXT_TYPES = new Set([
  "checkbox",
  "radio",
  "range",
  "file",
  "color",
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
]);

function slotText(
  attribute: ts.JsxAttribute,
  side: "left" | "right",
  context: SiteContext,
  edits: Edits,
): string {
  const initializer = attribute.initializer;
  let content = "";
  if (
    initializer &&
    ts.isJsxExpression(initializer) &&
    initializer.expression
  ) {
    const expression = initializer.expression;
    const text = edits.slice(
      expression.getStart(context.source),
      expression.end,
    );
    content =
      ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression)
        ? text
        : `{${text}}`;
  } else if (initializer) {
    content = `{${initializer.getText(context.source)}}`;
  }
  return `<InputSlot side="${side}">${content}</InputSlot>`;
}

function inputJsx(tag: JsxTag, context: SiteContext): Analysis {
  if (hasSpread(tag)) return skip("spread props may carry size");
  const size = readAttr(tag, "size");
  if (size.kind !== "absent" && size.kind !== "string") {
    return skip("size isn't a string literal");
  }
  if (
    size.kind === "string" &&
    size.value !== "sm" &&
    size.value !== "default"
  ) {
    return skip(`unknown size "${size.value}"`);
  }
  const type = readAttr(tag, "type");
  if (type.kind === "string" && NOT_TEXT_TYPES.has(type.value)) {
    return skip(`type="${type.value}" isn't a text field`);
  }
  const leading = findAttr(tag, "leading");
  const trailing = findAttr(tag, "trailing");
  const slots = Boolean(leading || trailing);
  if (slots && !ts.isJsxSelfClosingElement(tag)) {
    return skip("Input with leading or trailing has children");
  }
  if (slots && context.nameInUse("InputSlot")) {
    return skip("InputSlot is already a name in this file");
  }
  const uses: ImportName[] = [{ imported: "Input", local: context.local }];
  if (slots) uses.push({ imported: "InputSlot", local: "InputSlot" });
  return {
    ok: true,
    uses,
    reviews: heightReview(tag),
    build(edits) {
      if (slots && ts.isJsxSelfClosingElement(tag)) {
        const children = [
          leading ? slotText(leading, "left", context, edits) : "",
          trailing ? slotText(trailing, "right", context, edits) : "",
        ].join("");
        edits.add(
          tag.attributes.end,
          tag.end,
          `>${children}</${tag.tagName.getText(context.source)}>`,
        );
      }
      editTag(edits, tag, {
        remove: [findAttr(tag, "size"), leading, trailing],
      });
    },
  };
}

function textAreaJsx(tag: JsxTag, context: SiteContext): Analysis {
  const local = localFor(context, "TextArea");
  if (local !== context.local && context.nameInUse(local)) {
    return skip(`${local} is already a name in this file`);
  }
  return {
    ok: true,
    uses: [{ imported: "TextArea", local }],
    reviews: [],
    build(edits) {
      editTag(edits, tag, {
        ...(local === context.local ? {} : { rename: local }),
      });
    },
  };
}

function skeletonJsx(tag: JsxTag, context: SiteContext): Analysis {
  if (
    findAttr(tag, "children") ||
    (ts.isJsxOpeningElement(tag) && meaningfulChildren(tag.parent).length > 0)
  ) {
    return skip(
      "Skeleton with children now takes its child's shape instead of wrapping it",
    );
  }
  return {
    ok: true,
    uses: [{ imported: "Skeleton", local: context.local }],
    reviews: [],
    build() {},
  };
}

function spacingPx(token: string): number | null {
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(token);
  if (arbitrary?.[1]) return Number(arbitrary[1]);
  if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token) * 4;
  return null;
}

function spinnerSizeClasses(
  classes: string[],
): { remove: string[]; px: number | null } | { error: string } {
  const remove: string[] = [];
  let size: number | null = null;
  let height: number | null = null;
  let width: number | null = null;
  for (const name of classes) {
    const match = /^(size|h|w)-(.+)$/.exec(name);
    if (!match) {
      if (/^[a-z0-9-]+:(?:size|h|w)-/.test(name)) {
        return { error: `responsive size class ${name}` };
      }
      continue;
    }
    const [, kind, value = ""] = match;
    const px = spacingPx(value);
    if (px === null) return { error: `size class ${name} isn't a fixed size` };
    remove.push(name);
    if (kind === "size") size = px;
    else if (kind === "h") height = px;
    else width = px;
  }
  if (size !== null && (height !== null || width !== null)) {
    return { error: "both size- and h-/w- classes" };
  }
  if (size !== null) return { remove, px: size };
  if (height !== null || width !== null) {
    if (height !== width) return { error: "height and width classes differ" };
    return { remove, px: height };
  }
  return { remove, px: null };
}

const SPINNER_DIAMETER = 16;

const CUBE_LOADER_PROPS = [
  "stroke",
  "strokeWidth",
  "absoluteStrokeWidth",
  "width",
  "height",
  "role",
  "children",
];

function spinnerJsx(tag: JsxTag, context: SiteContext): Analysis {
  if (hasSpread(tag)) return skip("spread props may carry size or className");
  if (
    ts.isJsxOpeningElement(tag) &&
    meaningfulChildren(tag.parent).length > 0
  ) {
    return skip("Spinner with children");
  }
  for (const name of CUBE_LOADER_PROPS) {
    if (findAttr(tag, name)) return skip(`CubeLoader prop \`${name}\``);
  }
  const reviews: string[] = [];
  const sizeAttr = readAttr(tag, "size");
  const className = readAttr(tag, "className");
  let px: number | null = null;
  let removeClasses: string[] = [];
  if (className.kind !== "absent" && className.kind !== "string") {
    return skip("className isn't a string literal, so its size can't be read");
  }
  if (className.kind === "string") {
    const sized = spinnerSizeClasses(classNames(className.value));
    if ("error" in sized) return skip(sized.error);
    removeClasses = sized.remove;
    px = sized.px;
  }
  if (sizeAttr.kind !== "absent") {
    if (px !== null) return skip("both a size prop and a size class");
    if (sizeAttr.kind === "number") px = sizeAttr.value;
    else if (sizeAttr.kind === "string" && /^\d+(px)?$/.test(sizeAttr.value)) {
      px = Number.parseInt(sizeAttr.value, 10);
    } else return skip("size isn't a pixel literal");
  }
  const diameter = px ?? 16;
  if (diameter < 10 || diameter > 18) {
    return skip(
      `${diameter}px is too far from the Spinner's ${SPINNER_DIAMETER}px`,
    );
  }
  if (diameter !== SPINNER_DIAMETER) {
    reviews.push(`${diameter}px becomes the Spinner's ${SPINNER_DIAMETER}px`);
  }

  const label = findAttr(tag, "aria-label") ?? findAttr(tag, "title");
  if (findAttr(tag, "aria-label") && findAttr(tag, "title")) {
    return skip("both aria-label and title");
  }
  const hidden = findAttr(tag, "aria-hidden");
  if (!label && !hidden) {
    reviews.push(
      'was announced as "Loading"; it is decorative now, so give it a label if nothing else names the wait',
    );
  }
  const keptClasses =
    className.kind === "string"
      ? classNames(className.value).filter(
          (name) => !removeClasses.includes(name),
        )
      : [];
  return {
    ok: true,
    uses: [{ imported: "Spinner", local: context.local }],
    reviews,
    build(edits) {
      const classAttr = findAttr(tag, "className");
      if (classAttr && removeClasses.length > 0) {
        if (keptClasses.length === 0) {
          edits.add(classAttr.getFullStart(), classAttr.end, "");
        } else {
          const value = classAttr.initializer;
          if (value) {
            edits.add(
              value.getStart(),
              value.end,
              `"${keptClasses.join(" ")}"`,
            );
          }
        }
      }
      if (label) edits.add(label.name.getStart(), label.name.end, "label");
      editTag(edits, tag, {
        remove: [findAttr(tag, "size"), hidden],
        add: [],
      });
    },
  };
}

export const COMPONENTS: Readonly<Record<ComponentName, ComponentDef>> = {
  button: {
    name: "button",
    legacy: [`${TOOLKIT_UI}/button`],
    next: `${BASE_UI}/button`,
    names: {
      Button: "Button",
      ButtonBase: null,
      buttonVariants: null,
      buttonPartProps: null,
      ButtonProps: null,
      ButtonEmphasis: null,
    },
    jsx: buttonJsx,
  },
  badge: {
    name: "badge",
    legacy: [`${TOOLKIT_UI}/badge`],
    next: `${BASE_UI}/badge`,
    names: { Badge: "Badge", badgeVariants: null, BadgeProps: null },
    jsx: badgeJsx,
  },
  input: {
    name: "input",
    legacy: [`${TOOLKIT_UI}/input`],
    next: `${BASE_UI}/input`,
    names: { Input: "Input" },
    jsx: inputJsx,
  },
  "text-area": {
    name: "text-area",
    legacy: [`${TOOLKIT_UI}/textarea`],
    next: `${BASE_UI}/text-area`,
    names: { Textarea: "TextArea", TextareaProps: null },
    jsx: textAreaJsx,
  },
  skeleton: {
    name: "skeleton",
    legacy: [`${TOOLKIT_UI}/skeleton`],
    next: `${BASE_UI}/skeleton`,
    names: { Skeleton: "Skeleton" },
    jsx: skeletonJsx,
  },
  spinner: {
    name: "spinner",
    legacy: [`${TOOLKIT_UI}/spinner`],
    next: `${BASE_UI}/spinner`,
    names: { Spinner: "Spinner" },
    jsx: spinnerJsx,
  },
  toast: toastComponent(`${BASE_UI}/toast`, [`${TOOLKIT_UI}/sonner`, "sonner"]),
};
