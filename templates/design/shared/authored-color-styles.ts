/**
 * Read the colour each property was authored with, walking the cascade. A
 * generated design styles through classes, so `el.style` is empty and computed
 * has already flattened `var()`. Dependency-free: bundled into the bridge.
 */

const AUTHORED_COLOR_PROPERTIES = [
  "color",
  "backgroundColor",
  "borderColor",
  "outlineColor",
  // Not colours themselves, but the only place a shadow's colour keeps its name.
  "boxShadow",
  "textShadow",
] as const;

/**
 * A shorthand holding `var()` cannot be expanded, so CSSOM serialises its
 * longhands as "" — indistinguishable from unset.
 */
const SHORTHAND_FALLBACK: Record<string, string> = {
  backgroundColor: "background",
  borderColor: "border",
  outlineColor: "outline",
};

/** Colours these inherit from an ancestor when no rule targets the element. */
const INHERITED_PROPERTIES = ["color"];

/**
 * Expanding a shorthand emits these for the longhands it resets, so treating
 * them as authored would print "initial" in the fill row.
 */
const RESET_KEYWORDS = new Set([
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
]);

function isAuthoredColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    !RESET_KEYWORDS.has(value.trim().toLowerCase())
  );
}

const LINE_STYLE_KEYWORDS = new Set([
  "none",
  "hidden",
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
]);

const LINE_WIDTH = /^(thin|medium|thick|-?\d*\.?\d+[a-z%]*)$/i;

/** Split on spaces outside parentheses, so a `var()` fallback stays intact. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth === 0 && /\s/.test(char)) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * The colour component of a `border`/`outline` shorthand. Width and style are
 * a closed keyword set, so whatever single value is left over is the colour —
 * without this, `border: 1px solid var(--x)` loses its token name.
 */
function lineShorthandColor(value: string): string | null {
  const rest = splitTopLevel(value).filter((part) => {
    const lower = part.toLowerCase();
    return !LINE_STYLE_KEYWORDS.has(lower) && !LINE_WIDTH.test(part);
  });
  return rest.length === 1 ? rest[0] : null;
}

/**
 * A shorthand only stands in for the colour when it isolates one. Exported for
 * tests: a real engine leaves the longhand empty here, which happy-dom does not
 * reproduce, so the wiring alone cannot exercise this.
 */
export function shorthandColorValue(
  shorthand: string,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/url\(|gradient\(/i.test(trimmed)) return null;
  // A single `var()` may contain spaces (its fallback); anything else with a
  // space is a layered shorthand, not a colour.
  if (/^var\(.*\)$/.test(trimmed)) return trimmed;
  if (shorthand === "border" || shorthand === "outline") {
    return lineShorthandColor(trimmed);
  }
  return /\s/.test(trimmed) ? null : trimmed;
}

type StyleRuleLike = {
  selectorText?: string;
  style?: Record<string, string> & {
    getPropertyPriority?: (property: string) => string;
  };
  conditionText?: string;
  cssRules?: ArrayLike<unknown>;
};

/**
 * Approximate CSS specificity as one comparable number. Approximate is safe:
 * it only orders selectors that already match, and `authoredMatchesPainted`
 * still discards a winner that is not what paints. `:is()`/`:not()` inner
 * specificity is not counted.
 */
function selectorSpecificity(selector: string): number {
  const cleaned = selector
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, " :attr ")
    .replace(/\(([^()]*)\)/g, " ");
  const count = (pattern: RegExp) => (cleaned.match(pattern) ?? []).length;
  const ids = count(/#[\w-]+/g);
  const classes = count(/\.[\w-]+/g) + count(/:(?!:)[\w-]+/g);
  const types = count(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) + count(/::[\w-]+/g);
  return ids * 10000 + classes * 100 + types;
}

/** Specificity of the selector in a comma list that actually matches. */
function matchedSpecificity(element: Element, selectorText: string): number {
  let best = -1;
  for (const selector of selectorText.split(",")) {
    const trimmed = selector.trim();
    if (!trimmed) continue;
    try {
      if (!element.matches(trimmed)) continue;
    } catch {
      continue;
    }
    best = Math.max(best, selectorSpecificity(trimmed));
  }
  return best;
}

interface Candidate {
  value: string;
  important: boolean;
  specificity: number;
  order: number;
}

/** Cascade order for declarations that all match: important, then specificity. */
function beats(next: Candidate, current: Candidate | undefined): boolean {
  if (!current) return true;
  if (next.important !== current.important) return next.important;
  if (next.specificity !== current.specificity) {
    return next.specificity > current.specificity;
  }
  return next.order >= current.order;
}

function readRules(
  element: Element,
  rules: ArrayLike<unknown> | undefined,
  out: Record<string, Candidate>,
  counter: { order: number },
): void {
  if (!rules) return;
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index] as StyleRuleLike | undefined;
    if (!rule) continue;

    // Only while it applies, so this matches what the canvas paints.
    if (rule.cssRules && rule.conditionText !== undefined) {
      let applies = false;
      try {
        applies =
          typeof window !== "undefined" &&
          typeof window.matchMedia === "function"
            ? window.matchMedia(rule.conditionText).matches
            : false;
      } catch {
        applies = false;
      }
      if (applies) readRules(element, rule.cssRules, out, counter);
      continue;
    }

    if (!rule.selectorText || !rule.style) continue;
    const specificity = matchedSpecificity(element, rule.selectorText);
    if (specificity < 0) continue;
    const order = counter.order++;
    const style = rule.style;
    const priority = (name: string) =>
      style.getPropertyPriority?.(name) === "important";

    const offer = (property: string, value: string, cssName: string) => {
      const candidate: Candidate = {
        value,
        important: priority(cssName),
        specificity,
        order,
      };
      if (beats(candidate, out[property])) out[property] = candidate;
    };

    for (const property of AUTHORED_COLOR_PROPERTIES) {
      const declared = style[property];
      if (isAuthoredColor(declared)) {
        offer(property, declared, cssPropertyName(property));
        continue;
      }
      const shorthand = SHORTHAND_FALLBACK[property];
      if (!shorthand) continue;
      const shorthandValue = style[shorthand];
      if (typeof shorthandValue !== "string") continue;
      const colorOnly = shorthandColorValue(shorthand, shorthandValue);
      if (colorOnly) offer(property, colorOnly, shorthand);
    }
  }
}

function cssPropertyName(property: string): string {
  return property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * Whether `authored` actually resolves to the colour the element paints.
 *
 * Without this an ancestor's `color: var(--color-text)` gets reported for a
 * child painted green by its own utility class — a confidently wrong token name,
 * which is worse than showing the hex. Resolved via a probe child so var()
 * chains and shorthands are evaluated in the element's own scope.
 */
export function authoredMatchesPainted(
  element: Element,
  property: string,
  authored: string,
): boolean {
  const view = element.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== "function") return true;

  let painted = "";
  try {
    painted =
      (view.getComputedStyle(element) as unknown as Record<string, string>)[
        property
      ] ?? "";
  } catch {
    return true;
  }
  if (!painted) return true;

  const probe = element.ownerDocument!.createElement("span");
  const name = cssPropertyName(property);
  probe.style.setProperty("display", "none");
  probe.style.setProperty(name, authored);
  // An unparseable value never lands, and the probe would then just inherit the
  // element's own colour and compare equal.
  if (!probe.style.getPropertyValue(name)) return false;

  element.appendChild(probe);
  let resolved = "";
  try {
    resolved =
      (view.getComputedStyle(probe) as unknown as Record<string, string>)[
        property
      ] ?? "";
  } catch {
    resolved = "";
  }
  probe.remove();

  return resolved === "" || resolved === painted;
}

function collectForElement(element: Element): Record<string, string> {
  const ranked: Record<string, Candidate> = {};
  const counter = { order: 0 };

  try {
    const doc = element.ownerDocument;
    // Adopted sheets are not in `styleSheets`, and a runtime CSS injector (the
    // Tailwind CDN) puts every utility rule there.
    const sheets = [
      ...Array.from(doc?.styleSheets ?? []),
      ...Array.from(
        (doc as unknown as { adoptedStyleSheets?: ArrayLike<CSSStyleSheet> })
          ?.adoptedStyleSheets ?? [],
      ),
    ];
    for (const sheet of sheets) {
      let rules: ArrayLike<unknown> | undefined;
      try {
        rules = sheet.cssRules as unknown as ArrayLike<unknown>;
      } catch {
        // A cross-origin sheet cannot be read; skip it.
        continue;
      }
      readRules(element, rules, ranked, counter);
    }
  } catch (error) {
    // Silently losing the walk downgrades every token colour to a hex.
    console.warn(
      "[design] could not read stylesheets for authored colours; token names will fall back to resolved values",
      error,
    );
  }

  const out: Record<string, string> = {};
  for (const [property, candidate] of Object.entries(ranked)) {
    out[property] = candidate.value;
  }

  // Inline beats every rule, so it is applied last.
  const inline = (element as HTMLElement).style;
  if (inline) {
    for (const property of AUTHORED_COLOR_PROPERTIES) {
      const value = inline[property as never] as unknown as string;
      if (isAuthoredColor(value)) out[property] = value;
    }
  }

  return out;
}

export function collectAuthoredColorStyles(
  element: Element,
): Record<string, string> {
  const out = collectForElement(element);
  for (const property of Object.keys(out)) {
    if (!authoredMatchesPainted(element, property, out[property])) {
      delete out[property];
    }
  }

  // `color` is inherited: a heading with no rule of its own still has a token.
  for (const property of INHERITED_PROPERTIES) {
    if (out[property]) continue;
    let ancestor = element.parentElement;
    while (ancestor) {
      const inherited = collectForElement(ancestor)[property];
      if (inherited) {
        if (authoredMatchesPainted(element, property, inherited)) {
          out[property] = inherited;
        }
        break;
      }
      ancestor = ancestor.parentElement;
    }
  }

  return out;
}
