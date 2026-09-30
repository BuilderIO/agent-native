type Page = any;
type Locator = any;

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
  if (persistence.liveHtml !== persistence.savedHtml) {
    throw new Error("saved HTML differed from the post-edit live slide");
  }
  if (persistence.savedHtml === persistence.originalHtml) {
    throw new Error("authoring flow did not change the persisted slide HTML");
  }
  if (persistence.reloadedHtml !== persistence.savedHtml) {
    throw new Error("reloaded slide HTML differed from the saved HTML");
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
  "vertical-navigation",
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
    { kind: "vertical-navigation" },
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
  return plan.slice(0, steps);
}

const MAX_FAILURE_LOG_OPERATIONS = 20;
const MAX_FAILURE_MESSAGE_LENGTH = 1000;

export function formatAuthoringFuzzFailure(
  seed: number,
  phase: string,
  log: AuthoringFuzzOperation[],
  message: string,
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
      `Replay: pnpm exec tsx scripts/edit-fidelity/run.ts --authoring-fuzz --seed ${seed} --steps ${replaySteps}\n` +
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
  const onConsole = (message: any) => {
    if (message.type() === "error") pageErrors.push(message.text());
  };
  const onPageError = (error: Error) => pageErrors.push(error.message);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  let activeIndex = -1;
  let activePhase = "setup";
  const replay = () => plan.slice(0, Math.max(1, activeIndex + 1));
  const checkPageErrors = () => {
    if (pageErrors.length)
      throw new Error(
        `browser emitted ${pageErrors.length} console/page error(s)`,
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
        return prefix.toString().replaceAll("\u200b", "").length;
      };
      return {
        inside:
          root.contains(selection.anchorNode) &&
          root.contains(selection.focusNode),
        collapsed: selection.isCollapsed,
        text: (root.textContent ?? "").replaceAll("\u200b", ""),
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
    await editor.pressSequentially(value, { delay: 0 });
    const after = await inspectSelection();
    if (!after.inside)
      throw new Error(
        `typed burst ${JSON.stringify(value)} outside the editor`,
      );
    if (verifyPlacement) {
      const expected =
        before.text.slice(0, before.start) +
        value +
        before.text.slice(before.end);
      if (
        after.text !== expected ||
        after.start !== before.start + value.length
      ) {
        throw new Error(
          `typed burst ${JSON.stringify(value)} missed the caret (expected offset ${before.start + value.length}, got ${after.start}; text lengths ${expected.length} and ${after.text.length})`,
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
  const snapshotOutside = async () =>
    page.evaluate(
      ({ slide, edited }: { slide: string; edited: string }) => {
        const root = document.querySelector(slide);
        const editing = document.querySelector(edited);
        if (
          !(root instanceof HTMLElement) ||
          !(editing instanceof HTMLElement) ||
          !root.contains(editing)
        ) {
          throw new Error(
            "slide/editor selectors must resolve inside the same slide",
          );
        }
        const chrome = [
          "[data-slide-selection-chrome]",
          "[data-slide-selection-outline]",
          "[data-slide-resize-handle]",
          "[data-slide-move-handle]",
          "[data-slide-rotate-handle]",
          "[data-block-bubble-menu]",
        ].join(",");
        const elements = [
          root,
          ...Array.from(root.querySelectorAll("*")),
        ].filter(
          (element) =>
            !editing.contains(element) &&
            element !== editing &&
            !element.closest(chrome),
        );
        return elements.map((element) => {
          const path: number[] = [];
          let current = element;
          while (current !== root) {
            const parent = current.parentElement;
            if (!parent) break;
            path.unshift(Array.from(parent.children).indexOf(current));
            current = parent;
          }
          const style = getComputedStyle(element);
          const computed = Array.from(style)
            .sort()
            .map(
              (property) => `${property}:${style.getPropertyValue(property)}`,
            )
            .join(";");
          const rect = element.getBoundingClientRect();
          return `${path.join(".")}:${element.tagName}:${computed}:${rect.x},${rect.y},${rect.width},${rect.height}`;
        });
      },
      { slide: slideSelector, edited: editorSelector },
    );
  const snapshotEditorSiblings = async (phase: "capture" | "assert") =>
    page.evaluate(
      ({
        selector,
        phase,
      }: {
        selector: string;
        phase: "capture" | "assert";
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
              ancestor: boolean;
              signature: string;
            }>;
          };
        };
        const block =
          /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|LI|OL|P|PRE|SECTION|TABLE|TBODY|TD|TFOOT|TH|THEAD|TR|UL)$/;
        const range = selection.getRangeAt(0);
        const targets = selection.isCollapsed
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
        if (!targets.length) targets.push(root);
        const isTarget = (node: Node) =>
          targets.some((target) => target === node || target.contains(node));
        const ancestors = new Set<Element>();
        const siblingText = new Set<Text>();
        for (const target of targets) {
          let current: Node = target;
          while (current !== root && current.parentNode) {
            const parent: Node = current.parentNode;
            if (parent instanceof Element && parent !== root) {
              ancestors.add(parent);
            }
            for (const sibling of Array.from(parent.childNodes)) {
              if (sibling !== current && sibling instanceof Text) {
                siblingText.add(sibling);
              }
            }
            if (parent === root) break;
            current = parent;
          }
        }
        const css = (element: Element) => {
          const style = getComputedStyle(element);
          return Array.from(style)
            .sort()
            .map(
              (property) => `${property}:${style.getPropertyValue(property)}`,
            )
            .join(";");
        };
        const box = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return `${rect.x},${rect.y},${rect.width},${rect.height}`;
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
        for (const element of root.querySelectorAll<HTMLElement>("*")) {
          if (
            isTarget(element) ||
            element.closest(chrome) ||
            !element.parentNode
          ) {
            continue;
          }
          records.push({
            node: element,
            parent: element.parentNode,
            index: Array.from(element.parentNode.childNodes).indexOf(element),
            ancestor: ancestors.has(element),
            signature: ancestors.has(element)
              ? `${css(element)}:${element.getAttribute("class") ?? ""}:${element.getAttribute("style") ?? ""}`
              : `${css(element)}:${box(element)}:${element.outerHTML}`,
          });
        }
        for (const text of siblingText) {
          const parent = text.parentElement;
          if (!parent || isTarget(text) || !root.contains(text)) continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          const rects = Array.from(range.getClientRects())
            .map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`)
            .join(";");
          records.push({
            node: text,
            parent,
            index: Array.from(parent.childNodes).indexOf(text),
            ancestor: false,
            signature: `${text.data}:${css(parent)}:${rects}`,
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
        const failures: string[] = [];
        for (const record of baseline.records) {
          if (isTarget(record.node)) continue;
          if (!root.contains(record.node)) {
            failures.push(`removed ${record.node.nodeName}`);
            continue;
          }
          const parent = record.parent === baseline.root ? root : record.parent;
          if (
            record.node.parentNode !== parent ||
            Array.from(parent.childNodes).indexOf(record.node) !== record.index
          ) {
            failures.push(`moved ${record.node.nodeName}`);
            continue;
          }
          const signature =
            record.node instanceof Text
              ? `${record.node.data}:${css(parent as Element)}:${(() => {
                  const range = document.createRange();
                  range.selectNodeContents(record.node);
                  return Array.from(range.getClientRects())
                    .map(
                      (rect) =>
                        `${rect.x},${rect.y},${rect.width},${rect.height}`,
                    )
                    .join(";");
                })()}`
              : record.ancestor
                ? `${css(record.node)}:${record.node.getAttribute("class") ?? ""}:${record.node.getAttribute("style") ?? ""}`
                : `${css(record.node)}:${box(record.node)}:${record.node.outerHTML}`;
          if (signature !== record.signature) {
            failures.push(`changed ${record.node.nodeName}`);
          }
        }
        return failures;
      },
      { selector: editorSelector, phase },
    );
  const assertOutsideUnchanged = async (baseline: string) => {
    if (JSON.stringify(await snapshotOutside()) !== baseline) {
      throw new Error(
        "computed style or geometry changed outside the edited element",
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
        case "bullet":
          return count('ul > li, [style*="display: flex"] > span');
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
  const assertShortcut = async (result: string, before: number) => {
    if ((await shortcutResultCount(result)) <= before)
      throw new Error(`markdown shortcut did not produce ${result}`);
  };
  const newLine = async () => {
    await editor.press("End");
    await editor.press("Enter");
    await editor.press("Home");
  };
  const newPlainLine = async () => {
    await editor.press("End");
    await editor.press("Enter");
    await editor.press("Enter");
    await editor.press("Home");
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
    const withinViewport = await page
      .locator('[role="listbox"]')
      .evaluate((menu: HTMLElement) => {
        const rect = menu.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= window.innerWidth &&
          rect.bottom <= window.innerHeight
        );
      });
    if (!withinViewport)
      throw new Error("slash menu is clipped beyond the viewport");
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
  const selectTextRange = async (start: number, end: number) =>
    editor.evaluate(
      (root: HTMLElement, range: { start: number; end: number }) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          textNodes.push(node as Text);
        }
        const locate = (offset: number): [Text, number] | null => {
          let remaining = offset;
          for (const text of textNodes) {
            for (let index = 0; index < text.length; index += 1) {
              if (text.data[index] === "\u200b") continue;
              if (remaining === 0) return [text, index];
              remaining -= 1;
            }
            if (remaining === 0) return [text, text.length];
          }
          const last = textNodes.at(-1);
          return last ? [last, last.length] : null;
        };
        const from = locate(range.start);
        const to = locate(range.end);
        if (!from || !to) throw new Error("range target contains no text");
        const selection = window.getSelection();
        if (!selection) throw new Error("browser selection is unavailable");
        const selected = document.createRange();
        selected.setStart(...from);
        selected.setEnd(...to);
        selection.removeAllRanges();
        selection.addRange(selected);
      },
      { start, end },
    );
  const textOffset = async (token: string, edge: "start" | "end") => {
    const text = (await inspectSelection()).text;
    const start = text.lastIndexOf(token);
    if (start < 0) throw new Error(`could not locate fuzz token ${token}`);
    return edge === "start" ? start : start + token.length;
  };
  const placeCaretAtToken = async (token: string, edge: "start" | "end") => {
    const offset = await textOffset(token, edge);
    await selectTextRange(offset, offset);
  };
  const listRowCount = async (kind: "styled" | "ul" | "ol") =>
    editor.evaluate((root: HTMLElement, type: string) => {
      if (type === "styled")
        return root.querySelectorAll('[style*="display: flex"]').length;
      return root.querySelectorAll(`${type} > li`).length;
    }, kind);
  const createList = async (kind: "styled" | "ul" | "ol") => {
    const before = await listRowCount(kind);
    const suffix = activeIndex.toString(36);
    const firstToken = `firstFuzz${suffix}`;
    const secondToken = `secondFuzz${suffix}`;
    await newPlainLine();
    if (kind === "styled") {
      await typeText("- ", false);
      await typeText(firstToken);
    } else {
      await runSlashCommand(kind === "ul" ? "bulletList" : "orderedList");
      await typeText(firstToken);
    }
    await editor.press("End");
    await editor.press("Enter");
    await typeText(secondToken);
    const after = await listRowCount(kind);
    if (after <= before)
      throw new Error(`${kind} list operation added no list row`);
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
        root.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: clipboard,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { html, text },
    );
  const copySelection = async () =>
    editor.evaluate((root: HTMLElement) => {
      const clipboard = new DataTransfer();
      const event = new ClipboardEvent("copy", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      });
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
  const makeCrossBlockSelection = async (token: string) => {
    await newLine();
    await typeText(`A${token}`);
    await editor.press("End");
    await editor.press("Enter");
    await typeText(`B${token}`);
    await editor.evaluate((root: HTMLElement, suffix: string) => {
      const findText = (value: string) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text;
          const at = text.data.indexOf(value);
          if (at >= 0) return [text, at] as const;
        }
        return null;
      };
      const first = findText(`A${suffix}`);
      const last = findText(`B${suffix}`);
      if (!first || !last)
        throw new Error("could not locate cross-block fuzz tokens");
      let firstBlock = first[0].parentElement;
      let lastBlock = last[0].parentElement;
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
      range.setStart(first[0], first[1]);
      range.setEnd(last[0], Math.min(last[0].length, last[1] + 1));
      const selection = window.getSelection();
      if (!selection) throw new Error("browser selection is unavailable");
      selection.removeAllRanges();
      selection.addRange(range);
    }, token);
  };
  const dispatchReplacement = async () => {
    const before = await inspectSelection();
    if (!before.inside || !before.collapsed)
      throw new Error("replacement needs a caret in the editor");
    await typeText("teh");
    const state = await inspectSelection();
    if (!state.inside) throw new Error("autocorrect sample left the editor");
    const start = state.start - 3;
    if (start < 0)
      throw new Error("autocorrect sample did not land at the caret");
    await selectTextRange(start, state.end);
    const selected = await inspectSelection();
    const expected =
      selected.text.slice(0, selected.start) +
      "the" +
      selected.text.slice(selected.end);
    await editor.evaluate(
      (root: HTMLElement, offsets: { start: number; end: number }) => {
        const pointAt = (offset: number): [Text, number] => {
          let remaining = offset;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node as Text;
            let visible = 0;
            for (let raw = 0; raw <= text.data.length; raw += 1) {
              if (visible === remaining) return [text, raw];
              if (text.data[raw] !== "\u200b") visible += 1;
            }
            remaining -= visible;
          }
          throw new Error("autocorrect target offset left the editor");
        };
        const target = document.createRange();
        target.setStart(...pointAt(offsets.start));
        target.setEnd(...pointAt(offsets.end));
        if (target.toString().replaceAll("\u200b", "") !== "teh") {
          throw new Error(
            "autocorrect target range did not select the typed token",
          );
        }
        const selection = window.getSelection();
        if (!selection) throw new Error("browser selection is unavailable");
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
      },
      { start, end: state.start },
    );
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
    const outsideBefore = JSON.stringify(await snapshotOutside());

    for (activeIndex = 0; activeIndex < plan.length; activeIndex += 1) {
      activePhase = `step ${activeIndex}`;
      const operation = plan[activeIndex];
      await snapshotEditorSiblings("capture");
      switch (operation.kind) {
        case "type":
          await typeText(operation.value);
          break;
        case "shortcut":
          await newLine();
          {
            const before = await shortcutResultCount(operation.result);
            await typeText(operation.value, true, true);
            await assertShortcut(operation.result, before);
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
          await runSlashCommand(
            operation.kind === "heading-backspace" ? "heading2" : "quote",
          );
          const token = `edge${activeIndex}`;
          await typeText(token);
          await placeCaretAtToken(token, "start");
          await editor.press("Backspace");
          const demoted = await editor.evaluate(
            (root: HTMLElement, value: string) => {
              const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT,
              );
              for (
                let node = walker.nextNode();
                node;
                node = walker.nextNode()
              ) {
                if (!(node as Text).data.includes(value)) continue;
                return (
                  (node as Text).parentElement?.closest(
                    "h1,h2,h3,h4,h5,h6,blockquote",
                  ) === null
                );
              }
              return false;
            },
            token,
          );
          if (!demoted)
            throw new Error(`${operation.kind} did not demote the block`);
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
          await editor.press("End");
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
          await editor.press("Enter");
          await editor.press("Enter");
          const after = `after${activeIndex}`;
          await typeText(after);
          const exited = await editor.evaluate(
            (root: HTMLElement, values: { token: string; after: string }) =>
              Array.from(root.querySelectorAll("blockquote")).some(
                (quote) =>
                  quote.textContent?.includes(values.token) &&
                  quote.nextElementSibling?.tagName === "P" &&
                  quote.nextElementSibling.textContent?.includes(values.after),
              ),
            { token, after },
          );
          if (!exited) throw new Error("Enter did not exit the quote");
          break;
        }
        case "empty-list-exit": {
          await runSlashCommand("bulletList");
          await typeText(`list${activeIndex}`);
          await editor.press("End");
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
          await editor.press("Shift+Enter");
          await typeText(`line${activeIndex}`);
          const softBreak = await editor.evaluate((root: HTMLElement) => {
            const br = root.querySelector("br");
            return !!br && br.parentElement?.textContent?.includes("soft");
          });
          if (!softBreak)
            throw new Error("Shift+Enter did not insert a soft break");
          break;
        }
        case "list":
          await createList(operation.value);
          break;
        case "enter-block-edge":
          await editor.press("Home");
          await editor.press("Enter");
          break;
        case "backspace-block-edge":
          await editor.press("Home");
          await editor.press("Backspace");
          break;
        case "delete-block-edge":
          await editor.press("Home");
          await editor.press("Delete");
          break;
        case "enter-list-edge":
          await createList("ul");
          {
            const before = await listRowCount("ul");
            await editor.press("End");
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
            await paste(null, token);
            if (!(await inspectSelection()).text.includes(token))
              throw new Error("plain paste did not insert at the selection");
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
            nested: root.querySelector("ul > li ul > li")?.textContent,
            quote: Array.from(root.querySelectorAll("blockquote")).some(
              (node) => node.textContent === "Fuzz quote",
            ),
          }));
          if (
            !blocks.heading ||
            blocks.nested !== "Fuzz nested" ||
            !blocks.quote
          ) {
            throw new Error(
              "plain Markdown paste did not create its block structure",
            );
          }
          break;
        }
        case "paste-url": {
          await newLine();
          const token = `url${activeIndex}`;
          await typeText(token);
          const start = await textOffset(token, "start");
          await selectTextRange(start, start + token.length);
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
          await newLine();
          const token = `link${activeIndex}`;
          await typeText(token);
          const start = await textOffset(token, "start");
          await selectTextRange(start, start + token.length);
          await page.keyboard.press(`${modifier}+K`);
          const input = page.locator("input[placeholder]").last();
          await input.waitFor({ state: "visible", timeout: 1500 });
          await input.fill("https://example.com/keyboard");
          await input.press("Enter");
          const linked = await editor.evaluate(
            (root: HTMLElement, value: string) =>
              Array.from(root.querySelectorAll<HTMLAnchorElement>("a")).some(
                (anchor) =>
                  anchor.textContent === value &&
                  anchor.href === "https://example.com/keyboard",
              ),
            token,
          );
          if (!linked) throw new Error("Mod+K did not link the selection");
          break;
        }
        case "vertical-navigation": {
          await newLine();
          await typeText("x".repeat(40));
          await editor.press("Enter");
          await typeText("vertical target");
          await editor.press("End");
          const beforeX = await editor.evaluate(
            () =>
              window.getSelection()?.getRangeAt(0).getBoundingClientRect().x ??
              null,
          );
          await editor.press("ArrowUp");
          const afterX = await editor.evaluate(
            () =>
              window.getSelection()?.getRangeAt(0).getBoundingClientRect().x ??
              null,
          );
          if (
            beforeX === null ||
            afterX === null ||
            Math.abs(beforeX - afterX) > 4
          ) {
            throw new Error(
              `vertical caret drifted horizontally (${beforeX} to ${afterX})`,
            );
          }
          await editor.press("ArrowDown");
          const downX = await editor.evaluate(
            () =>
              window.getSelection()?.getRangeAt(0).getBoundingClientRect().x ??
              null,
          );
          if (downX === null || Math.abs(beforeX - downX) > 4) {
            throw new Error(
              `vertical caret drifted horizontally on ArrowDown (${beforeX} to ${downX})`,
            );
          }
          break;
        }
        case "select-cross-block-type": {
          const token = `cross${activeIndex}`;
          await makeCrossBlockSelection(token);
          await typeText("R");
          break;
        }
        case "select-cross-block-delete": {
          const token = `delete${activeIndex}`;
          await makeCrossBlockSelection(token);
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
        case "code-shortcut":
          await page.keyboard.press(`${modifier}+E`);
          await typeText("c");
          break;
        case "copy-inline": {
          await newLine();
          const token = `copymark${activeIndex}`;
          await typeText(token);
          const start = await textOffset(token, "start");
          await selectTextRange(start, start + token.length);
          await page.keyboard.press(`${modifier}+B`);
          const copied = await copySelection();
          if (!/<(?:strong|b)\b/i.test(copied.html)) {
            throw new Error("copy did not preserve the selected bold mark");
          }
          await newPlainLine();
          await paste(copied.html, copied.text);
          const preserved = await editor.evaluate(
            (root: HTMLElement, value: string) =>
              Array.from(root.querySelectorAll("strong,b")).some(
                (mark) => mark.textContent === value,
              ),
            token,
          );
          if (!preserved) {
            throw new Error("pasting copied rich text lost its bold mark");
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
      checkPageErrors();
      const siblingChanges = await snapshotEditorSiblings("assert");
      if (siblingChanges.length) {
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
    const stableHistoryProbeLimit = historyLimit + 1;
    const maxHistoryCalls = Math.max(historyLimit * 2 + 20, steps * 2 + 20);
    let stableUndo = 0;
    let undoCalls = 0;
    let undoCount = 0;
    while (
      undoCalls < maxHistoryCalls &&
      stableUndo < stableHistoryProbeLimit
    ) {
      await snapshotEditorSiblings("capture");
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
      checkPageErrors();
      const siblingChanges = await snapshotEditorSiblings("assert");
      if (siblingChanges.length) {
        throw new Error(
          `undo changed a sibling block inside the editor: ${siblingChanges.slice(0, 5).join(", ")}`,
        );
      }
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
    const maxRedoCalls = Math.max(
      maxHistoryCalls,
      undoCalls + historyLimit + 10,
    );
    while (redoCalls < maxRedoCalls && stableRedo < stableHistoryProbeLimit) {
      await snapshotEditorSiblings("capture");
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
      checkPageErrors();
      const siblingChanges = await snapshotEditorSiblings("assert");
      if (siblingChanges.length) {
        throw new Error(
          `redo changed a sibling block inside the editor: ${siblingChanges.slice(0, 5).join(", ")}`,
        );
      }
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
    checkPageErrors();
    return {
      seed,
      stepsRun: plan.length,
      stepLog: plan,
      undoSteps: undoCount,
      redoSteps: redoCount,
    };
  } catch (error) {
    const prefix = replay();
    throw formatAuthoringFuzzFailure(seed, activePhase, prefix, String(error));
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}
