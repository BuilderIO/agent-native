import type { Snapshot } from "./lib/in-page.ts";
import { diffSnapshots } from "./lib/metrics.ts";

type Page = any;
type Locator = any;

export function lineNavigationKeys(platform: string) {
  return platform === "darwin"
    ? { start: "Meta+ArrowLeft", end: "Meta+ArrowRight" }
    : { start: "Home", end: "End" };
}

export function authoringFuzzProfileIndex(seed: number): number | null {
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new Error("seed must be a non-negative safe integer");
  if (seed === 0 || seed % 2 === 1) return null;
  return (seed / 2 - 1) % 6;
}

export function outsideAuthoringChangesFor(before: Snapshot, after: Snapshot) {
  const diff = diffSnapshots(before, after);
  return [...diff.deltas, ...diff.missing, ...diff.added].filter(
    (change) => !change.inside,
  );
}

export function assertShortcutMarkupAdded(
  result: string,
  before: number,
  after: number,
) {
  if (after <= before) {
    throw new Error(
      `markdown shortcut did not produce ${result} (${before} -> ${after})`,
    );
  }
}

const { start: lineStartKey, end: lineEndKey } = lineNavigationKeys(
  process.platform,
);

export type AuthoringFuzzOperation =
  | { kind: "type"; value: string }
  | { kind: "shortcut"; value: string; result: string }
  | { kind: "slash"; value: string; result: string }
  | { kind: "list"; value: "styled" | "ul" | "ol" }
  | {
      kind: "tab" | "shift-tab";
      list: "styled" | "ul" | "ol";
    }
  | {
      kind:
        | "enter-block-edge"
        | "backspace-block-edge"
        | "delete-block-edge"
        | "enter-list-edge"
        | "backspace-list-edge"
        | "delete-list-edge"
        | "paste-plain"
        | "paste-rich"
        | "slash-tab"
        | "slash-escape"
        | "slash-filter"
        | "slash-away"
        | "slash-delete"
        | "slash-position"
        | "slash-outside"
        | "shortcut-undo"
        | "slash-undo"
        | "heading-backspace"
        | "quote-backspace"
        | "heading-enter"
        | "quote-exit"
        | "empty-list-exit"
        | "soft-break"
        | "paste-markdown"
        | "paste-url"
        | "link-shortcut"
        | "vertical-navigation"
        | "select-cross-block-type"
        | "select-cross-block-delete"
        | "bold"
        | "italic"
        | "underline"
        | "strike-shortcut"
        | "code-shortcut"
        | "copy-inline"
        | "replacement"
        | "undo"
        | "redo";
    };

export interface AuthoringFuzzPersistence {
  /** Exact inner HTML of the full slide before editing. */
  originalHtml: string;
  /** Exact inner HTML of the full live slide after editing ends. */
  liveHtml: string;
  /** Exact inner HTML of the full slide returned by persistence. */
  savedHtml: string;
  /** Exact inner HTML of the full slide after a fresh reload. */
  reloadedHtml: string;
}

export async function canonicalizeAuthoringFuzzPersistence(
  persistence: AuthoringFuzzPersistence,
  canonicalize: (html: string) => string | Promise<string>,
): Promise<AuthoringFuzzPersistence> {
  return {
    originalHtml: await canonicalize(persistence.originalHtml),
    liveHtml: await canonicalize(persistence.liveHtml),
    savedHtml: await canonicalize(persistence.savedHtml),
    reloadedHtml: await canonicalize(persistence.reloadedHtml),
  };
}

export interface AuthoringFuzzOptions {
  seed: number;
  steps: number;
  /** Selector for the active in-place contenteditable element. */
  editorSelector: string;
  /** Selector for the containing slide canvas. */
  slideSelector: string;
  /** Selector for the slide markup that must round-trip through undo/redo. */
  slideContentSelector: string;
  /** Target and slide markup captured before entering edit mode. */
  originalHtml: string;
  originalSlideHtml: string;
  /** Exit editing, wait for the save, read the stored HTML, then reload/read it. */
  finishAndReload: () => Promise<AuthoringFuzzPersistence>;
  modifier: "Meta" | "Control";
  /** The in-place editor's undo snapshot cap. */
  historyLimit?: number;
  /** Fail if the caller's viewport did not scale the selected slide down. */
  expectScaledSlide?: boolean;
  browser?: "chromium" | "webkit" | "firefox";
}

export interface AuthoringFuzzResult {
  seed: number;
  stepsRun: number;
  stepLog: AuthoringFuzzOperation[];
  undoSteps: number;
  redoSteps: number;
}

export function assertByteIdenticalHtml(
  actual: string,
  expected: string,
  label: string,
) {
  if (actual !== expected) {
    throw new Error(`${label} did not restore byte-identical HTML`);
  }
}

export function assertAuthoringPersistence(
  persistence: AuthoringFuzzPersistence,
) {
  if (persistence.savedHtml === persistence.originalHtml) {
    throw new Error("authoring flow did not change the persisted slide HTML");
  }
  // Rendering adds safe link defaults that are intentionally absent in storage.
  if (persistence.reloadedHtml !== persistence.liveHtml) {
    throw new Error(
      "reloaded slide HTML differed from the post-edit live slide",
    );
  }
}

const SHORTCUTS = [
  ["- ", "bullet"],
  ["* ", "bullet"],
  ["+ ", "bullet"],
  ["1. ", "ordered"],
  ["# ", "heading1"],
  ["## ", "heading2"],
  ["### ", "heading3"],
  ["#### ", "heading4"],
  ["> ", "quote"],
  ["--- ", "divider"],
  ["___ ", "divider"],
  ["*** ", "divider"],
  ["**bold**", "bold"],
  ["__bold__", "bold"],
  ["*italic*", "italic"],
  ["_italic_", "italic"],
  ["~~strike~~", "strike"],
  ["`code`", "code"],
] as const;

const SLASH_COMMANDS = [
  ["paragraph", "paragraph"],
  ["heading1", "heading 1"],
  ["heading2", "heading 2"],
  ["heading3", "heading 3"],
  ["bulletList", "bullet list"],
  ["orderedList", "numbered list"],
  ["quote", "quote"],
  ["divider", "divider"],
] as const;

const RANDOM_KINDS: AuthoringFuzzOperation["kind"][] = [
  "type",
  "shortcut",
  "slash",
  "list",
  "enter-block-edge",
  "backspace-block-edge",
  "delete-block-edge",
  "enter-list-edge",
  "backspace-list-edge",
  "delete-list-edge",
  "tab",
  "shift-tab",
  "paste-plain",
  "paste-rich",
  "slash-tab",
  "slash-escape",
  "slash-filter",
  "slash-away",
  "slash-delete",
  "slash-position",
  "slash-outside",
  "shortcut-undo",
  "slash-undo",
  "heading-backspace",
  "quote-backspace",
  "heading-enter",
  "quote-exit",
  "empty-list-exit",
  "soft-break",
  "paste-markdown",
  "paste-url",
  "link-shortcut",
  "select-cross-block-type",
  "select-cross-block-delete",
  "bold",
  "italic",
  "underline",
  "strike-shortcut",
  "code-shortcut",
  "copy-inline",
  "replacement",
  "undo",
  "redo",
];

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomOperation(
  random: () => number,
  index: number,
): AuthoringFuzzOperation {
  const kind = RANDOM_KINDS[Math.floor(random() * RANDOM_KINDS.length)];
  if (kind === "type") {
    return { kind, value: `f${index.toString(36)}q` };
  }
  if (kind === "list") {
    return {
      kind,
      value: (["styled", "ul", "ol"] as const)[Math.floor(random() * 3)],
    };
  }
  if (kind === "shortcut") {
    const [value, result] = SHORTCUTS[Math.floor(random() * SHORTCUTS.length)];
    return { kind, value, result };
  }
  if (kind === "slash") {
    const [value, result] =
      SLASH_COMMANDS[Math.floor(random() * SLASH_COMMANDS.length)];
    return { kind, value, result };
  }
  if (kind === "tab" || kind === "shift-tab") {
    return {
      kind,
      list: (["styled", "ul", "ol"] as const)[Math.floor(random() * 3)],
    };
  }
  return { kind } as AuthoringFuzzOperation;
}

/** Returns a reproducible prefix that covers every shortcut and slash command. */
export function createAuthoringFuzzPlan(
  seed: number,
  steps: number,
): AuthoringFuzzOperation[] {
  if (!Number.isSafeInteger(seed))
    throw new Error("seed must be a safe integer");
  if (!Number.isInteger(steps) || steps < 1)
    throw new Error("steps must be a positive integer");

  const plan: AuthoringFuzzOperation[] = [
    ...(authoringFuzzProfileIndex(seed) === 0
      ? [{ kind: "vertical-navigation" as const }]
      : []),
    ...SHORTCUTS.map(([value, result]) => ({
      kind: "shortcut" as const,
      value,
      result,
    })),
    ...SLASH_COMMANDS.map(([value, result]) => ({
      kind: "slash" as const,
      value,
      result,
    })),
    { kind: "type", value: "fastburst" },
    { kind: "list", value: "styled" },
    { kind: "list", value: "ul" },
    { kind: "list", value: "ol" },
    { kind: "enter-block-edge" },
    { kind: "backspace-block-edge" },
    { kind: "delete-block-edge" },
    { kind: "enter-list-edge" },
    { kind: "backspace-list-edge" },
    { kind: "delete-list-edge" },
    { kind: "tab", list: "styled" },
    { kind: "shift-tab", list: "styled" },
    { kind: "tab", list: "ul" },
    { kind: "shift-tab", list: "ul" },
    { kind: "tab", list: "ol" },
    { kind: "shift-tab", list: "ol" },
    { kind: "paste-plain" },
    { kind: "paste-rich" },
    { kind: "slash-tab" },
    { kind: "slash-escape" },
    { kind: "slash-filter" },
    { kind: "slash-away" },
    { kind: "slash-delete" },
    { kind: "slash-position" },
    { kind: "shortcut-undo" },
    { kind: "slash-undo" },
    { kind: "heading-backspace" },
    { kind: "quote-backspace" },
    { kind: "heading-enter" },
    { kind: "quote-exit" },
    { kind: "empty-list-exit" },
    { kind: "soft-break" },
    { kind: "paste-markdown" },
    { kind: "paste-url" },
    { kind: "link-shortcut" },
    { kind: "select-cross-block-type" },
    { kind: "select-cross-block-delete" },
    { kind: "bold" },
    { kind: "italic" },
    { kind: "underline" },
    { kind: "strike-shortcut" },
    { kind: "code-shortcut" },
    { kind: "copy-inline" },
    { kind: "replacement" },
    { kind: "undo" },
    { kind: "redo" },
  ];

  const random = seededRandom(seed);
  while (plan.length < steps) plan.push(randomOperation(random, plan.length));
  const selected = plan.slice(0, steps);
  if (
    ["undo", "redo", "shortcut-undo", "slash-undo"].includes(
      selected.at(-1)?.kind ?? "",
    )
  ) {
    selected[selected.length - 1] = { kind: "type", value: `finish${seed}` };
  }
  return selected;
}

const MAX_FAILURE_LOG_OPERATIONS = 20;
const MAX_FAILURE_MESSAGE_LENGTH = 1600;

export function formatAuthoringFuzzFailure(
  seed: number,
  phase: string,
  log: AuthoringFuzzOperation[],
  message: string,
  browser: "chromium" | "webkit" | "firefox" = "chromium",
) {
  const replaySteps = Math.max(1, log.length);
  const logStart = Math.max(0, log.length - MAX_FAILURE_LOG_OPERATIONS);
  const excerpt = log.slice(logStart).map((operation, index) => ({
    step: logStart + index,
    operation,
  }));
  const boundedMessage =
    message.length > MAX_FAILURE_MESSAGE_LENGTH
      ? `${message.slice(0, MAX_FAILURE_MESSAGE_LENGTH)}…`
      : message;
  return new Error(
    `authoring fuzz failed (seed=${seed}, phase=${phase}): ${boundedMessage}\n` +
      `Replay: pnpm exec tsx scripts/edit-fidelity/run.ts --authoring-fuzz --seed ${seed} --steps ${replaySteps} --browser ${browser}\n` +
      `Failure log: steps ${logStart}-${log.length - 1} of ${log.length} replay steps\n` +
      JSON.stringify(excerpt, null, 2),
  );
}

export async function assertSlideIsScaled(page: Page, selector: string) {
  const scale = await page
    .locator(selector)
    .evaluate((element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
    });
  if (!(scale > 0 && scale < 0.99)) {
    throw new Error(
      `scaled fixture did not scale below 0.99 (scale ${scale.toFixed(3)})`,
    );
  }
}

export async function runAuthoringFuzz(
  page: Page,
  options: AuthoringFuzzOptions,
): Promise<AuthoringFuzzResult> {
  const { seed, steps, editorSelector, slideSelector, slideContentSelector } =
    options;
  const plan = createAuthoringFuzzPlan(seed, steps);
  const { modifier } = options;
  const historyLimit = options.historyLimit ?? 100;
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
    throw new Error("historyLimit must be a positive safe integer");
  }
  const editor: Locator = page.locator(editorSelector);
  const slideContent: Locator = page.locator(slideContentSelector);
  const pageErrors: string[] = [];
  const pendingSaveConflicts: Promise<void>[] = [];
  let patchDeckConflicts = 0;
  let conflictResourceErrors = 0;
  const onConsole = (message: any) => {
    if (message.type() !== "error") return;
    if (message.text().includes("status of 409 (Conflict)")) {
      conflictResourceErrors += 1;
      return;
    }
    pageErrors.push(message.text());
  };
  const onPageError = (error: Error) => pageErrors.push(error.message);
  const onResponse = (response: any) => {
    if (
      response.status() !== 409 ||
      !response.url().includes("/_agent-native/actions/patch-deck")
    ) {
      return;
    }
    patchDeckConflicts += 1;
    pendingSaveConflicts.push(
      response
        .text()
        .then(() => undefined)
        .catch((error: unknown) => {
          pageErrors.push(
            `patch-deck conflict response could not be read: ${String(error)}`,
          );
        }),
    );
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);

  let activeIndex = -1;
  let activePhase = "setup";
  const replay = () => plan.slice(0, Math.max(1, activeIndex + 1));
  const checkPageErrors = async () => {
    await Promise.all(pendingSaveConflicts.splice(0));
    if (pageErrors.length)
      throw new Error(
        `browser emitted ${pageErrors.length} console/page error(s): ${pageErrors
          .slice(0, 2)
          .map((error) => error.replaceAll(/\s+/g, " ").slice(0, 300))
          .join("; ")}`,
      );
  };
  const inspectSelection = async () =>
    page.evaluate((selector: string) => {
      const root = document.querySelector(selector);
      const selection = window.getSelection();
      if (
        !(root instanceof HTMLElement) ||
        !selection ||
        !selection.rangeCount
      ) {
        return { inside: false, collapsed: false, text: "", start: 0, end: 0 };
      }
      const range = selection.getRangeAt(0);
      const offset = (node: Node, at: number) => {
        const prefix = document.createRange();
        prefix.selectNodeContents(root);
        prefix.setEnd(node, at);
        return prefix
          .toString()
          .replaceAll("\u200b", "")
          .replaceAll("\u00a0", " ").length;
      };
      return {
        inside:
          root.contains(selection.anchorNode) &&
          root.contains(selection.focusNode),
        collapsed: selection.isCollapsed,
        text: (root.textContent ?? "")
          .replaceAll("\u200b", "")
          .replaceAll("\u00a0", " "),
        start: offset(range.startContainer, range.startOffset),
        end: offset(range.endContainer, range.endOffset),
      };
    }, editorSelector);
  const slashCount = (text: string) => text.match(/\//g)?.length ?? 0;
  const assertCaret = async () => {
    const selection = await inspectSelection();
    if (!selection.inside)
      throw new Error("selection/caret left the edited element");
  };
  const typeBurst = async (value: string, verifyPlacement: boolean) => {
    if (!value) return;
    const before = await inspectSelection();
    if (!before.inside)
      throw new Error("cannot type: selection is outside the edited element");
    const probe = verifyPlacement && value.length === 1;
    if (probe) {
      await editor.evaluate((root: HTMLElement) => {
        const scope = window as Window & {
          __authoringFuzzInputProbe?: {
            root: HTMLElement;
            listener: (event: Event) => void;
            events: Array<Record<string, unknown>>;
            snapshot: () => Record<string, unknown>;
            before: Record<string, unknown>;
          };
        };
        const pathFor = (point: Node | null) => {
          const path: string[] = [];
          for (
            let current =
              point instanceof Element ? point : point?.parentElement;
            current && current !== root;
          ) {
            const owner = current.parentElement;
            if (!owner) break;
            path.unshift(
              `${current.tagName}:${Array.from(owner.children).indexOf(current)}`,
            );
            current = owner;
          }
          return path;
        };
        const snapshot = () => {
          const selection = window.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
          const node = range?.startContainer ?? null;
          const parent = node instanceof Element ? node : node?.parentElement;
          const visible = (root.textContent ?? "")
            .replaceAll("\u200b", "")
            .replaceAll("\u00a0", " ");
          const offset = range
            ? (() => {
                const prefix = document.createRange();
                prefix.selectNodeContents(root);
                prefix.setEnd(range.startContainer, range.startOffset);
                return prefix
                  .toString()
                  .replaceAll("\u200b", "")
                  .replaceAll("\u00a0", " ").length;
              })()
            : null;
          return {
            collapsed: selection?.isCollapsed ?? false,
            inside:
              !!selection &&
              root.contains(selection.anchorNode) &&
              root.contains(selection.focusNode),
            anchorPath: pathFor(selection?.anchorNode ?? null),
            focusPath: pathFor(selection?.focusNode ?? null),
            anchorOffset: selection?.anchorOffset ?? null,
            focusOffset: selection?.focusOffset ?? null,
            rangeEndOffset: range?.endOffset ?? null,
            nodeType: node?.nodeType ?? null,
            nodeLength: node instanceof Text ? node.length : null,
            nodeOffset: range?.startOffset ?? null,
            parentChildren: parent
              ? Array.from(parent.childNodes).map((child) =>
                  child instanceof Text
                    ? `TEXT:${child.length}`
                    : `${(child as Element).tagName}:${child.childNodes.length}`,
                )
              : [],
            offset,
            nearbyCodes:
              offset === null
                ? []
                : Array.from(
                    visible.slice(Math.max(0, offset - 3), offset + 4),
                    (character) => character.codePointAt(0),
                  ),
          };
        };
        const events: Array<Record<string, unknown>> = [];
        const listener = (event: Event) => {
          const input = event as InputEvent;
          const record: Record<string, unknown> = {
            inputType: input.inputType,
            dataCodes: input.data
              ? Array.from(input.data, (character) => character.codePointAt(0))
              : null,
            cancelable: input.cancelable,
            defaultPrevented: null,
            targetRanges: input.getTargetRanges?.().map((range) => ({
              collapsed: range.collapsed,
              startPath: pathFor(range.startContainer),
              startOffset: range.startOffset,
              endPath: pathFor(range.endContainer),
              endOffset: range.endOffset,
            })),
          };
          events.push(record);
          queueMicrotask(() => {
            record.defaultPrevented = input.defaultPrevented;
          });
        };
        root.addEventListener("beforeinput", listener, true);
        scope.__authoringFuzzInputProbe = {
          root,
          listener,
          events,
          snapshot,
          before: snapshot(),
        };
      });
    }
    await editor.pressSequentially(value, { delay: 0 });
    const after = await inspectSelection();
    const diagnostics = probe
      ? await editor.evaluate((root: HTMLElement) => {
          const scope = window as Window & {
            __authoringFuzzInputProbe?: {
              root: HTMLElement;
              listener: (event: Event) => void;
              events: Array<Record<string, unknown>>;
              snapshot: () => Record<string, unknown>;
              before: Record<string, unknown>;
            };
          };
          const input = scope.__authoringFuzzInputProbe;
          if (!input || input.root !== root) return null;
          root.removeEventListener("beforeinput", input.listener, true);
          const result = {
            before: input.before,
            after: input.snapshot(),
            events: input.events,
          };
          delete scope.__authoringFuzzInputProbe;
          return result;
        })
      : null;
    if (!after.inside)
      throw new Error(
        `typed burst ${JSON.stringify(value)} outside the editor`,
      );
    if (verifyPlacement) {
      const expected =
        before.text.slice(0, before.start) +
        value +
        before.text.slice(before.end);
      const textMismatch = Array.from(
        { length: Math.max(expected.length, after.text.length) },
        (_, index) => index,
      ).find((index) => expected[index] !== after.text[index]);
      if (
        after.text !== expected ||
        after.start !== before.start + value.length
      ) {
        throw new Error(
          `typed burst ${JSON.stringify(value)} missed the caret (expected offset ${before.start + value.length}, got ${after.start}; text lengths ${expected.length} and ${after.text.length}; selection=${before.collapsed}:${before.start}-${before.end} to ${after.collapsed}:${after.start}-${after.end}; first mismatch=${textMismatch ?? "none"} codes=${textMismatch === undefined ? "none" : `${expected.codePointAt(textMismatch)}>${after.text.codePointAt(textMismatch)}`}; input=${JSON.stringify(diagnostics)})`,
        );
      }
    }
  };
  const typeText = async (
    value: string,
    verifyPlacement = true,
    skipLastPlacement = false,
  ) => {
    const payload = skipLastPlacement ? value.slice(0, -1) : value;
    const trigger = skipLastPlacement ? value.slice(-1) : "";
    await typeBurst(payload, verifyPlacement);
    if (trigger) await typeBurst(trigger, false);
  };
  const snapshotOutside = async (): Promise<Snapshot> =>
    page.evaluate(
      ({ slide, editor }: { slide: string; editor: string }) => {
        const root = document.querySelector(slide);
        const editing = document.querySelector(editor);
        if (!root || !editing || !root.contains(editing)) {
          throw new Error(
            "slide/editor selectors must resolve inside the same slide",
          );
        }
        return window.__editFidelity.snapshot(slide, {});
      },
      { slide: slideSelector, editor: editorSelector },
    );
  const snapshotEditorSiblings = async (
    phase: "capture" | "assert",
    operation: AuthoringFuzzOperation,
  ) =>
    page.evaluate(
      ({
        selector,
        phase,
        operation,
      }: {
        selector: string;
        phase: "capture" | "assert";
        operation: AuthoringFuzzOperation;
      }) => {
        const root = document.querySelector(selector);
        const selection = window.getSelection();
        if (!(root instanceof HTMLElement) || !selection?.rangeCount) {
          throw new Error("cannot snapshot editor siblings without a caret");
        }
        const scope = window as Window & {
          __authoringFuzzSiblingSnapshot?: {
            root: HTMLElement;
            records: Array<{
              node: Element | Text;
              parent: Node;
              index: number;
              order?: number;
              style: string;
              attributes: string;
              attributeNames: string;
              text: string;
            }>;
          };
        };
        const block =
          /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|LI|OL|P|PRE|SECTION|TABLE|TBODY|TD|TFOOT|TH|THEAD|TR|UL)$/;
        const range = selection.getRangeAt(0);
        const listShortcut =
          operation.kind === "shortcut" &&
          (operation.result === "bullet" || operation.result === "ordered");
        let targets = selection.isCollapsed
          ? (() => {
              let current =
                selection.anchorNode instanceof HTMLElement
                  ? selection.anchorNode
                  : selection.anchorNode?.parentElement;
              while (
                current &&
                current !== root &&
                !block.test(current.tagName)
              ) {
                current = current.parentElement;
              }
              return current && current !== root ? [current] : [root];
            })()
          : Array.from(root.querySelectorAll<HTMLElement>("*"))
              .filter((element) => block.test(element.tagName))
              .filter((element) => {
                return range.intersectsNode(element);
              })
              .filter(
                (element, _, all) =>
                  !all.some(
                    (candidate) =>
                      candidate !== element && element.contains(candidate),
                  ),
              );
        const activeItem =
          targets[0]?.tagName === "LI" ? targets[0] : targets[0]?.closest("li");
        const activeList = activeItem?.parentElement ?? null;
        if (
          ((operation.kind === "slash" &&
            (operation.value === "bulletList" ||
              operation.value === "orderedList")) ||
            listShortcut) &&
          activeList?.matches("ol, ul")
        ) {
          if (operation.kind === "slash") {
            // The list command changes the active list node as a unit.
            targets = [activeList];
          }
        }
        if (!targets.length) targets.push(root);
        const isTarget = (node: Node) =>
          targets.some(
            (target) =>
              target === node ||
              target.contains(node) ||
              (node instanceof Element && node.contains(target)),
          );
        const siblingText = new Set<Text>();
        const textOnlyStyles = new Set([
          "color",
          "font-family",
          "font-size",
          "font-style",
          "font-weight",
          "letter-spacing",
          "text-decoration",
          "text-decoration-color",
          "text-decoration-line",
          "text-decoration-style",
          "text-shadow",
          "vertical-align",
        ]);
        for (const target of targets) {
          let current: Node = target;
          while (current !== root && current.parentNode) {
            const parent: Node = current.parentNode;
            for (const sibling of Array.from(parent.childNodes)) {
              if (sibling !== current && sibling instanceof Text) {
                siblingText.add(sibling);
              }
            }
            if (parent === root) break;
            current = parent;
          }
        }
        const layoutProperties = new Set([
          "block-size",
          "grid-auto-columns",
          "grid-auto-rows",
          "grid-template-columns",
          "grid-template-rows",
          "height",
          "inline-size",
          "perspective-origin",
          "transform-origin",
          "width",
        ]);
        const css = (element: Element) => {
          const style = getComputedStyle(element);
          return Array.from(style)
            .filter((property) => !layoutProperties.has(property))
            .sort()
            .map(
              (property) => `${property}:${style.getPropertyValue(property)}`,
            )
            .join(";");
        };
        const chrome = [
          "[data-slide-selection-chrome]",
          "[data-slide-selection-outline]",
          "[data-slide-resize-handle]",
          "[data-slide-move-handle]",
          "[data-slide-rotate-handle]",
          "[data-block-bubble-menu]",
        ].join(",");
        const records: NonNullable<
          typeof scope.__authoringFuzzSiblingSnapshot
        >["records"] = [];
        const order = new Map(
          Array.from(root.querySelectorAll<Element>("*")).map(
            (element, index) => [element, index] as const,
          ),
        );
        const isBulletRow = (element: Element | null) =>
          !!element &&
          ["DIV", "LI", "P"].includes(element.tagName) &&
          !!element.firstElementChild &&
          /^[•●◦▪‣·⁃*+\-–—]$/.test(
            (element.firstElementChild.textContent ?? "").trim(),
          );
        const isListGroup = (element: Element) => {
          const rows = [
            element,
            ...Array.from(element.querySelectorAll("*")),
          ].filter(isBulletRow);
          if (!rows.length) return false;
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (
              (node as Text).data.trim() &&
              !rows.some((row) => row.contains(node))
            ) {
              return false;
            }
          }
          return true;
        };
        const isListContainer = (node: Node) =>
          node instanceof Element &&
          (/^(OL|UL)$/.test(node.tagName) ||
            (node.tagName === "DIV" && isListGroup(node)));
        const isListItem = (node: Node) =>
          node instanceof Element &&
          (node.tagName === "LI" || isListGroup(node));
        const isEmptyAuthorStyleSpan = (element: Element): boolean =>
          element.tagName === "SPAN" &&
          element.getAttribute("data-slide-inline-style") === "true" &&
          !element.textContent &&
          Array.from(element.attributes).every(
            ({ name, value }) =>
              name === "style" ||
              (name === "data-slide-inline-style" && value === "true"),
          ) &&
          getComputedStyle(element).display === "inline" &&
          ["::before", "::after"].every((pseudo) =>
            ["none", "normal"].includes(
              getComputedStyle(element, pseudo).content,
            ),
          ) &&
          Array.from((element as HTMLElement).style).every((property) =>
            textOnlyStyles.has(property),
          ) &&
          Array.from(element.children).every(isEmptyAuthorStyleSpan);
        for (const element of root.querySelectorAll<HTMLElement>("*")) {
          if (
            isTarget(element) ||
            element.closest(chrome) ||
            !element.parentNode
          ) {
            continue;
          }
          if (isEmptyAuthorStyleSpan(element)) continue;
          records.push({
            node: element,
            parent: element.parentNode,
            index: Array.from(element.parentNode.childNodes).indexOf(element),
            order: order.get(element),
            style: css(element),
            attributes: `${element.getAttribute("class") ?? ""}:${element.getAttribute("style") ?? ""}`,
            attributeNames: Array.from(element.attributes)
              .map(({ name }) => name)
              .sort()
              .join(" "),
            text: element.textContent ?? "",
          });
        }
        for (const text of siblingText) {
          const parent = text.parentElement;
          if (!parent || isTarget(text) || !root.contains(text)) continue;
          records.push({
            node: text,
            parent,
            index: Array.from(parent.childNodes).indexOf(text),
            style: css(parent),
            attributes: "",
            attributeNames: "",
            text: text.data,
          });
        }
        if (phase === "capture") {
          scope.__authoringFuzzSiblingSnapshot = { root, records };
          return [];
        }
        const baseline = scope.__authoringFuzzSiblingSnapshot;
        if (!baseline) {
          throw new Error("editor sibling snapshot was not captured");
        }
        const path = (node: Node) => {
          const parts: string[] = [];
          for (
            let current: Node | null = node;
            current && current !== root;
            current = current.parentNode
          ) {
            const parent = current.parentNode;
            const index = parent
              ? Array.from(parent.childNodes).findIndex(
                  (child) => child === current,
                )
              : -1;
            parts.unshift(`${current.nodeName}[${index}]`);
          }
          return parts.join("/");
        };
        const targetPaths = targets.map(path).join(", ");
        const failures: string[] = [];
        const equivalentReplacements = new Set<Element>();
        for (const record of baseline.records) {
          if (isTarget(record.node)) continue;
          if (!root.contains(record.node)) {
            if (
              [...equivalentReplacements].some((node) =>
                node.contains(record.node),
              )
            ) {
              continue;
            }
            const replacement = record.parent.childNodes[record.index];
            if (
              record.node instanceof Element &&
              replacement instanceof Element &&
              record.node.outerHTML === replacement.outerHTML
            ) {
              equivalentReplacements.add(record.node);
              continue;
            }
            const shape = (node: Node | undefined) =>
              !node
                ? "missing"
                : node instanceof Element
                  ? `${node.tagName}[text=${node.textContent?.length ?? 0};class=${node.getAttribute("class") ?? ""};style=${node.getAttribute("style") ?? ""}]`
                  : `${node.nodeName}[length=${node.textContent?.length ?? 0}]`;
            failures.push(
              `removed ${shape(record.node)} from ${path(record.parent)}[${record.index}], replacement=${shape(replacement)}, attributes=${record.attributeNames}, inline=${record.attributes}`,
            );
            continue;
          }
          const parent = record.parent === baseline.root ? root : record.parent;
          const moved = record.node.parentNode !== parent;
          const newParent = record.node.parentNode;
          const promotedHeadingLine =
            operation.kind === "heading-enter" &&
            record.node instanceof HTMLElement &&
            record.node.tagName === "P" &&
            parent instanceof HTMLElement &&
            newParent instanceof HTMLElement &&
            root.contains(parent) &&
            newParent !== parent &&
            newParent.children.length === 2 &&
            newParent.firstElementChild?.tagName === "H2" &&
            newParent.lastElementChild === record.node;
          if (
            moved &&
            !(
              promotedHeadingLine ||
              (listShortcut &&
                isListItem(record.node) &&
                isListContainer(record.parent) &&
                record.node.parentNode &&
                isListContainer(record.node.parentNode))
            )
          ) {
            const structure = (node: Node) =>
              node instanceof Element
                ? `${node.tagName}[${Array.from(node.children)
                    .map((child) => child.tagName)
                    .join(
                      ",",
                    )};list=${isListGroup(node)};text=${node.textContent?.length ?? 0}]`
                : node.nodeName;
            failures.push(
              `moved ${structure(record.node)} ${path(record.parent)}->${path(record.node.parentNode ?? record.parent)}`,
            );
          }
          const style = css(
            record.node instanceof Text
              ? (record.node.parentElement ?? (parent as Element))
              : record.node,
          );
          const attributes =
            record.node instanceof Element
              ? `${record.node.getAttribute("class") ?? ""}:${record.node.getAttribute("style") ?? ""}`
              : "";
          const styleChanged = record.style !== style;
          const changedStyle: string[] = [];
          if (styleChanged) {
            const styleProperties = (value: string) =>
              new Map(
                value.split(";").map((entry) => {
                  const separator = entry.indexOf(":");
                  return [
                    entry.slice(0, separator),
                    entry.slice(separator + 1),
                  ];
                }),
              );
            const beforeStyle = styleProperties(record.style);
            const afterStyle = styleProperties(style);
            changedStyle.push(
              ...[
                ...new Set([...beforeStyle.keys(), ...afterStyle.keys()]),
              ].filter(
                (property) =>
                  beforeStyle.get(property) !== afterStyle.get(property),
              ),
            );
          }
          const changes = styleChanged ? ["style"] : [];
          if (record.node instanceof Text && record.node.data !== record.text)
            changes.push("text");
          if (
            record.node instanceof Element &&
            record.node.textContent !== record.text
          )
            changes.push("text");
          if (
            record.node instanceof Element &&
            attributes !== record.attributes
          )
            changes.push("authored attributes");
          if (
            operation.kind === "empty-list-exit" &&
            record.node instanceof HTMLElement &&
            /^(OL|UL)$/.test(record.node.tagName)
          ) {
            const textIndex = changes.indexOf("text");
            if (textIndex >= 0) changes.splice(textIndex, 1);
          }
          if (changes.length) {
            failures.push(
              `changed ${record.node.nodeName} at ${path(record.node)} (${changes.join(", ")}${changes.includes("text") ? `, text length=${record.text.length}->${record.node.textContent?.length ?? 0}` : ""}${changedStyle.length ? `: ${changedStyle.slice(0, 6).join(", ")}` : ""})`,
            );
          }
        }
        const expectedOrder = baseline.records
          .filter(
            (
              record,
            ): record is (typeof baseline.records)[number] & {
              node: Element;
              order: number;
            } => record.node instanceof Element && record.order !== undefined,
          )
          .sort((a, b) => a.order - b.order);
        const actualOrder = [...expectedOrder].sort((a, b) =>
          a.node.compareDocumentPosition(b.node) &
          Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1,
        );
        if (
          expectedOrder.some(
            (record, index) => actualOrder[index]?.node !== record.node,
          )
        ) {
          failures.push("reordered sibling blocks");
        }
        return failures.length
          ? [...failures, `authoring targets: ${targetPaths}`]
          : failures;
      },
      { selector: editorSelector, phase, operation },
    );
  const assertOutsideUnchanged = async (baseline: Snapshot) => {
    const current = await snapshotOutside();
    const changes = outsideAuthoringChangesFor(baseline, current);
    if (changes.length) {
      throw new Error(
        `unexpected style or authored changes outside the edited element: ${JSON.stringify(changes.slice(0, 5))}`,
      );
    }
  };
  const withoutSessionAttributes = async (html: string) =>
    page.evaluate((value: string) => {
      const template = document.createElement("template");
      template.innerHTML = value;
      for (const element of template.content.querySelectorAll<HTMLElement>(
        '[contenteditable="true"][data-editing-block="true"]',
      )) {
        element.removeAttribute("contenteditable");
        element.removeAttribute("data-editing-block");
      }
      return template.innerHTML;
    }, html);
  const shortcutResultCount = async (result: string) =>
    editor.evaluate((root: HTMLElement, expected: string) => {
      const count = (selector: string) =>
        root.querySelectorAll(selector).length +
        (root.matches(selector) ? 1 : 0);
      if (expected.startsWith("heading")) {
        const level = expected.slice(-1);
        return count(`h${level}`);
      }
      switch (expected) {
        case "bullet": {
          const rows = [
            ...(root.matches("div") ? [root] : []),
            ...Array.from(root.querySelectorAll<HTMLElement>("div")),
          ];
          const styledRows = rows.filter((row) => {
            const marker = row.firstElementChild;
            const text = row.lastElementChild;
            return (
              getComputedStyle(row).display === "flex" &&
              marker?.tagName === "SPAN" &&
              /^[•●◦▪‣·⁃–—-]+$/u.test(marker.textContent?.trim() ?? "") &&
              text?.tagName === "SPAN"
            );
          });
          return count("ul > li") + styledRows.length;
        }
        case "ordered":
          return count("ol > li");
        case "quote":
          return count("blockquote");
        case "divider":
          return count("hr");
        case "bold":
          return count("strong, b, span[style*='font-weight']");
        case "italic":
          return count("em, i, span[style*='font-style']");
        case "strike":
          return count("s, del, span[style*='text-decoration']");
        case "code":
          return count("code");
        default:
          return 0;
      }
    }, result);
  const shortcutState = async () =>
    editor.evaluate((root: HTMLElement) => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const element =
        anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
      const block = element?.closest<HTMLElement>(
        "p,div,h1,h2,h3,h4,h5,h6,blockquote,li,pre",
      );
      const shape = (node: Element, depth: number): unknown => {
        const text = node.textContent ?? "";
        return {
          tag: node.tagName,
          textLength: text.length,
          isDashSpace: text.replaceAll("\u00a0", " ") === "- ",
          isDashNbsp: text === "-\u00a0",
          children:
            depth > 0
              ? Array.from(node.childNodes)
                  .slice(-8)
                  .map((child) =>
                    child instanceof Text
                      ? {
                          kind: "text",
                          length: child.data.length,
                          isDash: child.data === "-",
                          isDashSpace:
                            child.data.replaceAll("\u00a0", " ") === "- ",
                          endsWithDash: child.data.endsWith("-"),
                          endsWithSpace: /[\u0020\u00a0]$/.test(child.data),
                        }
                      : shape(child as Element, depth - 1),
                  )
              : undefined,
        };
      };
      const blockText = (block?.textContent ?? "")
        .replaceAll("\u200b", "")
        .replaceAll("\u00a0", " ");
      return {
        focused: document.activeElement === root,
        caretInside: !!anchor && root.contains(anchor),
        collapsed: selection?.isCollapsed ?? false,
        blockTag: block?.tagName ?? null,
        blockTextLength: blockText.length,
        blockIsDashSpace: blockText === "- ",
        blockEndsWithDashSpace: blockText.endsWith("- "),
        blockEndsWithDash: blockText.endsWith("-"),
        blockEndsWithSpace: /[ \u00a0]$/.test(block?.textContent ?? ""),
        block: block ? shape(block, 2) : null,
      };
    });
  const assertShortcut = async (
    result: string,
    before: number,
    beforeTrigger?: unknown,
  ) => {
    const after = await shortcutResultCount(result);
    if (after <= before) {
      const state = await shortcutState();
      throw new Error(
        `markdown shortcut did not produce ${result} (${before} -> ${after}; before trigger=${JSON.stringify(beforeTrigger)}; after=${JSON.stringify(state)})`,
      );
    }
  };
  const newLine = async () => newPlainLine();
  const plainLineState = async () =>
    editor.evaluate((root: HTMLElement) => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const element =
        anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
      const block = element?.closest<HTMLElement>(
        "p,div,h1,h2,h3,h4,h5,h6,blockquote,li,pre",
      );
      const current = block ?? root;
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      let lineStart: [Node, number] = [current, 0];
      if (range) {
        for (const br of Array.from(current.querySelectorAll("br"))) {
          const parent = br.parentNode;
          if (!parent) continue;
          const breakEnd = document.createRange();
          breakEnd.setStart(
            parent,
            Array.from(parent.childNodes).indexOf(br) + 1,
          );
          breakEnd.collapse(true);
          if (
            range.compareBoundaryPoints(Range.START_TO_START, breakEnd) >= 0
          ) {
            lineStart = [breakEnd.startContainer, breakEnd.startOffset];
          }
        }
      }
      const prefix = document.createRange();
      prefix.setStart(...lineStart);
      if (range) prefix.setEnd(range.startContainer, range.startOffset);
      const suffix = document.createRange();
      if (range) {
        suffix.setStart(range.startContainer, range.startOffset);
        suffix.setEnd(current, current.childNodes.length);
      }
      const hasContent = (fragment: DocumentFragment) =>
        !!fragment.textContent
          ?.replaceAll("\u200b", "")
          .replaceAll("\ufeff", "")
          .replaceAll("\u00a0", "") ||
        fragment.querySelector(
          "img,svg,video,canvas,picture,iframe,input,hr",
        ) !== null;
      const isStyledListRow = (candidate: HTMLElement) => {
        const marker = candidate.firstElementChild;
        return (
          getComputedStyle(candidate).display === "flex" &&
          marker?.tagName === "SPAN" &&
          /^[•●◦▪‣·⁃–—-]+$/u.test(marker.textContent?.trim() ?? "") &&
          candidate.lastElementChild?.tagName === "SPAN"
        );
      };
      let inStyledListRow = false;
      for (
        let ancestor = element;
        ancestor && root.contains(ancestor);
        ancestor = ancestor.parentElement
      ) {
        if (isStyledListRow(ancestor)) {
          inStyledListRow = true;
          break;
        }
        if (ancestor === root) break;
      }
      return {
        valid:
          !!selection &&
          selection.isCollapsed &&
          !!anchor &&
          root.contains(anchor) &&
          (current.tagName === "P" || current.tagName === "DIV") &&
          !current.closest("li,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre") &&
          !element?.closest("li,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre") &&
          !inStyledListRow &&
          !!range &&
          !hasContent(prefix.cloneContents()) &&
          !hasContent(suffix.cloneContents()),
        tag: current.tagName,
        linePrefixLength: prefix.toString().length,
        lineSuffixLength: suffix.toString().length,
        focused: document.activeElement === root,
        anchorTag:
          anchor instanceof Element
            ? anchor.tagName
            : anchor?.parentElement?.tagName,
        anchorOffset: selection?.anchorOffset ?? null,
        blockedContext: !!element?.closest(
          "li,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre",
        ),
        ancestorTags: (() => {
          const tags: string[] = [];
          for (
            let current = element;
            current && root.contains(current);
            current = current.parentElement
          ) {
            tags.push(current.tagName);
            if (current === root) break;
          }
          return tags;
        })(),
      };
    });
  const newPlainLine = async (label = "authoring operation") => {
    await editor.evaluate((root: HTMLElement) => {
      root.focus();
      const selection = window.getSelection();
      if (!selection) throw new Error("editor has no text selection");
      const range = document.createRange();
      const textNodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let lastText: Text | null = null;
      for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
        lastText = node as Text;
      }
      if (lastText) range.setStart(lastText, lastText.length);
      else {
        range.selectNodeContents(root);
        range.collapse(false);
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    });
    let state = await plainLineState();
    let attempts = 0;
    for (let attempt = 0; !state.valid && attempt < 8; attempt += 1) {
      await editor.press("Enter");
      state = await plainLineState();
      attempts += 1;
    }
    if (!state.valid)
      throw new Error(
        `${label} setup did not reach an empty plain line (${JSON.stringify({ attempts, state })})`,
      );
    const operation = plan[activeIndex];
    if (!operation) throw new Error("authoring operation is unavailable");
    await snapshotEditorSiblings("capture", operation);
  };
  const openSlashMenu = async () => {
    await newLine();
    await typeText("/");
    const options = page.locator('[role="listbox"] [role="option"]');
    await options.first().waitFor({ state: "visible", timeout: 1500 });
    if ((await options.count()) !== SLASH_COMMANDS.length)
      throw new Error("slash menu did not expose all eight commands");
    const focused = await editor.evaluate(
      (root: HTMLElement) => document.activeElement === root,
    );
    if (!focused) throw new Error("slash menu stole focus from the editor");
    const position = await page
      .locator('[role="listbox"]')
      .evaluate((menu: HTMLElement) => {
        const bounds = (rect: DOMRect) => ({
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        });
        const rect = menu.getBoundingClientRect();
        const anchor = window
          .getSelection()
          ?.getRangeAt(0)
          .getBoundingClientRect();
        return {
          menu: bounds(rect),
          anchor: anchor ? bounds(anchor) : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          anchorInViewport:
            !!anchor &&
            anchor.right >= 0 &&
            anchor.left <= window.innerWidth &&
            anchor.bottom >= 0 &&
            anchor.top <= window.innerHeight,
          side: menu.getAttribute("data-side"),
          within:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= window.innerWidth &&
            rect.bottom <= window.innerHeight,
        };
      });
    if (!position.within && position.anchorInViewport)
      throw new Error(
        `slash menu is clipped beyond the viewport (${JSON.stringify(position)})`,
      );
  };
  const runSlashCommand = async (
    command: string,
    key: "Enter" | "Tab" = "Enter",
  ) => {
    await openSlashMenu();
    const commandIndex = SLASH_COMMANDS.findIndex(
      ([value]) => value === command,
    );
    if (commandIndex < 0) throw new Error(`unknown slash command ${command}`);
    for (let index = 0; index < commandIndex; index += 1)
      await page.keyboard.press("ArrowDown");
    const activeOptionId = await page
      .locator(`[role="listbox"] [role="option"][data-value="${command}"]`)
      .getAttribute("id");
    if (
      !activeOptionId ||
      (await editor.getAttribute("aria-activedescendant")) !== activeOptionId
    ) {
      throw new Error(`slash menu did not select ${command}`);
    }
    const withTrigger = await inspectSelection();
    await page.keyboard.press(key);
    await page
      .locator('[role="listbox"]')
      .waitFor({ state: "hidden", timeout: 1500 });
    if (
      slashCount((await inspectSelection()).text) !==
      slashCount(withTrigger.text) - 1
    )
      throw new Error(`${command} did not consume its slash query`);
  };
  const selectToken = async (token: string, edge?: "start" | "end") =>
    editor.evaluate(
      (
        root: HTMLElement,
        target: { token: string; edge?: "start" | "end" },
      ) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const points: Array<{ text: Text; offset: number }> = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text;
          for (let offset = 0; offset < text.length; offset += 1) {
            if (text.data[offset] !== "\u200b") {
              points.push({ text, offset });
            }
          }
        }
        const visible = points
          .map(({ text, offset }) =>
            text.data[offset] === "\u00a0" ? " " : text.data[offset],
          )
          .join("");
        const index = visible.lastIndexOf(target.token);
        if (index < 0) throw new Error("could not locate fuzz token");
        const start = points[index]!;
        const last = points[index + target.token.length - 1]!;
        const selected = document.createRange();
        if (target.edge === "end") {
          selected.setStart(last.text, last.offset + 1);
          selected.collapse(true);
        } else {
          selected.setStart(start.text, start.offset);
          if (target.edge === "start") selected.collapse(true);
          else selected.setEnd(last.text, last.offset + 1);
        }
        const selection = window.getSelection();
        if (!selection) throw new Error("browser selection is unavailable");
        selection.removeAllRanges();
        selection.addRange(selected);
      },
      { token, edge },
    );
  const placeCaretAtToken = async (token: string, edge: "start" | "end") => {
    await selectToken(token, edge);
  };
  const listRowCount = async (kind: "styled" | "ul" | "ol") =>
    editor.evaluate((root: HTMLElement, type: string) => {
      if (type === "styled") {
        const rows = [
          ...(root.matches("div") ? [root] : []),
          ...Array.from(root.querySelectorAll<HTMLElement>("div")),
        ];
        return rows.filter((row) => {
          const marker = row.firstElementChild;
          const text = row.lastElementChild;
          return (
            getComputedStyle(row).display === "flex" &&
            marker?.tagName === "SPAN" &&
            /^[•●◦▪‣·⁃–—-]+$/u.test(marker.textContent?.trim() ?? "") &&
            text?.tagName === "SPAN"
          );
        }).length;
      }
      return root.querySelectorAll(`${type} > li`).length;
    }, kind);
  const createList = async (kind: "styled" | "ul" | "ol") => {
    const before = await listRowCount(kind);
    const suffix = activeIndex.toString(36);
    const firstToken = `firstFuzz${suffix}`;
    const secondToken = `secondFuzz${suffix}`;
    await newPlainLine(`${kind} list`);
    let afterShortcut = before;
    if (kind === "styled") {
      await typeText("- ", false);
      afterShortcut = await listRowCount(kind);
      await typeText(firstToken);
    } else {
      await runSlashCommand(kind === "ul" ? "bulletList" : "orderedList");
      await typeText(firstToken);
    }
    const afterFirst = await listRowCount(kind);
    await editor.press(lineEndKey);
    await editor.press("Enter");
    await typeText(secondToken);
    const after = await listRowCount(kind);
    if (after <= before) {
      const state = await editor.evaluate(
        (root: HTMLElement, tokens: string[]) => {
          const selection = window.getSelection();
          const anchor = selection?.anchorNode;
          const element =
            anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
          const tokenBlock = (token: string) => {
            const walker = document.createTreeWalker(
              root,
              NodeFilter.SHOW_TEXT,
            );
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (!(node as Text).data.includes(token)) continue;
              const block = (node as Text).parentElement?.closest<HTMLElement>(
                "p,div,h1,h2,h3,h4,h5,h6,blockquote,li,pre",
              );
              const text = block?.textContent ?? "";
              return {
                tag: block?.tagName ?? null,
                length: text.length,
                shortcutPrefixRemains: text.includes(`- ${token}`),
              };
            }
            return null;
          };
          return {
            focused: document.activeElement === root,
            caretInside: !!anchor && root.contains(anchor),
            anchorTag: element?.tagName ?? null,
            rootDisplay: getComputedStyle(root).display,
            firstTokenPresent: root.textContent?.includes(tokens[0] ?? ""),
            secondTokenPresent: root.textContent?.includes(tokens[1] ?? ""),
            firstTokenBlock: tokenBlock(tokens[0] ?? ""),
          };
        },
        [firstToken, secondToken],
      );
      throw new Error(
        `${kind} list operation added no list row (${JSON.stringify({ before, afterShortcut, afterFirst, after, state })})`,
      );
    }
    return { firstToken, secondToken };
  };
  const isNestedListToken = async (token: string) =>
    editor.evaluate((root: HTMLElement, value: string) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node as Text).data.includes(value)) continue;
        const item = (node as Text).parentElement?.closest("li");
        return !!item?.parentElement?.parentElement?.closest("li");
      }
      return false;
    }, token);
  const rowIndent = async (token: string) =>
    editor.evaluate((root: HTMLElement, value: string) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node as Text).data.includes(value)) continue;
        const row = (node as Text).parentElement?.closest<HTMLElement>(
          '[style*="display: flex"]',
        );
        return row
          ? Number.parseFloat(getComputedStyle(row).paddingLeft)
          : null;
      }
      return null;
    }, token);
  const paste = async (html: string | null, text: string) =>
    editor.evaluate(
      (root: HTMLElement, data: { html: string | null; text: string }) => {
        const clipboard = new DataTransfer();
        clipboard.setData("text/plain", data.text);
        if (data.html) clipboard.setData("text/html", data.html);
        const event = new Event("paste", {
          bubbles: true,
          cancelable: true,
        }) as ClipboardEvent;
        // Firefox drops clipboardData from synthetic ClipboardEvent constructors.
        Object.defineProperty(event, "clipboardData", { value: clipboard });
        root.dispatchEvent(event);
        const selection = window.getSelection();
        return {
          defaultPrevented: event.defaultPrevented,
          clipboardText: event.clipboardData?.getData("text/plain") ?? null,
          focused: document.activeElement === root,
          selectionInside: Boolean(
            selection &&
            root.contains(selection.anchorNode) &&
            root.contains(selection.focusNode),
          ),
          selectionCollapsed: selection?.isCollapsed ?? null,
        };
      },
      { html, text },
    );
  const copySelection = async () =>
    editor.evaluate((root: HTMLElement) => {
      const clipboard = new DataTransfer();
      const event = new Event("copy", {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", { value: clipboard });
      root.dispatchEvent(event);
      if (!event.defaultPrevented) {
        throw new Error("the editor did not handle rich inline copy");
      }
      return {
        html: clipboard.getData("text/html"),
        text: clipboard.getData("text/plain"),
      };
    });
  const assertRichPasteStructure = async (suffix: string) => {
    const state = await editor.evaluate(
      (root: HTMLElement, tokenSuffix: string) => {
        const tokenNode = (token: string) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if ((node as Text).data.includes(token)) return node as Text;
          }
          return null;
        };
        const inside = (node: Text | null, selector: string) =>
          !!node?.parentElement?.closest(selector);
        const bold = tokenNode(`DocsBold${tokenSuffix}`);
        const italic = tokenNode(`DocStyleTwo${tokenSuffix}`);
        const listItems = Array.from(root.querySelectorAll("ul > li"));
        return {
          boldPreserved: inside(bold, "strong, b, span[style*='font-weight']"),
          italicPreserved: inside(italic, "em, i, span[style*='font-style']"),
          listItemsPreserved:
            listItems.filter(
              (item) =>
                (item.textContent ?? "").includes(
                  `DocStyleOne${tokenSuffix}`,
                ) ||
                (item.textContent ?? "").includes(`DocStyleTwo${tokenSuffix}`),
            ).length >= 2,
        };
      },
      suffix,
    );
    if (!state.boldPreserved)
      throw new Error("rich paste lost the Docs bold formatting");
    if (!state.italicPreserved)
      throw new Error("rich paste lost the inline italic formatting");
    if (!state.listItemsPreserved)
      throw new Error("rich paste lost the list structure");
  };
  const makeCrossBlockSelection = async () => {
    const { firstToken, secondToken } = await createList("ul");
    await editor.evaluate(
      (root: HTMLElement, tokens: string[]) => {
        const points: Array<{ text: Text; offset: number }> = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text;
          for (let offset = 0; offset < text.length; offset += 1) {
            if (text.data[offset] !== "\u200b") points.push({ text, offset });
          }
        }
        const visible = points
          .map(({ text, offset }) =>
            text.data[offset] === "\u00a0" ? " " : text.data[offset],
          )
          .join("");
        const firstAt = visible.indexOf(tokens[0] ?? "");
        const secondAt = visible.indexOf(
          tokens[1] ?? "",
          firstAt + (tokens[0]?.length ?? 0),
        );
        if (firstAt < 0 || secondAt < 0)
          throw new Error("could not locate cross-block fuzz tokens");
        const first = points[firstAt]!;
        const last = points[secondAt]!;
        let firstBlock = first.text.parentElement;
        let lastBlock = last.text.parentElement;
        while (
          firstBlock &&
          firstBlock !== root &&
          !/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(firstBlock.tagName)
        )
          firstBlock = firstBlock.parentElement;
        while (
          lastBlock &&
          lastBlock !== root &&
          !/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(lastBlock.tagName)
        )
          lastBlock = lastBlock.parentElement;
        if (!firstBlock || !lastBlock || firstBlock === lastBlock) {
          throw new Error("fuzz tokens did not land in separate blocks");
        }
        const range = document.createRange();
        range.setStart(first.text, first.offset);
        range.setEnd(last.text, last.offset + 1);
        const selection = window.getSelection();
        if (!selection) throw new Error("browser selection is unavailable");
        selection.removeAllRanges();
        selection.addRange(range);
      },
      [firstToken, secondToken],
    );
  };
  const dispatchReplacement = async () => {
    await newPlainLine("replacement");
    const before = await inspectSelection();
    if (!before.inside || !before.collapsed)
      throw new Error("replacement needs a caret in the editor");
    await typeText("teh");
    const state = await inspectSelection();
    if (!state.inside) throw new Error("autocorrect sample left the editor");
    await selectToken("teh");
    const selected = await inspectSelection();
    const expected =
      selected.text.slice(0, selected.start) +
      "the" +
      selected.text.slice(selected.end);
    await editor.evaluate((root: HTMLElement) => {
      const selection = window.getSelection();
      if (!selection?.rangeCount)
        throw new Error("autocorrect selection is unavailable");
      const target = selection.getRangeAt(0).cloneRange();
      if (target.toString().replaceAll("\u200b", "") !== "teh") {
        throw new Error(
          "autocorrect target range did not select the typed token",
        );
      }
      selection.collapse(root, root.childNodes.length);
      const event = new InputEvent("beforeinput", {
        inputType: "insertReplacementText",
        data: "the",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "getTargetRanges", {
        value: () => [target],
      });
      root.dispatchEvent(event);
    });
    const after = await inspectSelection();
    if (
      !after.inside ||
      after.text !== expected ||
      after.start !== selected.start + "the".length
    )
      throw new Error(
        "insertReplacementText did not replace the selected token at its range",
      );
  };

  try {
    await editor.waitFor({ state: "visible", timeout: 5000 });
    if (options.expectScaledSlide) {
      await assertSlideIsScaled(page, slideSelector);
    }
    const { originalHtml, originalSlideHtml } = options;
    const outsideBefore = await snapshotOutside();

    for (activeIndex = 0; activeIndex < plan.length; activeIndex += 1) {
      activePhase = `step ${activeIndex}`;
      const operation = plan[activeIndex];
      await snapshotEditorSiblings("capture", operation);
      switch (operation.kind) {
        case "type":
          await typeText(operation.value);
          break;
        case "shortcut":
          await newPlainLine(`${operation.result} shortcut`);
          {
            const before = await shortcutResultCount(operation.result);
            const prefix = operation.value.slice(0, -1);
            const trigger = operation.value.slice(-1);
            await typeBurst(prefix, operation.result !== "divider");
            const beforeTrigger = await shortcutState();
            await typeBurst(trigger, false);
            await assertShortcut(operation.result, before, beforeTrigger);
            await typeBurst("q", true);
          }
          break;
        case "slash": {
          await runSlashCommand(operation.value);
          await typeBurst("q", true);
          break;
        }
        case "slash-tab":
          await runSlashCommand("heading2", "Tab");
          break;
        case "slash-escape": {
          const before = await inspectSelection();
          await openSlashMenu();
          const withTrigger = await inspectSelection();
          if (slashCount(withTrigger.text) !== slashCount(before.text) + 1)
            throw new Error("slash menu did not insert a single trigger token");
          await page.keyboard.press("Escape");
          await page
            .locator('[role="listbox"]')
            .waitFor({ state: "hidden", timeout: 1500 });
          if (
            slashCount((await inspectSelection()).text) !==
            slashCount(withTrigger.text)
          )
            throw new Error("Escape changed the unselected slash token");
          break;
        }
        case "slash-filter": {
          await openSlashMenu();
          await typeText("zz-no-command");
          await page
            .locator('[role="listbox"]')
            .waitFor({ state: "hidden", timeout: 1500 });
          await openSlashMenu();
          await typeText("heading 2");
          const options = page.locator('[role="listbox"] [role="option"]');
          if ((await options.count()) !== 1)
            throw new Error("slash query did not filter to one command");
          const headingOptionId = await options.getAttribute("id");
          if (
            !headingOptionId ||
            (await editor.getAttribute("aria-activedescendant")) !==
              headingOptionId
          ) {
            throw new Error("slash filtering selected the wrong command");
          }
          const withQuery = await inspectSelection();
          await page.keyboard.press("Enter");
          await page
            .locator('[role="listbox"]')
            .waitFor({ state: "hidden", timeout: 1500 });
          if (
            slashCount((await inspectSelection()).text) !==
            slashCount(withQuery.text) - 1
          )
            throw new Error("filtered slash command did not consume its query");
          break;
        }
        case "slash-away":
          await openSlashMenu();
          await page.keyboard.press("ArrowLeft");
          await page
            .locator('[role="listbox"]')
            .waitFor({ state: "hidden", timeout: 1500 });
          break;
        case "slash-delete":
          await openSlashMenu();
          {
            const beforeDelete = await inspectSelection();
            await page.keyboard.press("Backspace");
            await page
              .locator('[role="listbox"]')
              .waitFor({ state: "hidden", timeout: 1500 });
            if (
              slashCount((await inspectSelection()).text) !==
              slashCount(beforeDelete.text) - 1
            )
              throw new Error(
                "deleting slash did not remove its trigger token",
              );
          }
          break;
        case "slash-position": {
          await newLine();
          await typeText("and");
          await page
            .locator('[role="listbox"]')
            .waitFor({ state: "hidden", timeout: 1500 });
          await typeText("/");
          await page
            .locator('[role="listbox"]')
            .waitFor({ state: "hidden", timeout: 1500 });
          await typeText("or https:");
          await typeText("/");
          await page
            .locator('[role="listbox"]')
            .waitFor({ state: "hidden", timeout: 1500 });
          await typeText("/example.com ");
          await typeText("/");
          await page
            .locator('[role="listbox"] [role="option"]')
            .first()
            .waitFor({ state: "visible", timeout: 1500 });
          await page.keyboard.press("Escape");
          await page
            .locator('[role="listbox"]')
            .waitFor({ state: "hidden", timeout: 1500 });
          break;
        }
        case "slash-outside":
          await openSlashMenu();
          {
            const point = await editor.evaluate((root: HTMLElement) => {
              const menu = document.querySelector('[role="listbox"]');
              const overlay =
                menu?.closest<HTMLElement>(
                  "[data-radix-popper-content-wrapper]",
                ) ?? menu;
              const rect = root.getBoundingClientRect();
              const candidates = [
                [rect.left + 2, rect.top + 2],
                [rect.right - 2, rect.top + 2],
                [rect.left + 2, rect.bottom - 2],
                [rect.right - 2, rect.bottom - 2],
                [rect.left + rect.width / 2, rect.top + 2],
                [rect.left + rect.width / 2, rect.bottom - 2],
              ];
              return candidates.find(([x, y]) => {
                if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight)
                  return false;
                const hit = document.elementFromPoint(x, y);
                return !!hit && root.contains(hit) && !overlay?.contains(hit);
              });
            });
            if (!point) {
              throw new Error(
                "could not find an in-editor point outside the slash menu",
              );
            }
            await page.mouse.click(point[0], point[1]);
          }
          await page
            .locator('[role="listbox"]')
            .waitFor({ state: "hidden", timeout: 1500 });
          await assertCaret();
          break;
        case "shortcut-undo": {
          await newLine();
          await typeText("# ", true, true);
          const converted = await editor.evaluate(
            (root: HTMLElement) =>
              root.matches("h1") || !!root.querySelector("h1"),
          );
          if (!converted)
            throw new Error("heading shortcut did not convert before undo");
          await page.keyboard.press(`${modifier}+Z`);
          if (!(await inspectSelection()).text.includes("# ")) {
            throw new Error(
              "undo did not restore literal heading shortcut text",
            );
          }
          break;
        }
        case "slash-undo": {
          await newLine();
          await typeText("/heading 2");
          await page
            .locator('[role="listbox"] [role="option"]')
            .first()
            .waitFor({ state: "visible", timeout: 1500 });
          await page.keyboard.press("Enter");
          await page.keyboard.press(`${modifier}+Z`);
          if (!(await inspectSelection()).text.includes("/heading 2")) {
            throw new Error("undo did not restore literal slash command text");
          }
          break;
        }
        case "heading-backspace":
        case "quote-backspace": {
          await newPlainLine();
          await runSlashCommand(
            operation.kind === "heading-backspace" ? "heading2" : "quote",
          );
          const token = `edge${activeIndex}`;
          await typeText(token);
          await placeCaretAtToken(token, "start");
          const blockSelector =
            operation.kind === "heading-backspace"
              ? "h1,h2,h3,h4,h5,h6"
              : "blockquote";
          const tokenInBlock = await editor.evaluate(
            (root: HTMLElement, values: { selector: string; token: string }) =>
              (root.matches(values.selector) ? [root] : [])
                .concat(
                  Array.from(
                    root.querySelectorAll<HTMLElement>(values.selector),
                  ),
                )
                .some((block) => block.textContent?.includes(values.token)),
            { selector: blockSelector, token },
          );
          if (!tokenInBlock) {
            throw new Error(
              `${operation.kind} setup did not place its token in the requested block`,
            );
          }
          await editor.evaluate((root: HTMLElement) => {
            const scope = window as Window & {
              __authoringFuzzDeleteProbe?: {
                events: Array<Record<string, unknown>>;
                listener: (event: Event) => void;
              };
            };
            const events: Array<Record<string, unknown>> = [];
            const listener = (event: Event) => {
              const input = event as InputEvent;
              const record = {
                inputType: input.inputType,
                cancelable: input.cancelable,
                defaultPrevented: false,
                isComposing: input.isComposing,
                targetTag:
                  input.target instanceof Element
                    ? input.target.tagName
                    : input.target instanceof Node
                      ? input.target.nodeName
                      : null,
                eventPhase: input.eventPhase,
                selection: (() => {
                  const selection = window.getSelection();
                  const range = selection?.rangeCount
                    ? selection.getRangeAt(0)
                    : null;
                  return {
                    collapsed: selection?.isCollapsed ?? false,
                    inside:
                      !!selection &&
                      root.contains(selection.anchorNode) &&
                      root.contains(selection.focusNode),
                    startTag:
                      range?.startContainer instanceof Element
                        ? range.startContainer.tagName
                        : (range?.startContainer.parentElement?.tagName ??
                          null),
                    startOffset: range?.startOffset ?? null,
                    startTextLength:
                      range?.startContainer instanceof Text
                        ? range.startContainer.length
                        : null,
                    boundary:
                      range?.startContainer instanceof Element
                        ? {
                            childCount: range.startContainer.childNodes.length,
                            before:
                              range.startContainer.childNodes[
                                range.startOffset - 1
                              ]?.nodeName ?? null,
                            at:
                              range.startContainer.childNodes[range.startOffset]
                                ?.nodeName ?? null,
                            after:
                              range.startContainer.childNodes[
                                range.startOffset + 1
                              ]?.nodeName ?? null,
                            ancestors: (() => {
                              const tags: string[] = [];
                              for (
                                let current: Element | null =
                                  range.startContainer as Element;
                                current && root.contains(current);
                                current = current.parentElement
                              ) {
                                tags.push(current.tagName);
                                if (current === root) break;
                              }
                              return tags;
                            })(),
                          }
                        : null,
                  };
                })(),
              };
              events.push(record);
              queueMicrotask(() => {
                record.defaultPrevented = input.defaultPrevented;
              });
            };
            root.addEventListener("beforeinput", listener, true);
            scope.__authoringFuzzDeleteProbe = { events, listener };
          });
          await editor.press("Backspace");
          const deleteInputEvents = await editor.evaluate(
            (root: HTMLElement) => {
              const scope = window as Window & {
                __authoringFuzzDeleteProbe?: {
                  events: Array<Record<string, unknown>>;
                  listener: (event: Event) => void;
                };
              };
              const probe = scope.__authoringFuzzDeleteProbe;
              if (probe) {
                root.removeEventListener("beforeinput", probe.listener, true);
                delete scope.__authoringFuzzDeleteProbe;
              }
              return probe?.events ?? [];
            },
          );
          const demotion = await editor.evaluate(
            (
              root: HTMLElement,
              values: { selector: string; token: string },
            ) => {
              const blocks = [
                ...(root.matches(values.selector) ? [root] : []),
                ...Array.from(
                  root.querySelectorAll<HTMLElement>(values.selector),
                ),
              ];
              return {
                tokenPresent: root.textContent?.includes(values.token) ?? false,
                remainingBlockTag:
                  blocks.find((block) =>
                    block.textContent?.includes(values.token),
                  )?.tagName ?? null,
              };
            },
            { selector: blockSelector, token },
          );
          if (!demotion.tokenPresent || demotion.remainingBlockTag) {
            throw new Error(
              `${operation.kind} did not demote the block (${JSON.stringify({ ...demotion, deleteInputEvents })})`,
            );
          }
          await editor.press("Backspace");
          if (!(await inspectSelection()).text.includes(token)) {
            throw new Error(`${operation.kind} second Backspace lost text`);
          }
          break;
        }
        case "heading-enter": {
          await runSlashCommand("heading2");
          const token = `heading${activeIndex}`;
          await typeText(token);
          await editor.press(lineEndKey);
          await editor.press("Enter");
          const plainSibling = await editor.evaluate((root: HTMLElement) =>
            Array.from(root.querySelectorAll("h2")).some(
              (heading) => heading.nextElementSibling?.tagName === "P",
            ),
          );
          if (!plainSibling)
            throw new Error("Enter at heading end did not create a paragraph");
          break;
        }
        case "quote-exit": {
          await runSlashCommand("quote");
          const token = `quote${activeIndex}`;
          await typeText(token);
          const quoteContainsToken = await editor.evaluate(
            (root: HTMLElement, value: string) =>
              Array.from(root.querySelectorAll("blockquote")).some((quote) =>
                quote.textContent?.includes(value),
              ),
            token,
          );
          if (!quoteContainsToken) {
            throw new Error("slash quote did not contain its token");
          }
          await editor.press("Enter");
          await editor.press("Enter");
          const after = `after${activeIndex}`;
          await typeText(after);
          const exited = await editor.evaluate(
            (root: HTMLElement, values: { token: string; after: string }) =>
              Array.from(root.querySelectorAll("blockquote")).some((quote) => {
                if (!quote.textContent?.includes(values.token)) return false;
                const following = Array.from(
                  root.querySelectorAll<HTMLElement>("p"),
                ).find((paragraph) =>
                  paragraph.textContent?.includes(values.after),
                );
                return (
                  !!following &&
                  Boolean(
                    quote.compareDocumentPosition(following) &
                    Node.DOCUMENT_POSITION_FOLLOWING,
                  )
                );
              }),
            { token, after },
          );
          if (!exited)
            throw new Error(
              "Enter did not exit the quote into a following paragraph",
            );
          break;
        }
        case "empty-list-exit": {
          await runSlashCommand("bulletList");
          await typeText(`list${activeIndex}`);
          await editor.press(lineEndKey);
          await editor.press("Enter");
          await editor.press("Enter");
          const exited = await editor.evaluate((root: HTMLElement) =>
            Array.from(root.querySelectorAll("ul,ol")).some(
              (list) => list.nextElementSibling?.tagName === "P",
            ),
          );
          if (!exited)
            throw new Error(
              "Enter on an empty list item did not exit the list",
            );
          break;
        }
        case "soft-break": {
          await newLine();
          await typeText(`soft${activeIndex}`);
          const breaksBefore = await editor.locator("br").count();
          await editor.evaluate((root: HTMLElement) => {
            const scope = window as Window & {
              __authoringSoftBreakProbe?: {
                root: HTMLElement;
                events: Array<Record<string, unknown>>;
                keydown: (event: KeyboardEvent) => void;
                beforeinput: (event: InputEvent) => void;
              };
            };
            const events: Array<Record<string, unknown>> = [];
            const keydown = (event: KeyboardEvent) => {
              events.push({
                type: "keydown",
                key: event.key,
                shiftKey: event.shiftKey,
                defaultPrevented: event.defaultPrevented,
              });
            };
            const beforeinput = (event: InputEvent) => {
              const record: Record<string, unknown> = {
                type: "beforeinput",
                inputType: event.inputType,
                cancelable: event.cancelable,
                defaultPrevented: event.defaultPrevented,
              };
              events.push(record);
              queueMicrotask(() => {
                record.defaultPrevented = event.defaultPrevented;
              });
            };
            root.addEventListener("keydown", keydown, true);
            root.addEventListener("beforeinput", beforeinput, true);
            scope.__authoringSoftBreakProbe = {
              root,
              events,
              keydown,
              beforeinput,
            };
          });
          await editor.press("Shift+Enter");
          const softBreakResult = await editor.evaluate(
            (root: HTMLElement, before: number) => {
              const scope = window as Window & {
                __authoringSoftBreakProbe?: {
                  root: HTMLElement;
                  events: Array<Record<string, unknown>>;
                  keydown: (event: KeyboardEvent) => void;
                  beforeinput: (event: InputEvent) => void;
                };
              };
              const probe = scope.__authoringSoftBreakProbe;
              if (!probe || probe.root !== root) {
                return {
                  breaksBefore: before,
                  breaksAfter: root.querySelectorAll("br").length,
                  events: [],
                };
              }
              root.removeEventListener("keydown", probe.keydown, true);
              root.removeEventListener("beforeinput", probe.beforeinput, true);
              delete scope.__authoringSoftBreakProbe;
              return {
                breaksBefore: before,
                breaksAfter: root.querySelectorAll("br").length,
                focused: document.activeElement === root,
                caretInside:
                  !!window.getSelection()?.anchorNode &&
                  root.contains(window.getSelection()!.anchorNode),
                events: probe.events,
              };
            },
            breaksBefore,
          );
          if (softBreakResult.breaksAfter <= softBreakResult.breaksBefore) {
            throw new Error(
              `Shift+Enter did not insert a soft break (${JSON.stringify(softBreakResult)})`,
            );
          }
          await typeText(`line${activeIndex}`);
          break;
        }
        case "list":
          await createList(operation.value);
          break;
        case "enter-block-edge":
          await editor.press(lineStartKey);
          await editor.press("Enter");
          break;
        case "backspace-block-edge":
          await editor.press(lineStartKey);
          await editor.press("Backspace");
          break;
        case "delete-block-edge":
          await editor.press(lineStartKey);
          await editor.press("Delete");
          break;
        case "enter-list-edge":
          await createList("ul");
          {
            const before = await listRowCount("ul");
            await editor.press(lineEndKey);
            await editor.press("Enter");
            if ((await listRowCount("ul")) <= before)
              throw new Error("Enter did not add a list item at the list edge");
          }
          break;
        case "backspace-list-edge":
          {
            const { firstToken, secondToken } = await createList("styled");
            const before = await listRowCount("styled");
            await placeCaretAtToken(secondToken, "start");
            await editor.press("Backspace");
            await editor.press("Backspace");
            const text = (await inspectSelection()).text;
            if (
              !text.includes(firstToken) ||
              !text.includes(secondToken) ||
              (await listRowCount("styled")) >= before
            ) {
              throw new Error("Backspace did not join adjacent styled rows");
            }
          }
          break;
        case "delete-list-edge":
          {
            const { firstToken, secondToken } = await createList("ol");
            const before = await listRowCount("ol");
            await placeCaretAtToken(firstToken, "end");
            await editor.press("Delete");
            const text = (await inspectSelection()).text;
            if (
              !text.includes(firstToken) ||
              !text.includes(secondToken) ||
              (await listRowCount("ol")) >= before
            ) {
              throw new Error("Delete did not join adjacent ordered items");
            }
          }
          break;
        case "tab": {
          const { secondToken } = await createList(operation.list);
          await placeCaretAtToken(secondToken, "end");
          if (operation.list === "styled") {
            const before = await rowIndent(secondToken);
            await editor.press("Tab");
            const after = await rowIndent(secondToken);
            if (before === null || after === null || after <= before)
              throw new Error("Tab did not indent the styled bullet row");
          } else {
            await editor.press("Tab");
            if (!(await isNestedListToken(secondToken)))
              throw new Error(`Tab did not nest the ${operation.list} item`);
          }
          break;
        }
        case "shift-tab": {
          const { secondToken } = await createList(operation.list);
          await placeCaretAtToken(secondToken, "end");
          if (operation.list === "styled") {
            const original = await rowIndent(secondToken);
            await editor.press("Tab");
            const indented = await rowIndent(secondToken);
            await page.keyboard.press("Shift+Tab");
            const outdented = await rowIndent(secondToken);
            if (
              original === null ||
              indented === null ||
              outdented === null ||
              indented <= original ||
              outdented >= indented
            ) {
              throw new Error(
                "Shift-Tab did not outdent the styled bullet row",
              );
            }
          } else {
            await editor.press("Tab");
            if (!(await isNestedListToken(secondToken)))
              throw new Error(`Tab did not nest the ${operation.list} item`);
            await placeCaretAtToken(secondToken, "end");
            await page.keyboard.press("Shift+Tab");
            if (await isNestedListToken(secondToken))
              throw new Error(
                `Shift-Tab did not outdent the ${operation.list} item`,
              );
          }
          break;
        }
        case "paste-plain":
          {
            const token = `plainpaste${activeIndex}`;
            const before = await inspectSelection();
            const event = await paste(null, token);
            const after = await inspectSelection();
            if (!after.text.includes(token)) {
              throw new Error(
                `plain paste did not insert at the selection: ${JSON.stringify({ event, before: { inside: before.inside, collapsed: before.collapsed, start: before.start, end: before.end }, after: { inside: after.inside, collapsed: after.collapsed, start: after.start, end: after.end } })}`,
              );
            }
          }
          break;
        case "paste-rich": {
          const suffix = String(activeIndex);
          await paste(
            `<p><strong>DocsBold${suffix}</strong> richpaste${suffix}</p><ul><li>DocStyleOne${suffix}</li><li><em>DocStyleTwo${suffix}</em></li></ul>`,
            `DocsBold${suffix} richpaste${suffix} DocStyleOne${suffix} DocStyleTwo${suffix}`,
          );
          if (!(await inspectSelection()).text.includes(`DocStyleTwo${suffix}`))
            throw new Error("rich paste did not insert the document sample");
          await assertRichPasteStructure(suffix);
          break;
        }
        case "paste-markdown": {
          await newLine();
          await paste(
            null,
            "# Fuzz heading\n- Fuzz one\n  - Fuzz nested\n- Fuzz two\n> Fuzz quote",
          );
          const blocks = await editor.evaluate((root: HTMLElement) => ({
            heading: Array.from(root.querySelectorAll("h1")).some(
              (node) => node.textContent === "Fuzz heading",
            ),
            nested: Array.from(root.querySelectorAll("ul > li ul > li")).some(
              (node) => node.textContent === "Fuzz nested",
            ),
            quote: Array.from(root.querySelectorAll("blockquote")).some(
              (node) => node.textContent === "Fuzz quote",
            ),
          }));
          if (!blocks.heading || !blocks.nested || !blocks.quote) {
            throw new Error("plain Markdown paste did not create its blocks");
          }
          break;
        }
        case "paste-url": {
          await newLine();
          const token = `url${activeIndex}`;
          await typeText(token);
          await selectToken(token);
          await paste(null, "https://example.com/fuzz");
          const linked = await editor.evaluate(
            (root: HTMLElement, value: string) =>
              Array.from(root.querySelectorAll<HTMLAnchorElement>("a")).some(
                (anchor) =>
                  anchor.textContent === value &&
                  anchor.href === "https://example.com/fuzz",
              ),
            token,
          );
          if (!linked) throw new Error("URL paste did not link the selection");
          break;
        }
        case "link-shortcut": {
          const assertSetupUnchanged = async (stage: string) => {
            try {
              await snapshotEditorSiblings("assert", operation);
            } catch (error) {
              throw new Error(
                `link shortcut ${stage} changed a sibling: ${String(error)}`,
              );
            }
            await snapshotEditorSiblings("capture", operation);
          };
          await newLine();
          await assertSetupUnchanged("line creation");
          const token = `link${activeIndex}`;
          await typeText(token);
          await assertSetupUnchanged("typing");
          await selectToken(token);
          await assertSetupUnchanged("selection");
          const unmaskMenu = await page.addStyleTag({
            content:
              '[data-block-bubble-menu="true"] { visibility: visible !important; }',
          });
          try {
            await page.keyboard.press(modifier + "+K");
            const input = page.locator(
              '[data-block-bubble-menu="true"] input[placeholder]:visible',
            );
            await input.waitFor({ state: "visible", timeout: 5000 });
            await input.fill("https://example.com/keyboard");
            await input.press("Enter");
            const linked = await editor.evaluate(
              (root: HTMLElement, value: string) => {
                const selection = window.getSelection();
                const range =
                  selection?.rangeCount && !selection.isCollapsed
                    ? selection.getRangeAt(0)
                    : null;
                if (
                  !range ||
                  range.toString() !== value ||
                  !root.contains(range.commonAncestorContainer)
                ) {
                  return false;
                }
                let selectedText = "";
                const walker = document.createTreeWalker(
                  root,
                  NodeFilter.SHOW_TEXT,
                );
                for (
                  let node = walker.nextNode() as Text | null;
                  node;
                  node = walker.nextNode() as Text | null
                ) {
                  if (!range.intersectsNode(node)) continue;
                  const start =
                    node === range.startContainer ? range.startOffset : 0;
                  const end =
                    node === range.endContainer
                      ? range.endOffset
                      : node.data.length;
                  if (start >= end) continue;
                  const anchor = node.parentElement?.closest("a");
                  if (
                    !anchor ||
                    anchor.href !== "https://example.com/keyboard"
                  ) {
                    return false;
                  }
                  selectedText += node.data.slice(start, end);
                }
                return selectedText === value;
              },
              token,
            );
            if (!linked)
              throw new Error("Mod+K did not link all of the selected text");
          } finally {
            await unmaskMenu.evaluate((style: HTMLStyleElement) =>
              style.remove(),
            );
          }
          break;
        }
        case "vertical-navigation": {
          await newPlainLine("vertical navigation");
          const firstLine = "x".repeat(24);
          const secondLine = "x".repeat(16);
          await typeText(firstLine);
          await editor.press("Shift+Enter");
          await typeText(secondLine);
          const before = await inspectSelection();
          const beforeRect = await editor.evaluate(
            (root: HTMLElement, expected: string) => {
              const selection = window.getSelection();
              const range = selection?.rangeCount
                ? selection.getRangeAt(0)
                : null;
              const rect = range?.getBoundingClientRect();
              const anchor = selection?.anchorNode;
              const element =
                anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
              const block = element?.closest<HTMLElement>(
                "p,div,h1,h2,h3,h4,h5,h6,blockquote,li,pre",
              );
              const localText = (block?.textContent ?? root.textContent ?? "")
                .replaceAll("\u200b", "")
                .replaceAll("\ufeff", "")
                .replaceAll("\u00a0", "");
              return {
                focused: document.activeElement === root,
                collapsed: selection?.isCollapsed ?? false,
                blockTag: block?.tagName ?? root.tagName,
                blockTextLength: localText.length,
                blockTailMatches: localText.endsWith(expected),
                x: rect?.x ?? null,
                y: rect?.y ?? null,
                height: rect?.height ?? 0,
              };
            },
            secondLine,
          );
          const lineStart = before.start - firstLine.length - secondLine.length;
          if (
            !before.inside ||
            !before.collapsed ||
            !beforeRect.blockTailMatches ||
            before.start !== lineStart + firstLine.length + secondLine.length ||
            !beforeRect.focused ||
            !beforeRect.collapsed ||
            beforeRect.x === null ||
            beforeRect.y === null ||
            beforeRect.height <= 0
          ) {
            throw new Error(
              `vertical-navigation setup did not reach the second line end (${JSON.stringify({ inside: before.inside, collapsed: before.collapsed, offset: before.start, lineStart, geometry: beforeRect })})`,
            );
          }
          await editor.evaluate((root: HTMLElement) => {
            const scope = window as Window & {
              __authoringVerticalKeyProbe?: {
                root: HTMLElement;
                events: Array<{
                  key: string;
                  trusted: boolean;
                  inside: boolean;
                }>;
                listener: (event: KeyboardEvent) => void;
              };
            };
            const events: Array<{
              key: string;
              trusted: boolean;
              inside: boolean;
            }> = [];
            const listener = (event: KeyboardEvent) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              events.push({
                key: event.key,
                trusted: event.isTrusted,
                inside:
                  event.target === root || root.contains(event.target as Node),
              });
            };
            root.addEventListener("keydown", listener, true);
            scope.__authoringVerticalKeyProbe = { root, events, listener };
          });
          await editor.press("ArrowUp");
          const up = await inspectSelection();
          const upRect = await editor.evaluate(() => {
            const range = window.getSelection()?.getRangeAt(0);
            const rect = range?.getBoundingClientRect();
            return { x: rect?.x ?? null, y: rect?.y ?? null };
          });
          if (
            !up.inside ||
            !up.collapsed ||
            up.start !== lineStart + secondLine.length ||
            beforeRect.x === null ||
            beforeRect.y === null ||
            upRect.x === null ||
            upRect.y === null ||
            Math.abs(beforeRect.x - upRect.x) > 4 ||
            upRect.y >= beforeRect.y
          ) {
            throw new Error(
              `ArrowUp did not preserve the caret column (${before.start} at ${beforeRect.x},${beforeRect.y} to ${up.start} at ${upRect.x},${upRect.y})`,
            );
          }
          await editor.press("ArrowDown");
          const down = await inspectSelection();
          const downRect = await editor.evaluate(() => {
            const range = window.getSelection()?.getRangeAt(0);
            const rect = range?.getBoundingClientRect();
            return { x: rect?.x ?? null, y: rect?.y ?? null };
          });
          const keyEvents = await editor.evaluate((root: HTMLElement) => {
            const scope = window as Window & {
              __authoringVerticalKeyProbe?: {
                root: HTMLElement;
                events: Array<{
                  key: string;
                  trusted: boolean;
                  inside: boolean;
                }>;
                listener: (event: KeyboardEvent) => void;
              };
            };
            const probe = scope.__authoringVerticalKeyProbe;
            if (!probe || probe.root !== root) return [];
            root.removeEventListener("keydown", probe.listener, true);
            delete scope.__authoringVerticalKeyProbe;
            return probe.events;
          });
          if (
            !down.inside ||
            !down.collapsed ||
            down.start !== before.start ||
            beforeRect.x === null ||
            beforeRect.y === null ||
            downRect.x === null ||
            downRect.y === null ||
            Math.abs(beforeRect.x - downRect.x) > 4 ||
            Math.abs(beforeRect.y - downRect.y) > 4 ||
            keyEvents.length !== 2 ||
            keyEvents.some(
              (
                event: { key: string; trusted: boolean; inside: boolean },
                index: number,
              ) =>
                event.key !== (index === 0 ? "ArrowUp" : "ArrowDown") ||
                !event.trusted ||
                !event.inside,
            )
          ) {
            throw new Error(
              `ArrowDown did not return the caret (${before.start} at ${beforeRect.x},${beforeRect.y} to ${down.start} at ${downRect.x},${downRect.y}; events=${JSON.stringify(keyEvents)})`,
            );
          }
          break;
        }
        case "select-cross-block-type": {
          await makeCrossBlockSelection();
          await typeText("R");
          break;
        }
        case "select-cross-block-delete": {
          await makeCrossBlockSelection();
          const selected = await inspectSelection();
          const expected =
            selected.text.slice(0, selected.start) +
            selected.text.slice(selected.end);
          await editor.press("Backspace");
          const after = await inspectSelection();
          if (after.text !== expected || after.start !== selected.start) {
            throw new Error("cross-block deletion missed the selected range");
          }
          break;
        }
        case "bold":
          await page.keyboard.press(`${modifier}+B`);
          await typeText("b");
          break;
        case "italic":
          await page.keyboard.press(`${modifier}+I`);
          await typeText("i");
          break;
        case "underline":
          await page.keyboard.press(`${modifier}+U`);
          await typeText("u");
          break;
        case "strike-shortcut":
          await page.keyboard.press(`${modifier}+Shift+S`);
          await typeText("s");
          break;
        case "code-shortcut": {
          await page.keyboard.press(`${modifier}+E`);
          const state = await editor.evaluate((root: HTMLElement) => {
            const selection = window.getSelection();
            const anchor = selection?.anchorNode;
            return {
              focused: document.activeElement === root,
              inside: !!anchor && root.contains(anchor),
              collapsed: selection?.isCollapsed ?? false,
              anchorTag:
                anchor instanceof Element
                  ? anchor.tagName
                  : anchor?.parentElement?.tagName,
              anchorOffset: selection?.anchorOffset ?? null,
            };
          });
          if (!state.inside || !state.collapsed) {
            throw new Error(
              `code shortcut lost the caret (${JSON.stringify(state)})`,
            );
          }
          await typeText("c");
          break;
        }
        case "copy-inline": {
          await newLine();
          const token = `copymark${activeIndex}`;
          await typeText(token);
          await selectToken(token);
          await page.keyboard.press(`${modifier}+B`);
          const copied = await copySelection();
          const copiedBold =
            /<(?:strong|b)\b|<span\b[^>]*style="[^"]*font-weight\s*:/i.test(
              copied.html,
            );
          if (!copiedBold) {
            throw new Error(
              `copy did not preserve the selected bold mark (HTML present: ${Boolean(copied.html)})`,
            );
          }
          await newPlainLine();
          await paste(copied.html, copied.text);
          const pastedMark = await editor.evaluate(
            (root: HTMLElement, value: string) => {
              const mark = Array.from(
                root.querySelectorAll<HTMLElement>(
                  "strong,b,span[style*='font-weight']",
                ),
              ).find((candidate) =>
                (candidate.textContent ?? "")
                  .replaceAll("\u200b", "")
                  .replaceAll("\u00a0", " ")
                  .includes(value),
              );
              return {
                preserved:
                  !!mark &&
                  (mark.matches("strong,b") ||
                    Number.parseInt(getComputedStyle(mark).fontWeight, 10) >=
                      600),
                tag: mark?.tagName ?? null,
                textLength: mark?.textContent?.length ?? 0,
                tokenIncluded:
                  mark?.textContent
                    ?.replaceAll("\u200b", "")
                    .replaceAll("\u00a0", " ")
                    .includes(value) ?? false,
              };
            },
            token,
          );
          if (!pastedMark.preserved) {
            throw new Error(
              `pasting copied rich text lost its bold mark (${JSON.stringify(pastedMark)})`,
            );
          }
          break;
        }
        case "replacement":
          await dispatchReplacement();
          break;
        case "undo":
          await page.keyboard.press(`${modifier}+Z`);
          break;
        case "redo":
          await page.keyboard.press(`${modifier}+Shift+Z`);
          break;
      }

      await assertCaret();
      await checkPageErrors();
      const siblingChanges = await snapshotEditorSiblings("assert", operation);
      if (
        siblingChanges.length &&
        !["undo", "redo", "shortcut-undo", "slash-undo"].includes(
          operation.kind,
        )
      ) {
        throw new Error(
          `sibling block inside the editor moved or restyled: ${siblingChanges.slice(0, 5).join(", ")}`,
        );
      }
      await assertOutsideUnchanged(outsideBefore);
    }

    const finalHtml = await editor.innerHTML();
    const finalSlideHtml = await slideContent.innerHTML();
    let currentHtml = finalHtml;
    activePhase = "undo-all";
    // Drain selection-only snapshots too, past the editor's configured cap.
    const stableHistoryProbeLimit = 3;
    const maxHistoryCalls = historyLimit + stableHistoryProbeLimit;
    let stableUndo = 0;
    let undoCalls = 0;
    let undoCount = 0;
    // History replay may replace blocks created by earlier Enter operations; byte-identical HTML below proves restoration.
    while (
      undoCalls < maxHistoryCalls &&
      stableUndo < stableHistoryProbeLimit
    ) {
      await page.keyboard.press(`${modifier}+Z`);
      undoCalls += 1;
      const nextHtml = await editor.innerHTML();
      if (nextHtml === currentHtml) stableUndo += 1;
      else {
        stableUndo = 0;
        undoCount += 1;
      }
      currentHtml = nextHtml;
      await assertCaret();
      await checkPageErrors();
      await assertOutsideUnchanged(outsideBefore);
    }
    assertByteIdenticalHtml(currentHtml, originalHtml, "undo-all editor HTML");
    assertByteIdenticalHtml(
      await withoutSessionAttributes(await slideContent.innerHTML()),
      originalSlideHtml,
      `undo-all slide HTML after ${undoCalls} undo keypress(es) and ${undoCount} HTML change(s)`,
    );

    let stableRedo = 0;
    let redoCalls = 0;
    let redoCount = 0;
    activePhase = "redo-all";
    const maxRedoCalls = historyLimit + stableHistoryProbeLimit;
    while (redoCalls < maxRedoCalls && stableRedo < stableHistoryProbeLimit) {
      await page.keyboard.press(`${modifier}+Shift+Z`);
      redoCalls += 1;
      const nextHtml = await editor.innerHTML();
      if (nextHtml === currentHtml) stableRedo += 1;
      else {
        stableRedo = 0;
        redoCount += 1;
      }
      currentHtml = nextHtml;
      await assertCaret();
      await checkPageErrors();
      await assertOutsideUnchanged(outsideBefore);
    }
    assertByteIdenticalHtml(currentHtml, finalHtml, "redo-all editor HTML");
    assertByteIdenticalHtml(
      await slideContent.innerHTML(),
      finalSlideHtml,
      `redo-all slide HTML after ${redoCalls} redo keypress(es) and ${redoCount} HTML change(s)`,
    );

    activePhase = "save/reload";
    const persistence = await options.finishAndReload();
    assertAuthoringPersistence(persistence);
    await checkPageErrors();
    if (conflictResourceErrors > patchDeckConflicts) {
      throw new Error(
        "a 409 resource error did not match a patch-deck conflict response",
      );
    }
    if (patchDeckConflicts > 0) {
      console.log(
        `[edit-fidelity] recovered ${patchDeckConflicts} patch-deck conflict response(s); saved and reloaded HTML matched the live slide`,
      );
    }
    return {
      seed,
      stepsRun: plan.length,
      stepLog: plan,
      undoSteps: undoCount,
      redoSteps: redoCount,
    };
  } catch (error) {
    const prefix = replay();
    throw formatAuthoringFuzzFailure(
      seed,
      activePhase,
      prefix,
      String(error),
      options.browser,
    );
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
  }
}
