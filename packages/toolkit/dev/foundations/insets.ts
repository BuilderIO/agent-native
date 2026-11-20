const TOLERANCE = 0.5;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function union(boxes: readonly Box[]): Box | null {
  const [first, ...rest] = boxes;
  if (first === undefined) return null;
  return rest.reduce(
    (all, box) => ({
      left: Math.min(all.left, box.left),
      right: Math.max(all.right, box.right),
      top: Math.min(all.top, box.top),
      bottom: Math.max(all.bottom, box.bottom),
    }),
    first,
  );
}

function textBox(root: Element): Box | null {
  const field = root.matches("input, textarea")
    ? root
    : root.querySelector("input, textarea");
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement
  ) {
    const rect = field.getBoundingClientRect();
    const style = getComputedStyle(field);
    return union([
      {
        left: rect.left + parseFloat(style.paddingLeft),
        right: rect.right - parseFloat(style.paddingRight),
        top: rect.top,
        bottom: rect.bottom,
      },
      ...textNodeBoxes(root),
    ]);
  }
  return union(textNodeBoxes(root));
}

function textNodeBoxes(root: Element): Box[] {
  const boxes: Box[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.textContent ?? "").trim() === "") continue;
    if (node.parentElement?.closest("[aria-hidden='true'], .visually-hidden")) {
      continue;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    boxes.push(...range.getClientRects());
  }
  return boxes;
}

function glyphBoxes(root: Element): DOMRect[] {
  return [...root.querySelectorAll("svg")]
    .filter((svg) => !svg.closest(".visually-hidden"))
    .map((svg) => svg.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => a.left - b.left);
}

export interface InsetFinding {
  probe: string;
  check: string;
  expected: number;
  actual: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Measures one part against the inset rule: a glyph at an edge sits the
 * glyph inset from that edge and from the text beside it, and is centered
 * vertically; text at an edge sits the text inset from it.
 */
export function measureInsets(
  probe: string,
  root: Element,
  textInset: number,
  glyphInset: number,
): InsetFinding[] {
  const findings: InsetFinding[] = [];
  const check = (name: string, expected: number, actual: number) => {
    if (!(Math.abs(expected - actual) <= TOLERANCE)) {
      findings.push({
        probe,
        check: name,
        expected: round(expected),
        actual: round(actual),
      });
    }
  };
  const box = root.getBoundingClientRect();
  const glyphs = glyphBoxes(root);
  const text = textBox(root);
  for (const glyph of glyphs) {
    check(
      "glyph centered vertically",
      (box.height - glyph.height) / 2,
      glyph.top - box.top,
    );
  }
  const first = glyphs.at(0);
  const last = glyphs.at(-1);
  if (text === null) {
    if (first !== undefined) {
      check(
        "glyph centered horizontally",
        (box.width - first.width) / 2,
        first.left - box.left,
      );
    }
    return findings;
  }
  if (first !== undefined && first.right <= text.left) {
    check("glyph start inset", glyphInset, first.left - box.left);
    check("glyph-to-text gap", glyphInset, text.left - first.right);
  } else {
    check("text start inset", textInset, text.left - box.left);
  }
  const endFree = root.getAttribute("data-inset-end") === "free";
  if (last !== undefined && last.left >= text.right) {
    check("glyph end inset", glyphInset, box.right - last.right);
    if (!endFree) {
      check("text-to-glyph gap", glyphInset, last.left - text.right);
    }
  } else if (!endFree) {
    check("text end inset", textInset, box.right - text.right);
  }
  return findings;
}

/** The glyph inset: --space-2 in a 32px control or row, --space-1 below. */
export function glyphInsetFor(root: Element): number {
  const style = getComputedStyle(root);
  const token = root.getBoundingClientRect().height >= 32 ? "2" : "1";
  return parseFloat(style.getPropertyValue(`--space-${token}`));
}

/** The text inset of the control size whose height matches the part's. */
export function textInsetFor(root: Element): number {
  const style = getComputedStyle(root);
  const height = root.getBoundingClientRect().height;
  const size = ["1", "2", "3", "4"].find(
    (step) =>
      parseFloat(style.getPropertyValue(`--control-height-${step}`)) === height,
  );
  return size === undefined
    ? Number.NaN
    : parseFloat(style.getPropertyValue(`--control-padding-x-${size}`));
}

/**
 * Every `[data-inset-probe]` part in the container, measured. A probe on a
 * field's own input measures the frame that draws the field.
 */
export function measureAllInsets(container: ParentNode): InsetFinding[] {
  return [...container.querySelectorAll("[data-inset-probe]")].flatMap(
    (probe) => {
      const root = probe.matches("input, textarea")
        ? (probe.closest(".input, .text-area") ?? probe)
        : probe;
      return measureInsets(
        probe.getAttribute("data-inset-probe") ?? "",
        root,
        textInsetFor(root),
        glyphInsetFor(root),
      );
    },
  );
}
