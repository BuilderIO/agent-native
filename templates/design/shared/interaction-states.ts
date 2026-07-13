/**
 * Managed element interaction-state block for the Design Studio.
 *
 * Element-level pseudo-class states (hover / focus / focus-visible / active /
 * disabled) — NOT to be confused with `design-state.ts` / `StatesPanel`,
 * which model whole-*screen* app states (Loading / Empty / Error, data
 * fixtures, live captures). This module edits ONE element's interactive
 * styling; that one edits which named app-level scenario the whole canvas is
 * showing. Both features coexist: a screen state (e.g. "Empty") and an
 * element interaction state (e.g. "Hover" on a button) are independent axes.
 *
 * Base overrides persist into a managed
 * `<style data-agent-native-states>` block as real, plain CSS pseudo-class
 * rules — readable and editable in the Code panel, and portable to any HTML
 * export with zero runtime dependency:
 *
 *   [data-agent-native-node-id="btn_1"]:hover {
 *     background-color: #111827;
 *   }
 *
 * State edits made in a narrower responsive frame persist separately in
 * `<style data-agent-native-state-breakpoints>` as ordinary max-width media
 * rules. That keeps (for example) mobile Hover independent from base Hover
 * while remaining portable to generated HTML and Alpine.js with no runtime.
 *
 * Follows the managed-block conventions of `breakpoint-media.ts` /
 * `motion-compiler.ts`:
 * - **Deterministic**: same model → byte-identical CSS. Node ids, states, and
 *   properties are sorted alphabetically; responsive buckets run widest to
 *   narrowest, and states within a node id follow the
 *   fixed `STATE_ORDER` (hover → focus → focus-visible → active → disabled)
 *   so cascade order is stable and predictable when two states could both
 *   apply (e.g. `:hover` and `:focus` at once).
 * - **Targets by node id**: rules use `[data-agent-native-node-id="<id>"]`
 *   selectors — no class/id coupling, consistent with breakpoint overrides
 *   and motion keyframes.
 * - **No dependencies**, pure string transforms. SSR-safe (no DOM APIs).
 *
 * ─── Forced-preview mechanism (the phase-2 bridge contract) ─────────────────
 *
 * The canvas iframe cannot reliably fake `:hover`/`:focus`/`:active` browser
 * pseudo-classes on demand (no real pointer is over the element, focus would
 * steal keyboard input, `:active` requires a held mouse button). Instead,
 * `duplicateStatePreviewRules(html)` derives a **parallel twin rule** for
 * every managed state rule, keyed off a plain HTML attribute instead of the
 * pseudo-class:
 *
 *   [data-agent-native-node-id="btn_1"]:hover { background-color: #111827; }
 *   [data-agent-native-node-id="btn_1"][data-an-state-preview="hover"] {
 *     background-color: #111827;
 *   }
 *
 * The twin rules are appended inside the SAME managed
 * `<style data-agent-native-states>` block (so exported/standalone HTML
 * always carries them — no separate stylesheet, no extra bridge script).
 * Forcing a live preview of element `btn_1`'s Hover state is then just:
 *
 *   element.setAttribute("data-an-state-preview", "hover")
 *
 * ...and clearing it is just removing that attribute. No JS re-evaluation of
 * styles, no class toggling per property, no iframe-side CSS generation —
 * the bridge's entire job is setting/clearing one attribute on the selected
 * element whenever the inspector's active state changes. This module owns
 * generating/refreshing the twin rules whenever a state rule changes; the
 * bridge and DesignEditor own driving the attribute (phase 2).
 *
 * ─── Transitions ─────────────────────────────────────────────────────────────
 *
 * `transition` (and longhand `transition-*` properties) are ordinary CSS
 * properties on the BASE element, not part of any state rule — they belong
 * whichever way the base element's styling is already authored (inline
 * `style` attribute or a class), same as any other non-interactive property.
 * This module does not special-case them: set `transition: background-color
 * 150ms ease` on the base element (via the existing inline-style / EditPanel
 * commit path) and the managed `:hover` rule above will animate exactly as
 * authored, in both the real `:hover` path and the forced-preview twin path
 * (since the twin rule only changes which selector matches — the transition
 * on the base element still applies either way).
 */

// ─── Model ────────────────────────────────────────────────────────────────────

/** Supported element interaction states, in fixed cascade/display order. */
export const INTERACTION_STATES = [
  "hover",
  "focus",
  "focus-visible",
  "active",
  "disabled",
] as const;

export type InteractionState = (typeof INTERACTION_STATES)[number];

const STATE_SET: ReadonlySet<string> = new Set(INTERACTION_STATES);

export function isInteractionState(
  value: string | null | undefined,
): value is InteractionState {
  return typeof value === "string" && STATE_SET.has(value);
}

/**
 * Parsed managed block: node id → state → CSS property → value. Plain
 * nested records so callers can serialize/diff cheaply.
 */
export type InteractionStatesModel = Record<
  string,
  Partial<Record<InteractionState, Record<string, string>>>
>;

/** Responsive state overrides: max-width bound → regular state model. */
export type ResponsiveInteractionStatesModel = Record<
  string,
  InteractionStatesModel
>;

/** One flattened managed rule, as returned by {@link listAllInteractionStateDeclarations}. */
export interface InteractionStateDeclaration {
  nodeId: string;
  state: InteractionState;
  property: string;
  value: string;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const CSS_VALUE_BREAKOUT_RE = /[;{}<>]|\/\*|\*\/|\burl\s*\(/i;
const CSS_VALUE_CONTROL_RE = /[\u0000-\u001f\u007f]/;

/**
 * Reject caller-supplied CSS values before interpolation into the managed
 * stylesheet. Allows useful CSS functions (`calc(...)`, `var(...)`,
 * `rgb(...)`) but blocks declaration/rule breakouts and remote-resource
 * hooks — same policy as the managed breakpoint/motion blocks.
 */
export function isSafeInteractionStateCssValue(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (CSS_VALUE_CONTROL_RE.test(value) || CSS_VALUE_BREAKOUT_RE.test(value)) {
    return false;
  }
  return true;
}

/** Valid (optionally vendor-prefixed) CSS property identifier. */
export function isSafeInteractionStateCssProperty(property: string): boolean {
  return /^(?:--[a-zA-Z_][a-zA-Z0-9_-]*|-?[a-zA-Z][a-zA-Z0-9-]*)$/.test(
    property,
  );
}

// ─── HTML block extraction / injection ───────────────────────────────────────

const OPEN_RE = /<style\b(?=[^>]*\bdata-agent-native-states\b)[^>]*>/i;
const RESPONSIVE_OPEN_RE =
  /<style\b(?=[^>]*\bdata-agent-native-state-breakpoints\b)[^>]*>/i;

/**
 * Extract the CSS body of the managed `<style data-agent-native-states>`
 * block (includes both the real pseudo-class rules and their forced-preview
 * twins — both live in the same block). Returns `null` when the document has
 * no managed block.
 */
export function extractManagedInteractionStateCss(html: string): string | null {
  const openMatch = OPEN_RE.exec(html);
  if (!openMatch) return null;
  const bodyStart = openMatch.index + openMatch[0].length;
  const afterOpen = html.slice(bodyStart);
  const closeMatch = /<\s*\/\s*style\b[^>]*>/i.exec(afterOpen);
  if (!closeMatch) return null;
  return afterOpen.slice(0, closeMatch.index).trim();
}

/**
 * Inject or replace the managed block. Inserts before `</head>` when no
 * managed block exists, or at the top of the document when there is no
 * `<head>`. Passing empty CSS removes the block entirely.
 */
export function injectManagedInteractionStateCss(
  html: string,
  css: string,
): string {
  const openMatch = OPEN_RE.exec(html);
  const trimmed = css.trim();
  const block =
    trimmed.length > 0
      ? `<style data-agent-native-states>\n${trimmed}\n</style>`
      : "";

  if (openMatch) {
    const bodyStart = openMatch.index + openMatch[0].length;
    const afterOpen = html.slice(bodyStart);
    const closeMatch = /<\s*\/\s*style\b[^>]*>/i.exec(afterOpen);
    if (closeMatch) {
      const closeEnd = bodyStart + closeMatch.index + closeMatch[0].length;
      // Removing the block: also swallow one trailing newline so repeated
      // add/remove cycles don't accumulate blank lines.
      if (block === "") {
        const after = html.slice(closeEnd);
        return html.slice(0, openMatch.index) + after.replace(/^\n/, "");
      }
      return html.slice(0, openMatch.index) + block + html.slice(closeEnd);
    }
  }

  if (block === "") return html;
  const headClose = html.lastIndexOf("</head>");
  if (headClose !== -1) {
    return html.slice(0, headClose) + block + "\n" + html.slice(headClose);
  }
  return block + "\n" + html;
}

/** Extract the responsive interaction-state managed block. */
export function extractManagedResponsiveInteractionStateCss(
  html: string,
): string | null {
  return extractManagedStyleBody(html, RESPONSIVE_OPEN_RE);
}

/** Inject, replace, or remove the responsive interaction-state block. */
export function injectManagedResponsiveInteractionStateCss(
  html: string,
  css: string,
): string {
  return injectManagedStyleBody(
    html,
    css,
    RESPONSIVE_OPEN_RE,
    "data-agent-native-state-breakpoints",
  );
}

// ─── CSS body parse / serialize ──────────────────────────────────────────────

/**
 * Matches ONE real pseudo-class state rule for a node id, e.g.
 * `[data-agent-native-node-id="btn_1"]:focus-visible { ... }`. Deliberately
 * does NOT match the `[data-an-state-preview="..."]` twin rules — those are
 * derived output, not source of truth, and are re-generated by
 * {@link duplicateStatePreviewRules} rather than parsed back in, so hand
 * edits to a twin rule in the Code panel don't fork state.
 */
function stateRuleRegex(): RegExp {
  return /\[data-agent-native-node-id="((?:\\.|[^"\\])*)"\]:(hover|focus-visible|focus|active|disabled)\s*\{([^}]*)\}/g;
}

/**
 * Parse a managed CSS body into the model. Tolerant of hand edits made in
 * the Code panel: unknown selectors (including the derived preview twins)
 * and invalid declarations are skipped, not errors.
 */
export function parseInteractionStatesCss(css: string): InteractionStatesModel {
  const model: InteractionStatesModel = {};
  const ruleRe = stateRuleRegex();
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(css)) !== null) {
    const nodeId = unescAttr(match[1]);
    const state = match[2];
    if (!nodeId || !isInteractionState(state)) continue;
    const declarations = match[3]
      .split(";")
      .map((decl) => decl.trim())
      .filter(Boolean);
    for (const declaration of declarations) {
      const colon = declaration.indexOf(":");
      if (colon <= 0) continue;
      const property = declaration.slice(0, colon).trim();
      // Managed declarations are serialized with `!important` so they can
      // override the inline base styles Design authors on canvas elements.
      // Keep that cascade implementation detail out of the persisted model:
      // inspector fields, diffs, and subsequent writes all operate on the
      // authored value (`red`), never `red !important`.
      const value = stripManagedImportant(declaration.slice(colon + 1));
      if (!isSafeInteractionStateCssProperty(property)) continue;
      if (!isSafeInteractionStateCssValue(value)) continue;
      model[nodeId] ??= {};
      const node = model[nodeId];
      node[state] ??= {};
      node[state]![property] = value;
    }
  }
  return model;
}

/**
 * Serialize the real pseudo-class rules (model → CSS body), sorted node id
 * then fixed state order then property, for byte-identical output. Does NOT
 * include the forced-preview twins — call {@link duplicateStatePreviewRules}
 * on the result (or use {@link serializeInteractionStatesModelWithPreviews})
 * to append those.
 */
export function serializeInteractionStatesModel(
  model: InteractionStatesModel,
): string {
  const nodeIds = Object.keys(model).sort((a, b) => a.localeCompare(b));
  const rules: string[] = [];
  for (const nodeId of nodeIds) {
    const states = model[nodeId];
    for (const state of INTERACTION_STATES) {
      const declarations = states[state];
      if (!declarations) continue;
      const properties = Object.keys(declarations).sort((a, b) =>
        a.localeCompare(b),
      );
      if (properties.length === 0) continue;
      const lines = properties.map(
        (property) =>
          `  ${property}: ${stripManagedImportant(declarations[property])} !important;`,
      );
      rules.push(
        `[data-agent-native-node-id="${escAttr(nodeId)}"]:${state} {\n` +
          `${lines.join("\n")}\n` +
          `}`,
      );
    }
  }
  return rules.join("\n\n");
}

/**
 * Rebuild a managed CSS body's real rules + forced-preview twins from
 * scratch, given the ALREADY-PARSED model. Re-serializing the real rules
 * (rather than reusing the raw input body verbatim) is what keeps this
 * idempotent: a body that already contains twins from a previous run parses
 * back to the same model (twins are excluded by {@link stateRuleRegex}), so
 * rebuilding from that model reproduces byte-identical output instead of
 * accumulating duplicate twin rules on every call.
 */
function rebuildCssWithPreviews(model: InteractionStatesModel): string {
  const baseBody = serializeInteractionStatesModel(model);
  const previewRules: string[] = [];
  const nodeIds = Object.keys(model).sort((a, b) => a.localeCompare(b));
  for (const nodeId of nodeIds) {
    const states = model[nodeId];
    for (const state of INTERACTION_STATES) {
      const declarations = states[state];
      if (!declarations) continue;
      const properties = Object.keys(declarations).sort((a, b) =>
        a.localeCompare(b),
      );
      if (properties.length === 0) continue;
      const lines = properties.map(
        (property) =>
          `  ${property}: ${stripManagedImportant(declarations[property])} !important;`,
      );
      previewRules.push(
        `[data-agent-native-node-id="${escAttr(nodeId)}"][data-an-state-preview="${state}"] {\n` +
          `${lines.join("\n")}\n` +
          `}`,
      );
    }
  }
  if (previewRules.length === 0) return baseBody;
  return baseBody === ""
    ? previewRules.join("\n\n")
    : `${baseBody}\n\n${previewRules.join("\n\n")}`;
}

/**
 * Convenience: model → complete CSS body (real rules + forced-preview
 * twins), ready to pass to {@link injectManagedInteractionStateCss}.
 */
export function serializeInteractionStatesModelWithPreviews(
  model: InteractionStatesModel,
): string {
  return rebuildCssWithPreviews(model);
}

/** Parse responsive `@media (max-width)` state rules from their own block. */
export function parseResponsiveInteractionStatesCss(
  css: string,
): ResponsiveInteractionStatesModel {
  const model: ResponsiveInteractionStatesModel = {};
  const mediaRe = /@media\s*\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = mediaRe.exec(css)) !== null) {
    const maxWidthPx = Math.round(Number.parseFloat(match[1]));
    if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) continue;
    const bodyStart = match.index + match[0].length;
    const body = extractCssBlock(css, bodyStart);
    if (body === null) continue;
    mediaRe.lastIndex = bodyStart + body.length + 1;
    // Responsive rules deliberately double the node attribute selector so
    // they beat a base state rule even if later editing moves/reinserts the
    // base managed block after this block. Collapse that deterministic
    // specificity boost before feeding the normal state parser.
    const parsed = parseInteractionStatesCss(
      body.replace(
        /(\[data-agent-native-node-id="(?:\\.|[^"\\])*"\])\1/g,
        "$1",
      ),
    );
    if (Object.keys(parsed).length > 0) model[String(maxWidthPx)] = parsed;
  }
  return model;
}

/**
 * Serialize responsive state rules widest-first so every narrower matching
 * bucket appears later and wins, mirroring the normal breakpoint cascade.
 */
export function serializeResponsiveInteractionStatesModel(
  model: ResponsiveInteractionStatesModel,
): string {
  return Object.keys(model)
    .map((key) => Number.parseInt(key, 10))
    .filter((bound) => Number.isFinite(bound) && bound > 0)
    .sort((a, b) => b - a)
    .flatMap((bound) => {
      const body = serializeResponsiveStateBucket(model[String(bound)] ?? {});
      if (!body) return [];
      return [
        `@media (max-width: ${bound}px) {\n${body
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}\n}`,
      ];
    })
    .join("\n\n");
}

/**
 * Regenerate the forced-preview twin rules for a whole document from its
 * current real state rules, and write the refreshed managed block back.
 * Idempotent: re-running it just recomputes byte-identical twins (rebuilt
 * from the parsed real-rule model, not by appending onto whatever twins were
 * already present). This is the function phase-2 callers reach for after any
 * state-rule mutation (or to backfill twins for a document that already has
 * real rules but was authored before this mechanism existed) — it never
 * touches anything outside the managed `<style data-agent-native-states>`
 * block.
 */
export function duplicateStatePreviewRules(html: string): string {
  const css = extractManagedInteractionStateCss(html);
  if (css === null) return html;
  const model = parseInteractionStatesCss(css);
  return injectManagedInteractionStateCss(html, rebuildCssWithPreviews(model));
}

// ─── High-level document operations ──────────────────────────────────────────

/**
 * Re-derive the managed block's CSS (real rules + fresh preview twins) from
 * its current real rules and write it back. Callers that mutate the model
 * directly should route through this instead of hand-assembling the CSS, so
 * the preview twins never drift from the real rules.
 */
function writeModel(html: string, model: InteractionStatesModel): string {
  return injectManagedInteractionStateCss(
    html,
    serializeInteractionStatesModelWithPreviews(model),
  );
}

/** Read the current model out of the document (real rules only). */
function readModel(html: string): InteractionStatesModel {
  return parseInteractionStatesCss(
    extractManagedInteractionStateCss(html) ?? "",
  );
}

function readResponsiveModel(html: string): ResponsiveInteractionStatesModel {
  return parseResponsiveInteractionStatesCss(
    extractManagedResponsiveInteractionStateCss(html) ?? "",
  );
}

/**
 * List every state that has at least one declaration for `nodeId`, in fixed
 * `INTERACTION_STATES` order. Empty array when the node has no overrides.
 */
export function listInteractionStates(
  html: string,
  nodeId: string,
): InteractionState[] {
  const model = readModel(html);
  const responsive = readResponsiveModel(html);
  return INTERACTION_STATES.filter((state) => {
    const declarations = model[nodeId]?.[state];
    if (declarations && Object.keys(declarations).length > 0) return true;
    return Object.values(responsive).some((bucket) => {
      const scoped = bucket[nodeId]?.[state];
      return scoped && Object.keys(scoped).length > 0;
    });
  });
}

/**
 * All declared CSS properties/values for one node's state. Returns `{}` when
 * there is no managed block, node, or state entry.
 */
export function readStateStyles(
  html: string,
  nodeId: string,
  state: InteractionState,
): Record<string, string> {
  const model = readModel(html);
  return { ...(model[nodeId]?.[state] ?? {}) };
}

/**
 * Resolve a state's inspector values at a concrete viewport: base state
 * declarations first, then every matching responsive bucket widest→narrowest.
 */
export function readResolvedStateStyles(
  html: string,
  nodeId: string,
  state: InteractionState,
  viewportWidthPx?: number | null,
): Record<string, string> {
  const resolved = readStateStyles(html, nodeId, state);
  if (
    viewportWidthPx == null ||
    !Number.isFinite(viewportWidthPx) ||
    viewportWidthPx <= 0
  ) {
    return resolved;
  }
  const responsive = readResponsiveModel(html);
  const matchingBounds = Object.keys(responsive)
    .map((key) => Number.parseInt(key, 10))
    .filter((bound) => bound >= viewportWidthPx)
    .sort((a, b) => b - a);
  for (const bound of matchingBounds) {
    Object.assign(resolved, responsive[String(bound)]?.[nodeId]?.[state] ?? {});
  }
  return resolved;
}

/**
 * Set (or overwrite) one managed declaration for a node's state, returning
 * the updated HTML. Throws on unsafe property/value — the caller decides how
 * to surface that (same contract as `setBreakpointMediaDeclaration`).
 */
export function upsertStateStyle(
  html: string,
  nodeId: string,
  state: InteractionState,
  property: string,
  value: string,
): string {
  return upsertStateStyles(html, nodeId, state, { [property]: value });
}

/**
 * Batched form of {@link upsertStateStyle} — sets multiple declarations for
 * one node's state in a single parse/serialize/inject pass. Prefer this over
 * multiple sequential `upsertStateStyle` calls when committing more than one
 * property at once (e.g. a shorthand expansion), matching the
 * `onStylesChange` batched-commit convention used elsewhere in EditPanel.
 */
export function upsertStateStyles(
  html: string,
  nodeId: string,
  state: InteractionState,
  styles: Record<string, string>,
): string {
  if (!nodeId) throw new Error("upsertStateStyles requires a nodeId.");
  if (!isInteractionState(state)) {
    throw new Error(`Invalid interaction state: "${state}".`);
  }
  const normalized = normalizeStateStyles(styles);
  const model = readModel(html);
  model[nodeId] ??= {};
  const node = model[nodeId];
  node[state] = { ...(node[state] ?? {}), ...normalized };
  return writeModel(html, model);
}

/**
 * Persist one state override at a responsive max-width bound. This is the
 * state-aware counterpart of `setBreakpointMediaDeclaration`; callers must
 * use it whenever both an interaction state and a non-base breakpoint are
 * active so a narrow-frame edit never leaks globally.
 */
export function upsertResponsiveStateStyles(
  html: string,
  nodeId: string,
  state: InteractionState,
  maxWidthPx: number,
  styles: Record<string, string>,
): string {
  if (!nodeId)
    throw new Error("upsertResponsiveStateStyles requires a nodeId.");
  if (!isInteractionState(state)) {
    throw new Error(`Invalid interaction state: "${state}".`);
  }
  if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) {
    throw new Error(`Invalid interaction-state breakpoint: ${maxWidthPx}px.`);
  }
  const normalized = normalizeStateStyles(styles);
  const model = readResponsiveModel(html);
  const bucket = String(Math.round(maxWidthPx));
  model[bucket] ??= {};
  model[bucket][nodeId] ??= {};
  const node = model[bucket][nodeId];
  node[state] = { ...(node[state] ?? {}), ...normalized };
  return injectManagedResponsiveInteractionStateCss(
    html,
    serializeResponsiveInteractionStatesModel(model),
  );
}

/** Remove one property from one responsive state scope, pruning empties. */
export function removeResponsiveStateProperty(
  html: string,
  nodeId: string,
  state: InteractionState,
  maxWidthPx: number,
  property: string,
): string {
  const model = readResponsiveModel(html);
  const bucket = String(Math.round(maxWidthPx));
  const declarations = model[bucket]?.[nodeId]?.[state];
  if (!declarations) return html;
  const normalizedProperty = normalizeCssPropertyName(property.trim());
  if (!(normalizedProperty in declarations)) return html;
  delete declarations[normalizedProperty];
  if (Object.keys(declarations).length === 0)
    delete model[bucket][nodeId][state];
  if (Object.keys(model[bucket][nodeId]).length === 0)
    delete model[bucket][nodeId];
  if (Object.keys(model[bucket]).length === 0) delete model[bucket];
  return injectManagedResponsiveInteractionStateCss(
    html,
    serializeResponsiveInteractionStatesModel(model),
  );
}

/**
 * Remove one managed declaration (reset the property back to the base
 * value). Prunes empty state entries, node entries, and — when nothing is
 * left — the whole managed block.
 */
export function removeStateProperty(
  html: string,
  nodeId: string,
  state: InteractionState,
  property: string,
): string {
  const model = readModel(html);
  const node = model[nodeId];
  const declarations = node?.[state];
  if (!declarations) return html;
  const normalizedProperty = normalizeCssPropertyName(property.trim());
  if (!(normalizedProperty in declarations)) return html;
  delete declarations[normalizedProperty];
  if (Object.keys(declarations).length === 0) {
    delete node![state];
  }
  if (node && Object.keys(node).length === 0) {
    delete model[nodeId];
  }
  return writeModel(html, model);
}

/**
 * Remove every managed declaration for a node's state (the state's full
 * "reset" affordance — clears every overridden property at once).
 */
export function clearState(
  html: string,
  nodeId: string,
  state: InteractionState,
): string {
  const model = readModel(html);
  const node = model[nodeId];
  if (!node?.[state]) return html;
  delete node[state];
  if (Object.keys(node).length === 0) {
    delete model[nodeId];
  }
  return writeModel(html, model);
}

/**
 * All managed declarations across every node/state, flattened and sorted
 * node id → fixed state order → property. Pass `nodeId` to filter to one
 * node (every state), matching `getBreakpointMediaDeclarations`'s shape.
 */
export function listAllInteractionStateDeclarations(
  html: string,
  nodeId?: string | null,
): InteractionStateDeclaration[] {
  const model = readModel(html);
  const declarations: InteractionStateDeclaration[] = [];
  const nodeIds = Object.keys(model).sort((a, b) => a.localeCompare(b));
  for (const ruleNodeId of nodeIds) {
    if (nodeId != null && ruleNodeId !== nodeId) continue;
    const states = model[ruleNodeId];
    for (const state of INTERACTION_STATES) {
      const props = states[state];
      if (!props) continue;
      const properties = Object.keys(props).sort((a, b) => a.localeCompare(b));
      for (const property of properties) {
        declarations.push({
          nodeId: ruleNodeId,
          state,
          property,
          value: props[property],
        });
      }
    }
  }
  return declarations;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Escape a string for a CSS attribute selector value (`\` and `"`). */
function escAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescAttr(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * `!important` is deliberately a serialization concern, not model data.
 * Strip a caller/hand-authored suffix on read and write so repeated
 * parse/serialize cycles stay canonical and never produce
 * `!important !important`.
 */
function stripManagedImportant(value: string): string {
  return value.replace(/\s*!important\s*$/i, "").trim();
}

function normalizeStateStyles(
  styles: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [rawProperty, rawValue] of Object.entries(styles)) {
    const property = normalizeCssPropertyName(rawProperty.trim());
    if (!isSafeInteractionStateCssProperty(property)) {
      throw new Error(`Invalid interaction-state property: "${rawProperty}".`);
    }
    const value = stripManagedImportant(rawValue);
    if (!isSafeInteractionStateCssValue(value)) {
      throw new Error(
        `Invalid interaction-state value for "${property}": semicolons, braces, comments, angle brackets, control characters, and url(...) are not allowed.`,
      );
    }
    normalized[property] = value;
  }
  return normalized;
}

function serializeResponsiveStateBucket(model: InteractionStatesModel): string {
  const realRules: string[] = [];
  const previewRules: string[] = [];
  for (const nodeId of Object.keys(model).sort((a, b) => a.localeCompare(b))) {
    const escaped = escAttr(nodeId);
    const target = `[data-agent-native-node-id="${escaped}"]`;
    const doubledTarget = `${target}${target}`;
    for (const state of INTERACTION_STATES) {
      const declarations = model[nodeId][state];
      if (!declarations) continue;
      const properties = Object.keys(declarations).sort((a, b) =>
        a.localeCompare(b),
      );
      if (properties.length === 0) continue;
      const lines = properties.map(
        (property) =>
          `  ${property}: ${stripManagedImportant(declarations[property])} !important;`,
      );
      realRules.push(`${doubledTarget}:${state} {\n${lines.join("\n")}\n}`);
      previewRules.push(
        `${doubledTarget}[data-an-state-preview="${state}"] {\n${lines.join("\n")}\n}`,
      );
    }
  }
  return [...realRules, ...previewRules].join("\n\n");
}

function extractManagedStyleBody(html: string, openRe: RegExp): string | null {
  const openMatch = openRe.exec(html);
  if (!openMatch) return null;
  const bodyStart = openMatch.index + openMatch[0].length;
  const afterOpen = html.slice(bodyStart);
  const closeMatch = /<\s*\/\s*style\b[^>]*>/i.exec(afterOpen);
  if (!closeMatch) return null;
  return afterOpen.slice(0, closeMatch.index).trim();
}

function injectManagedStyleBody(
  html: string,
  css: string,
  openRe: RegExp,
  attribute: string,
): string {
  const openMatch = openRe.exec(html);
  const trimmed = css.trim();
  const block = trimmed ? `<style ${attribute}>\n${trimmed}\n</style>` : "";
  if (openMatch) {
    const bodyStart = openMatch.index + openMatch[0].length;
    const afterOpen = html.slice(bodyStart);
    const closeMatch = /<\s*\/\s*style\b[^>]*>/i.exec(afterOpen);
    if (closeMatch) {
      const closeEnd = bodyStart + closeMatch.index + closeMatch[0].length;
      if (!block) {
        return (
          html.slice(0, openMatch.index) +
          html.slice(closeEnd).replace(/^\n/, "")
        );
      }
      return html.slice(0, openMatch.index) + block + html.slice(closeEnd);
    }
  }
  if (!block) return html;
  const headClose = /<\/head\s*>/gi;
  let close: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = headClose.exec(html)) !== null) close = match;
  const index = close?.index ?? -1;
  return index >= 0
    ? html.slice(0, index) + block + "\n" + html.slice(index)
    : block + "\n" + html;
}

function extractCssBlock(css: string, start: number): string | null {
  let depth = 1;
  let index = start;
  while (index < css.length && depth > 0) {
    if (css[index] === "{") depth++;
    else if (css[index] === "}") depth--;
    index++;
  }
  return depth === 0 ? css.slice(start, index - 1) : null;
}

/**
 * Normalize a CSS property name to kebab-case (accepts either `fontSize` or
 * `font-size`). Local copy of the same normalization
 * `responsive-classes.ts`/`breakpoint-media.ts` apply, kept dependency-free
 * here since this module must stay a pure, standalone string transform.
 */
function normalizeCssPropertyName(property: string): string {
  if (property.startsWith("--")) return property;
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
