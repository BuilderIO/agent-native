import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  createMotionNativeStyleInstance,
  motionNativeStylesToTextAnimations,
} from "./motion-native-style-runtime";
import {
  MOTION_TEXT_RUNTIME_ATTRIBUTE,
  MOTION_TEXT_SOURCE_ATTRIBUTE,
  MOTION_TEXT_SOURCE_VERSION_PROVENANCE,
  compileMotionTextRuntime,
  decodeMotionTextDocument,
  encodeMotionTextDocument,
  injectMotionTextRuntime,
  readMotionTextDocument,
  removeMotionTextRuntime,
} from "./motion-text-code";
import type {
  MotionTextAnimation,
  MotionTextDocument,
} from "./motion-text-code";

const document: MotionTextDocument = {
  version: 2,
  animations: [
    {
      targetNodeId: "headline",
      unit: "word",
      direction: "reverse",
      staggerMs: 40,
      animationDirection: "in",
      order: "right-to-left",
      ignoreSpaces: false,
      delayMs: 0,
      property: "opacity",
      durationMs: 320,
      keyframes: [
        { t: 0, value: "0", ease: "ease-out" },
        { t: 1, value: "1", ease: "ease-in" },
      ],
    },
  ],
};

class FakeTextNode {
  readonly nodeName = "#text";
  parentNode: FakeElement | FakeDocumentFragment | null = null;

  constructor(readonly value: string) {}

  get textContent(): string {
    return this.value;
  }
}

type FakeNode = FakeElement | FakeTextNode;

class FakeDocumentFragment {
  readonly nodeName = "#document-fragment";
  readonly childNodes: FakeNode[] = [];

  appendChild(node: FakeNode): void {
    node.parentNode = this;
    this.childNodes.push(node);
  }
}

class FakeWebAnimation {
  currentTime: number | null = 0;
  paused = false;
  readonly finished: Promise<void>;
  private resolveFinished: () => void = () => {};
  private rejectFinished: (reason: unknown) => void = () => {};

  constructor() {
    this.finished = new Promise((resolve, reject) => {
      this.resolveFinished = resolve;
      this.rejectFinished = reject;
    });
    // Nothing awaits a fake that is never finished or cancelled, so its pending promise must not raise.
    this.finished.catch(() => {});
  }

  pause(): void {
    this.paused = true;
  }

  finish(): void {
    this.resolveFinished();
  }

  // Like a browser, cancelling rejects the finished promise.
  cancel(): void {
    this.rejectFinished(
      new DOMException("The animation was cancelled.", "AbortError"),
    );
  }
}

class FakeElement {
  readonly nodeName = "element";
  readonly style: Record<string, string> = {};
  parentNode: FakeElement | FakeDocumentFragment | null = null;
  readonly animations: Array<{
    keyframes: unknown;
    options: unknown;
    handle: FakeWebAnimation;
  }> = [];
  readonly attributes = new Map<string, string>();
  childNodes: FakeNode[] = [];
  top = 0;

  constructor(readonly tagName: string) {}

  get children(): FakeElement[] {
    return this.childNodes.filter(
      (node): node is FakeElement => node instanceof FakeElement,
    );
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value: string) {
    this.replaceChildren(new FakeTextNode(value));
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(node: FakeNode | FakeDocumentFragment): void {
    if (node instanceof FakeDocumentFragment) {
      for (const child of node.childNodes.splice(0)) {
        child.parentNode = this;
        this.childNodes.push(child);
      }
      return;
    }
    node.parentNode = this;
    this.childNodes.push(node);
  }

  replaceChild(
    newNode: FakeNode | FakeDocumentFragment,
    oldNode: FakeNode,
  ): FakeNode {
    const index = this.childNodes.indexOf(oldNode);
    if (index < 0) throw new Error("Node is not a child.");
    oldNode.parentNode = null;
    const replacements =
      newNode instanceof FakeDocumentFragment
        ? newNode.childNodes.splice(0)
        : [newNode];
    for (const replacement of replacements) replacement.parentNode = this;
    this.childNodes.splice(index, 1, ...replacements);
    return oldNode;
  }

  replaceChildren(...nodes: FakeNode[]): void {
    for (const child of this.childNodes) child.parentNode = null;
    for (const node of nodes) node.parentNode = this;
    this.childNodes = nodes;
  }

  contains(node: FakeNode): boolean {
    return this.childNodes.some(
      (child) =>
        child === node ||
        (child instanceof FakeElement && child.contains(node)),
    );
  }

  getBoundingClientRect(): { top: number } {
    return { top: this.top };
  }

  animate(keyframes: unknown, options: unknown): FakeWebAnimation {
    const handle = new FakeWebAnimation();
    this.animations.push({ keyframes, options, handle });
    return handle;
  }
}

const mutationCallbacks: Array<() => void> = [];

class FakeMutationObserver {
  constructor(
    private readonly callback: (
      records: unknown[],
      observer: FakeMutationObserver,
    ) => void,
  ) {}

  observe(): void {
    mutationCallbacks.push(() => this.callback([], this));
  }

  disconnect(): void {}
}

function sourceForRuntime(markup: string): string {
  const openEnd = markup.indexOf(">");
  const closeStart = markup.lastIndexOf("</script>");
  if (openEnd < 0 || closeStart < 0) throw new Error("Missing script markup.");
  return markup.slice(openEnd + 1, closeStart);
}

function executeRuntime(
  compiled: ReturnType<typeof compileMotionTextRuntime>,
  target: FakeElement,
  withPreviewBridge = false,
  topForUnit?: (unitIndex: number) => number,
  cssVariables: Record<string, string> = {},
): { sendMessage: (data: unknown) => void; sentMessages: unknown[] } {
  const runtimeTargets = [target];
  const sentMessages: unknown[] = [];
  const parent = {
    postMessage: (data: unknown) => sentMessages.push(data),
  };
  let messageListener:
    | ((event: { source: unknown; data: unknown }) => void)
    | undefined;
  const fakeWindow = {
    __designMotionPreviewBridge: withPreviewBridge,
    parent,
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({
      getPropertyValue: (name: string) => cssVariables[name] ?? "",
    }),
    addEventListener: (type: string, listener: typeof messageListener) => {
      if (type === "message") messageListener = listener;
    },
  };
  let createdUnits = 0;
  const fakeDocument = {
    querySelectorAll: () => runtimeTargets,
    createElement: (tagName: string) => {
      const element = new FakeElement(tagName);
      if (tagName === "span") {
        element.top = topForUnit?.(createdUnits) ?? 0;
        createdUnits += 1;
      }
      return element;
    },
    createTextNode: (value: string) => new FakeTextNode(value),
    createDocumentFragment: () => new FakeDocumentFragment(),
  };
  runInNewContext(sourceForRuntime(compiled.runtimeMarkup), {
    document: fakeDocument,
    Intl,
    MutationObserver: FakeMutationObserver,
    window: fakeWindow,
  });
  return {
    sendMessage: (data) => messageListener?.({ source: parent, data }),
    sentMessages,
  };
}

function textTarget(text: string): FakeElement {
  const target = new FakeElement("h1");
  target.setAttribute("data-agent-native-node-id", "headline");
  target.appendChild(new FakeTextNode(text));
  return target;
}

describe("Motion Text source and runtime", () => {
  it("round-trips a versioned authoring document with text timing controls", () => {
    const encoded = encodeMotionTextDocument(document);

    expect(decodeMotionTextDocument(encoded)).toEqual({
      status: "valid",
      document,
    });
    expect(decodeMotionTextDocument("{")).toMatchObject({
      status: "invalid",
      error: { code: "malformed-json" },
    });
    expect(
      decodeMotionTextDocument('{"version":99,"animations":[]}'),
    ).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-version" },
    });
  });

  it("reads version 1 source with its original spacing and timing behavior", () => {
    const legacy = {
      version: 1,
      animations: [
        {
          targetNodeId: "headline",
          unit: "character",
          direction: "reverse",
          staggerMs: 30,
          delayMs: 12,
          property: "opacity",
          durationMs: 300,
          keyframes: [
            { t: 0, value: "0", ease: "ease-out" },
            { t: 1, value: "1" },
          ],
        },
      ],
    };
    const expected = {
      version: 2,
      animations: [
        {
          ...legacy.animations[0],
          animationDirection: "in",
          order: "right-to-left",
          ignoreSpaces: true,
        },
      ],
    };

    const decoded = decodeMotionTextDocument(JSON.stringify(legacy));
    expect(decoded).toEqual({
      status: "valid",
      document: expected,
    });
    if (decoded.status === "valid") {
      expect(decoded.document[MOTION_TEXT_SOURCE_VERSION_PROVENANCE]).toBe(1);
      expect(Object.keys(decoded.document)).toEqual(["version", "animations"]);
      expect(JSON.parse(encodeMotionTextDocument(decoded.document))).toEqual(
        expected,
      );
    }
    expect(
      readMotionTextDocument(
        `<h1 data-agent-native-node-id="headline">Hello world</h1><script type="application/json" ${MOTION_TEXT_SOURCE_ATTRIBUTE}="v1">${JSON.stringify(legacy)}</script>`,
      ),
    ).toEqual({ status: "valid", document: expected });
  });

  it("defaults omitted v2 ignoreSpaces to the editor and runtime default", () => {
    const { ignoreSpaces: _ignoreSpaces, ...animation } =
      document.animations[0]!;
    const decoded = decodeMotionTextDocument(
      JSON.stringify({ version: 2, animations: [animation] }),
    );

    expect(decoded).toMatchObject({
      status: "valid",
      document: { version: 2, animations: [{ ignoreSpaces: true }] },
    });
    if (decoded.status === "valid") {
      expect(encodeMotionTextDocument(decoded.document)).toContain(
        '"ignoreSpaces":true',
      );
    }
  });

  it("validates and preserves per-unit overlap and text ordering", () => {
    const withControls: MotionTextDocument = {
      ...document,
      animations: [
        {
          ...document.animations[0]!,
          direction: "forward",
          animationDirection: "out",
          order: "center-out",
          overlapPercent: 25,
          ignoreSpaces: true,
        },
      ],
    };

    expect(
      decodeMotionTextDocument(encodeMotionTextDocument(withControls)),
    ).toEqual({ status: "valid", document: withControls });
    expect(() =>
      encodeMotionTextDocument({
        ...withControls,
        animations: [{ ...withControls.animations[0]!, overlapPercent: 101 }],
      }),
    ).toThrow("overlapPercent must be between 0 and 100");
  });

  it("accepts compatible property tracks for one text target", () => {
    const composite: MotionTextDocument = {
      ...document,
      animations: [
        document.animations[0]!,
        {
          ...document.animations[0]!,
          property: "translate",
          delayMs: 25,
          durationMs: 160,
          keyframes: [
            { t: 0, value: "0px", ease: "ease-out" },
            { t: 1, value: "12px" },
          ],
        },
      ],
    };

    expect(
      decodeMotionTextDocument(encodeMotionTextDocument(composite)),
    ).toEqual({ status: "valid", document: composite });
    expect(
      decodeMotionTextDocument(
        JSON.stringify({
          ...composite,
          animations: [
            composite.animations[0],
            { ...composite.animations[1], property: "opacity" },
          ],
        }),
      ),
    ).toMatchObject({ status: "invalid", error: { code: "invalid-document" } });
    expect(
      decodeMotionTextDocument(
        JSON.stringify({
          ...composite,
          animations: [
            composite.animations[0],
            { ...composite.animations[1], unit: "character" },
          ],
        }),
      ),
    ).toMatchObject({ status: "invalid", error: { code: "invalid-document" } });
  });

  it.each(["word", "line", "paragraph"] as const)(
    "preserves per-track ignoreSpaces values for %s grouping",
    (unit) => {
      const first = {
        ...document.animations[0]!,
        unit,
        ignoreSpaces: false,
      };
      const second = {
        ...first,
        ignoreSpaces: true,
        property: "translate" as const,
        keyframes: [
          { t: 0, value: "0px", ease: "ease-out" },
          { t: 1, value: "12px" },
        ],
      };
      const composite: MotionTextDocument = {
        version: 2,
        animations: [first, second],
      };

      expect(
        decodeMotionTextDocument(encodeMotionTextDocument(composite)),
      ).toEqual({ status: "valid", document: composite });
    },
  );

  it("keeps character ignoreSpaces mismatches invalid", () => {
    const first = {
      ...document.animations[0]!,
      unit: "character" as const,
      ignoreSpaces: false,
    };
    const second = {
      ...first,
      ignoreSpaces: true,
      property: "translate" as const,
      keyframes: [
        { t: 0, value: "0px", ease: "ease-out" },
        { t: 1, value: "12px" },
      ],
    };

    expect(() =>
      encodeMotionTextDocument({ version: 2, animations: [first, second] }),
    ).toThrow("must use the same unit, direction, and timing settings");
    expect(
      decodeMotionTextDocument(
        JSON.stringify({ version: 2, animations: [first, second] }),
      ),
    ).toMatchObject({ status: "invalid", error: { code: "invalid-document" } });
  });

  it("allows duration-derived stagger values when overlap controls timing", () => {
    const firstTrack: MotionTextAnimation = {
      ...document.animations[0]!,
      unit: "character",
      direction: "forward",
      order: "left-to-right",
      overlapPercent: 0,
      staggerMs: 6000,
      durationMs: 6000,
    };
    const secondTrack: MotionTextAnimation = {
      ...firstTrack,
      property: "translate",
      staggerMs: 3000,
      durationMs: 3000,
      keyframes: [
        { t: 0, value: "0px" },
        { t: 1, value: "12px" },
      ],
    };

    expect(
      decodeMotionTextDocument(
        JSON.stringify({
          version: 2,
          animations: [firstTrack, secondTrack],
        }),
      ),
    ).toMatchObject({ status: "valid" });
    expect(
      decodeMotionTextDocument(
        JSON.stringify({
          version: 2,
          animations: [
            { ...firstTrack, overlapPercent: undefined, staggerMs: 40 },
            { ...secondTrack, overlapPercent: undefined, staggerMs: 80 },
          ],
        }),
      ),
    ).toMatchObject({ status: "invalid", error: { code: "invalid-document" } });
    expect(
      decodeMotionTextDocument(
        JSON.stringify({
          version: 2,
          animations: [{ ...firstTrack, staggerMs: 120_001 }],
        }),
      ),
    ).toMatchObject({ status: "invalid", error: { code: "invalid-document" } });
  });

  it("accepts a fixed stagger derived from a long native TextStagger duration", () => {
    const fixedStagger = {
      ...document.animations[0]!,
      staggerMs: 9600,
      durationMs: 12_000,
    };

    expect(
      decodeMotionTextDocument(
        JSON.stringify({ version: 2, animations: [fixedStagger] }),
      ),
    ).toMatchObject({ status: "valid" });
    expect(
      decodeMotionTextDocument(
        JSON.stringify({
          version: 2,
          animations: [{ ...fixedStagger, staggerMs: 120_001 }],
        }),
      ),
    ).toMatchObject({ status: "invalid", error: { code: "invalid-document" } });
  });

  it.each([
    "cubic-bezier(0, 0.9971093535, 1, 1)",
    "spring(0.674)",
    "linear(0, 0.2 50%, 1)",
  ])("preserves supported Text easing %s in its source document", (ease) => {
    const withEase: MotionTextDocument = {
      ...document,
      animations: [
        {
          ...document.animations[0]!,
          keyframes: document.animations[0]!.keyframes.map((keyframe) => ({
            ...keyframe,
            ease,
          })),
        },
      ],
    };

    expect(
      decodeMotionTextDocument(encodeMotionTextDocument(withEase)),
    ).toEqual({ status: "valid", document: withEase });
  });

  it.each([
    "ease-discrete",
    "spring(1.01)",
    "cubic-bezier(1.1, 0, 0, 1)",
    "linear(0, unsupported)",
  ])("rejects unsupported Text easing %s before encoding", (ease) => {
    const invalid: MotionTextDocument = {
      ...document,
      animations: [
        {
          ...document.animations[0]!,
          keyframes: document.animations[0]!.keyframes.map((keyframe) => ({
            ...keyframe,
            ease,
          })),
        },
      ],
    };

    expect(() => encodeMotionTextDocument(invalid)).toThrow(
      "ease must be a supported Motion easing",
    );
    expect(decodeMotionTextDocument(JSON.stringify(invalid))).toMatchObject({
      status: "invalid",
      error: { code: "invalid-document" },
    });
  });

  it("injects deterministic managed source/runtime and preserves authored HTML", () => {
    const authored =
      '<!doctype html><html><head><title>Demo</title></head><body><h1 data-agent-native-node-id="headline">Hello world</h1></body></html>';
    const injected = injectMotionTextRuntime(authored, document);
    const markersRemoved = injected
      .replace(
        /<script type="application\/json" data-agent-native-motion-text-source="v2">[\s\S]*?<\/script>\n/g,
        "",
      )
      .replace(
        /<script data-agent-native-motion-text-runtime="v2">[\s\S]*?<\/script>/g,
        "",
      );

    expect(markersRemoved).toBe(authored);
    expect(readMotionTextDocument(injected)).toEqual({
      status: "valid",
      document,
    });
    expect(injectMotionTextRuntime(authored, document)).toBe(injected);

    const updated = injectMotionTextRuntime(
      authored.replace("Hello world", "Hello again"),
      {
        ...document,
        animations: [{ ...document.animations[0]!, staggerMs: 80 }],
      },
    );
    expect(
      updated.match(new RegExp(MOTION_TEXT_SOURCE_ATTRIBUTE, "g")),
    ).toHaveLength(1);
    expect(
      updated.match(new RegExp(MOTION_TEXT_RUNTIME_ATTRIBUTE, "g")),
    ).toHaveLength(1);
  });

  it("removes only managed text scripts and keeps ordinary motion CSS intact", () => {
    const authored =
      '<!doctype html><html><head><style data-agent-native-motion>/* ordinary CSS */</style></head><body><h1 data-agent-native-node-id="headline">Hello</h1></body></html>';
    const injected = injectMotionTextRuntime(authored, document);
    const cleared = removeMotionTextRuntime(injected);

    expect(cleared).toBe(authored);
    expect(cleared).toContain("/* ordinary CSS */");
    expect(readMotionTextDocument(cleared)).toEqual({ status: "absent" });
    expect(removeMotionTextRuntime(authored)).toBe(authored);
  });

  it("runs the generated word runtime with reverse order and stagger delays", () => {
    const target = textTarget("Hello, world!");
    const compiled = compileMotionTextRuntime(document);
    executeRuntime(compiled, target);

    expect(target.textContent).toBe("Hello, world!");
    const units = target.children.filter(
      (child) =>
        child.getAttribute("data-agent-native-motion-text-unit") !== null,
    );
    expect(units.map((unit) => unit.textContent)).toEqual(["Hello,", "world!"]);
    expect(units.map((unit) => unit.animations[0]?.options)).toEqual([
      { duration: 320, delay: 40, fill: "both" },
      { duration: 320, delay: 0, fill: "both" },
    ]);
    expect(units[0]?.animations[0]?.keyframes).toEqual([
      { offset: 0, easing: "ease-out", opacity: "0" },
      { offset: 1, easing: "ease-in", opacity: "1" },
    ]);
  });

  it("rejects long emoji-only word targets without rescanning remaining segments", () => {
    const authored = `<div data-agent-native-node-id="headline">${"🙂".repeat(8_192)}</div>`;

    expect(() => injectMotionTextRuntime(authored, document)).toThrow(
      'Motion text target "headline" has no animatable text units.',
    );
  });

  it("plays out keyframes in reverse while preserving their easing and spaces", () => {
    const animation: MotionTextAnimation = {
      ...document.animations[0]!,
      unit: "character",
      direction: "forward",
      animationDirection: "out",
      order: "left-to-right",
      overlapPercent: 50,
      ignoreSpaces: false,
      staggerMs: 0,
      durationMs: 500,
    };
    const target = textTarget("A B");
    executeRuntime(
      compileMotionTextRuntime({ version: 2, animations: [animation] }),
      target,
    );

    const units = target.children.filter(
      (child) =>
        child.getAttribute("data-agent-native-motion-text-unit") !== null,
    );
    expect(units.map((unit) => unit.textContent)).toEqual(["A", "", "B"]);
    expect(units.map((unit) => unit.style.display)).toEqual([
      "inline-block",
      "block",
      "inline-block",
    ]);
    expect(units[1]?.style).toMatchObject({
      position: "absolute",
      width: "0",
      height: "0",
      overflow: "hidden",
    });
    expect(units[1]?.getAttribute("aria-hidden")).toBe("true");
    expect(units.map((unit) => unit.animations[0]?.options)).toEqual([
      { duration: 250, delay: 0, fill: "both" },
      { duration: 250, delay: 125, fill: "both" },
      { duration: 250, delay: 250, fill: "both" },
    ]);
    expect(units[0]?.animations[0]?.keyframes).toEqual([
      { offset: 0, easing: "ease-out", opacity: "1" },
      { offset: 1, easing: "ease-out", opacity: "0" },
    ]);
    expect(target.textContent).toBe("A B");
  });

  it("does not animate whitespace in word grouping when the character-only option is false", () => {
    const animation: MotionTextAnimation = {
      ...document.animations[0]!,
      unit: "word",
      direction: "forward",
      animationDirection: "in",
      order: "left-to-right",
      overlapPercent: 0,
      ignoreSpaces: false,
      staggerMs: 0,
    };
    const target = textTarget('said "hi"');
    executeRuntime(
      compileMotionTextRuntime({ version: 2, animations: [animation] }),
      target,
    );

    const units = target.children.filter(
      (child) =>
        child.getAttribute("data-agent-native-motion-text-unit") !== null,
    );
    expect(units.map((unit) => unit.textContent)).toEqual(["said", '"', 'hi"']);
    expect(target.textContent).toBe('said "hi"');
  });

  it.each(["top-to-bottom", "bottom-to-top"] as const)(
    "rejects %s order for character and word units",
    (order) => {
      for (const unit of ["character", "word"] as const) {
        expect(
          decodeMotionTextDocument(
            JSON.stringify({
              version: 2,
              animations: [{ ...document.animations[0]!, unit, order }],
            }),
          ),
        ).toMatchObject({
          status: "invalid",
          error: { code: "invalid-document" },
        });
      }
      for (const unit of ["line", "paragraph"] as const) {
        expect(
          decodeMotionTextDocument(
            JSON.stringify({
              version: 2,
              animations: [{ ...document.animations[0]!, unit, order }],
            }),
          ),
        ).toMatchObject({ status: "valid" });
      }
    },
  );

  it("keeps each source segment easing when an out animation reverses multiple keyframes", () => {
    const animation: MotionTextAnimation = {
      ...document.animations[0]!,
      unit: "character",
      direction: "forward",
      animationDirection: "out",
      order: "left-to-right",
      overlapPercent: 0,
      ignoreSpaces: true,
      staggerMs: 0,
      durationMs: 500,
      keyframes: [
        { t: 0, value: "0", ease: "ease-out" },
        { t: 0.25, value: "8", ease: "ease-in" },
        { t: 1, value: "16" },
      ],
    };
    const target = textTarget("A");
    executeRuntime(
      compileMotionTextRuntime({ version: 2, animations: [animation] }),
      target,
    );

    const animatedUnit = target.children.find(
      (child) =>
        child.getAttribute("data-agent-native-motion-text-unit") !== null,
    );
    expect(animatedUnit?.animations[0]?.keyframes).toEqual([
      { offset: 0, easing: "ease-in", opacity: "16" },
      { offset: 0.75, easing: "ease-out", opacity: "8" },
      { offset: 1, easing: "ease-out", opacity: "0" },
    ]);
  });

  it("orders units from the center and keeps ignored spaces out of the count", () => {
    const animation: MotionTextAnimation = {
      ...document.animations[0]!,
      unit: "character",
      direction: "forward",
      order: "center-out",
      overlapPercent: 0,
      ignoreSpaces: true,
      staggerMs: 0,
      durationMs: 500,
    };
    const target = textTarget("AB C");
    executeRuntime(
      compileMotionTextRuntime({ version: 2, animations: [animation] }),
      target,
    );

    const units = target.children.filter(
      (child) =>
        child.getAttribute("data-agent-native-motion-text-unit") !== null,
    );
    expect(units.map((unit) => unit.textContent)).toEqual(["A", "B", "C"]);
    expect(units.map((unit) => unit.animations[0]?.options)).toEqual([
      { duration: 500 / 3, delay: 500 / 3, fill: "both" },
      { duration: 500 / 3, delay: 0, fill: "both" },
      { duration: 500 / 3, delay: (500 / 3) * 2, fill: "both" },
    ]);
    expect(target.textContent).toBe("AB C");
  });

  it("uses a repeatable shuffled order", () => {
    const animation: MotionTextAnimation = {
      ...document.animations[0]!,
      unit: "character",
      direction: "forward",
      order: "random",
      overlapPercent: 0,
      ignoreSpaces: false,
      staggerMs: 0,
      durationMs: 500,
    };
    const run = () => {
      const target = textTarget("ABCDE");
      executeRuntime(
        compileMotionTextRuntime({ version: 2, animations: [animation] }),
        target,
      );
      return target.children.map(
        (unit) => (unit.animations[0]?.options as { delay: number }).delay,
      );
    };

    const delays = run();
    expect(delays).toEqual(run());
    expect([...delays].sort((left, right) => left - right)).toEqual([
      0, 100, 200, 300, 400,
    ]);
    expect(delays).not.toEqual([0, 100, 200, 300, 400]);
  });

  it("runs compatible property tracks on the same segmented text units", () => {
    const composite: MotionTextDocument = {
      ...document,
      animations: [
        document.animations[0]!,
        {
          ...document.animations[0]!,
          property: "translate",
          delayMs: 25,
          durationMs: 160,
          keyframes: [
            { t: 0, value: "0px", ease: "ease-out" },
            { t: 1, value: "12px" },
          ],
        },
      ],
    };
    const target = textTarget("Hello, world!");
    const preview = executeRuntime(
      compileMotionTextRuntime(composite),
      target,
      true,
    );
    const units = target.children.filter(
      (child) =>
        child.getAttribute("data-agent-native-motion-text-unit") !== null,
    );

    expect(
      units.map((unit) => unit.animations.map((entry) => entry.options)),
    ).toEqual([
      [
        { duration: 320, delay: 40, fill: "both" },
        { duration: 160, delay: 65, fill: "both" },
      ],
      [
        { duration: 320, delay: 0, fill: "both" },
        { duration: 160, delay: 25, fill: "both" },
      ],
    ]);
    expect(units[0]?.animations.map((entry) => entry.keyframes)).toEqual([
      [
        { offset: 0, easing: "ease-out", opacity: "0" },
        { offset: 1, easing: "ease-in", opacity: "1" },
      ],
      [
        { offset: 0, easing: "ease-out", translate: "0px" },
        { offset: 1, easing: "ease", translate: "12px" },
      ],
    ]);

    preview.sendMessage({ type: "motion-preview", t: 0.2, durationMs: 1000 });
    expect(
      units.map((unit) =>
        unit.animations.map((entry) => entry.handle.currentTime),
      ),
    ).toEqual([
      [200, 200],
      [200, 185],
    ]);
  });

  it("resolves easing variables and converts direct or referenced springs for WAAPI", () => {
    const easingDocument: MotionTextDocument = {
      ...document,
      animations: [
        {
          ...document.animations[0]!,
          direction: "forward",
          order: "left-to-right",
          keyframes: [
            {
              t: 0,
              value: "0",
              ease: "var(--an-motion-ease-springy)",
            },
            { t: 1, value: "1", ease: "spring(0.674)" },
          ],
        },
      ],
    };
    const target = textTarget("Hello world");
    executeRuntime(
      compileMotionTextRuntime(easingDocument),
      target,
      false,
      undefined,
      { "--an-motion-ease-springy": "spring(0.674)" },
    );

    const unit = target.children.find(
      (child) =>
        child.getAttribute("data-agent-native-motion-text-unit") !== null,
    );
    const easings = (unit?.animations[0]?.keyframes as Keyframe[]).map(
      ({ easing }) => easing,
    );
    expect(easings).toHaveLength(2);
    expect(easings[0]).toMatch(/^linear\(/);
    expect(easings[1]).toBe(easings[0]);
  });

  it.each([
    ["loop", { duration: 320, delay: 40, fill: "both", iterations: Infinity }],
    [
      "ping-pong",
      {
        duration: 320,
        delay: 40,
        fill: "both",
        iterations: Infinity,
        direction: "alternate",
      },
    ],
  ] as const)(
    "applies the %s playback mode to published Text motion",
    (mode, expected) => {
      const target = textTarget("Hello, world!");
      executeRuntime(compileMotionTextRuntime(document, mode), target);

      expect(target.children[0]?.animations[0]?.options).toEqual(expected);
    },
  );

  it("keeps inline formatting and treats words split across text nodes as one unit", () => {
    const target = new FakeElement("p");
    target.setAttribute("data-agent-native-node-id", "headline");
    target.appendChild(new FakeTextNode("Mo"));
    const styled = new FakeElement("span");
    styled.setAttribute("class", "accent");
    styled.appendChild(new FakeTextNode("tion"));
    target.appendChild(styled);
    target.appendChild(new FakeTextNode(" works"));

    const formattedDocument: MotionTextDocument = {
      ...document,
      animations: [
        {
          ...document.animations[0]!,
          direction: "forward",
          order: "left-to-right",
        },
      ],
    };
    const authored =
      '<p data-agent-native-node-id="headline">Mo<span class="accent">tion</span> works</p>';
    expect(injectMotionTextRuntime(authored, formattedDocument)).toContain(
      'Mo<span class="accent">tion</span> works',
    );

    executeRuntime(compileMotionTextRuntime(formattedDocument), target);

    const unitNodes: FakeElement[] = [];
    const visit = (node: FakeElement) => {
      if (node.getAttribute("data-agent-native-motion-text-unit") !== null) {
        unitNodes.push(node);
      }
      node.children.forEach(visit);
    };
    visit(target);
    expect(target.textContent).toBe("Motion works");
    expect(styled.children).toHaveLength(1);
    expect(
      styled.children[0]?.getAttribute("data-agent-native-motion-text-unit"),
    ).toBe("0");
    expect(unitNodes.map((unit) => unit.textContent)).toEqual([
      "Mo",
      "tion",
      "works",
    ]);
    expect(
      unitNodes.slice(0, 2).map((unit) => unit.animations[0]?.options),
    ).toEqual([
      { duration: 320, delay: 0, fill: "both" },
      { duration: 320, delay: 0, fill: "both" },
    ]);
  });

  it("seeks Text animations with the Motion timeline and resets on clear", () => {
    const target = textTarget("Hello, world!");
    const preview = executeRuntime(
      compileMotionTextRuntime(document),
      target,
      true,
    );
    const units = target.children.filter(
      (child) =>
        child.getAttribute("data-agent-native-motion-text-unit") !== null,
    );
    expect(units.every((unit) => unit.animations[0]?.handle.paused)).toBe(true);

    preview.sendMessage({ type: "motion-preview", t: 0.1, durationMs: 2000 });
    expect(units.map((unit) => unit.animations[0]?.handle.currentTime)).toEqual(
      [200, 200],
    );

    preview.sendMessage({ type: "motion-preview-clear" });
    expect(units.map((unit) => unit.animations[0]?.handle.currentTime)).toEqual(
      [0, 0],
    );
  });

  it("reports fixed-stagger span and follows the shared parent timeline", () => {
    const staggeredDocument: MotionTextDocument = {
      version: 2,
      animations: [
        {
          targetNodeId: "headline",
          unit: "character",
          direction: "forward",
          staggerMs: 1500,
          animationDirection: "in",
          order: "left-to-right",
          ignoreSpaces: true,
          delayMs: 250,
          property: "opacity",
          durationMs: 1000,
          keyframes: [
            { t: 0, value: "0" },
            { t: 1, value: "1" },
          ],
        },
      ],
    };
    const target = textTarget("ABC");
    const preview = executeRuntime(
      compileMotionTextRuntime(staggeredDocument),
      target,
      true,
    );

    preview.sendMessage({ type: "motion-preview-duration-request" });
    expect(preview.sentMessages).toContainEqual({
      type: "motion-preview-span",
      key: "html",
      durationMs: 4250,
    });

    preview.sendMessage({ type: "motion-preview", t: 1, durationMs: 2000 });
    expect(
      target.children.map((unit) => unit.animations[0]?.handle.currentTime),
    ).toEqual([1250, 2000, 2000]);

    preview.sendMessage({ type: "motion-preview", t: 1, durationMs: 4250 });
    expect(
      target.children.map((unit) => unit.animations[0]?.handle.currentTime),
    ).toEqual([1250, 2750, 4250]);
  });

  it("segments grapheme characters and animates paragraph elements", () => {
    const characterTarget = textTarget("A👩🏽‍🚀B");
    const characterDocument: MotionTextDocument = {
      ...document,
      animations: [
        {
          ...document.animations[0]!,
          unit: "character",
          direction: "forward",
          order: "left-to-right",
        },
      ],
    };
    executeRuntime(
      compileMotionTextRuntime(characterDocument),
      characterTarget,
    );
    const characters = characterTarget.children.filter(
      (child) =>
        child.getAttribute("data-agent-native-motion-text-unit") !== null,
    );
    expect(characters.map((character) => character.textContent)).toEqual([
      "A",
      "👩🏽‍🚀",
      "B",
    ]);
    expect(characterTarget.textContent).toBe("A👩🏽‍🚀B");

    const paragraphTarget = new FakeElement("div");
    paragraphTarget.setAttribute("data-agent-native-node-id", "headline");
    const paragraphs = ["First paragraph", "Second paragraph"].map((text) => {
      const paragraph = new FakeElement("p");
      paragraph.appendChild(new FakeTextNode(text));
      return paragraph;
    });
    paragraphTarget.replaceChildren(...paragraphs);
    const paragraphDocument: MotionTextDocument = {
      ...document,
      animations: [
        {
          ...document.animations[0]!,
          unit: "paragraph",
          direction: "forward",
          order: "left-to-right",
        },
      ],
    };
    executeRuntime(
      compileMotionTextRuntime(paragraphDocument),
      paragraphTarget,
    );

    expect(paragraphTarget.textContent).toBe("First paragraphSecond paragraph");
    expect(
      paragraphs.map((paragraph) => paragraph.animations[0]?.options),
    ).toEqual([
      { duration: 320, delay: 0, fill: "both" },
      { duration: 320, delay: 40, fill: "both" },
    ]);
  });

  it("runs paragraph motion on accepted static inline markup", () => {
    const paragraphDocument: MotionTextDocument = {
      ...document,
      animations: [
        {
          ...document.animations[0]!,
          unit: "paragraph",
          direction: "forward",
          order: "left-to-right",
        },
      ],
    };
    const authored =
      '<div data-agent-native-node-id="headline"><strong>Title</strong></div>';

    expect(() =>
      injectMotionTextRuntime(authored, paragraphDocument),
    ).not.toThrow();
    const target = new FakeElement("div");
    target.setAttribute("data-agent-native-node-id", "headline");
    const strong = new FakeElement("strong");
    strong.appendChild(new FakeTextNode("Title"));
    target.replaceChildren(strong);

    executeRuntime(compileMotionTextRuntime(paragraphDocument), target);

    expect(target.textContent).toBe("Title");
    expect(target.animations).toHaveLength(1);
    expect(target.animations[0]?.options).toEqual({
      duration: 320,
      delay: 0,
      fill: "both",
    });
  });

  it("rejects statically known text spans before source write and guards runtime spans", () => {
    const animation: MotionTextAnimation = {
      ...document.animations[0]!,
      unit: "character",
      direction: "forward",
      order: "left-to-right",
      ignoreSpaces: false,
      staggerMs: 59_740,
      delayMs: 200,
      durationMs: 320,
    };
    const atLimit: MotionTextDocument = {
      version: 2,
      animations: [animation],
    };
    expect(decodeMotionTextDocument(JSON.stringify(atLimit))).toMatchObject({
      status: "valid",
    });
    const target = textTarget("ABC");
    executeRuntime(compileMotionTextRuntime(atLimit), target, true);
    const units = target.children.filter(
      (child) =>
        child.getAttribute("data-agent-native-motion-text-unit") !== null,
    );
    const lastUnitAnimation = units[2]?.animations[0]?.options as
      | { delay: number; duration: number }
      | undefined;
    expect(
      Number(lastUnitAnimation?.delay) + Number(lastUnitAnimation?.duration),
    ).toBe(120_000);

    const longStaggerDocument: MotionTextDocument = {
      version: 2,
      animations: [{ ...animation, staggerMs: 9_600, delayMs: 0 }],
    };
    const thirteenCharacters =
      '<div data-agent-native-node-id="headline">ABCDEFGHIJKLM</div>';
    const fourteenCharacters =
      '<div data-agent-native-node-id="headline">ABCDEFGHIJKLMN</div>';
    expect(() =>
      injectMotionTextRuntime(thirteenCharacters, longStaggerDocument),
    ).not.toThrow();
    expect(() =>
      injectMotionTextRuntime(fourteenCharacters, longStaggerDocument),
    ).toThrow(
      'Motion text target "headline" resolves to 14 character units whose animation span exceeds the 120000ms runtime limit.',
    );
    const compiledLongStagger = compileMotionTextRuntime(longStaggerDocument);
    expect(
      readMotionTextDocument(
        `${fourteenCharacters}${compiledLongStagger.sourceMarkup}\n${compiledLongStagger.runtimeMarkup}`,
      ),
    ).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });

    const overLimit: MotionTextDocument = {
      version: 2,
      animations: [{ ...animation, staggerMs: 60_000 }],
    };
    expect(decodeMotionTextDocument(JSON.stringify(overLimit))).toMatchObject({
      status: "valid",
    });
    expect(() =>
      executeRuntime(compileMotionTextRuntime(overLimit), textTarget("ABC")),
    ).toThrow("Motion text animation span exceeds the 120000ms runtime limit.");
  });

  it("bounds line spans by the word fragments the runtime can place on separate lines", () => {
    const lineDocument: MotionTextDocument = {
      version: 2,
      animations: [
        {
          ...document.animations[0]!,
          unit: "line",
          staggerMs: 9_600,
          delayMs: 0,
          durationMs: 1_000,
        },
      ],
    };
    const textNodes = (count: number) =>
      `<div data-agent-native-node-id="headline">${"<span>A</span>".repeat(count)}</div>`;

    expect(() =>
      injectMotionTextRuntime(textNodes(13), lineDocument),
    ).not.toThrow();
    expect(() => injectMotionTextRuntime(textNodes(14), lineDocument)).toThrow(
      'Motion text target "headline" resolves to at most 14 line units whose animation span exceeds the 120000ms runtime limit.',
    );
    expect(() =>
      injectMotionTextRuntime(
        '<div data-agent-native-node-id="headline">' +
          "A".repeat(513) +
          "</div>",
        lineDocument,
      ),
    ).not.toThrow();
    expect(() => injectMotionTextRuntime(textNodes(513), lineDocument)).toThrow(
      'Motion text target "headline" exceeds the 512-unit runtime limit.',
    );
  });

  it("groups line units by rendered line while keeping text content intact", () => {
    const lineDocument: MotionTextDocument = {
      ...document,
      animations: [
        {
          ...document.animations[0]!,
          unit: "line",
          direction: "forward",
          order: "left-to-right",
        },
      ],
    };
    const target = textTarget("One two three");
    executeRuntime(
      compileMotionTextRuntime(lineDocument),
      target,
      false,
      (index) => (index < 2 ? 0 : 16),
    );

    const units = target.children.filter(
      (child) =>
        child.getAttribute("data-agent-native-motion-text-unit") !== null,
    );
    expect(target.textContent).toBe("One two three");
    expect(units.map((unit) => unit.animations[0]?.options)).toEqual([
      { duration: 320, delay: 0, fill: "both" },
      { duration: 320, delay: 0, fill: "both" },
      { duration: 320, delay: 40, fill: "both" },
    ]);
  });

  it("rejects more than the runtime unit limit of separately wrapped line fragments", () => {
    const lineDocument: MotionTextDocument = {
      ...document,
      animations: [
        {
          ...document.animations[0]!,
          unit: "line",
          direction: "forward",
          order: "left-to-right",
        },
      ],
    };
    const target = new FakeElement("h1");
    target.setAttribute("data-agent-native-node-id", "headline");
    for (let index = 0; index < 513; index += 1) {
      const formatted = new FakeElement("span");
      formatted.appendChild(new FakeTextNode("A"));
      target.appendChild(formatted);
    }

    expect(() =>
      executeRuntime(
        compileMotionTextRuntime(lineDocument),
        target,
        false,
        (index) => index,
      ),
    ).toThrow("Motion text target exceeds the 512-unit runtime limit.");
  });

  it("rejects duplicate, malformed, and unsupported source markers", () => {
    const valid = injectMotionTextRuntime(
      '<body><h1 data-agent-native-node-id="headline">Hello</h1></body>',
      document,
    );
    expect(readMotionTextDocument(valid + valid).status).toBe("invalid");
    expect(
      readMotionTextDocument(
        valid.replace(
          'data-agent-native-motion-text-source="v2"',
          'data-agent-native-motion-text-source="v99"',
        ),
      ),
    ).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-version" },
    });
    expect(
      readMotionTextDocument(
        valid.replace(
          /(<script type="application\/json" data-agent-native-motion-text-source="v2">)[\s\S]*?(<\/script>)/,
          "$1{$2",
        ),
      ),
    ).toMatchObject({ status: "invalid", error: { code: "malformed-json" } });
  });

  it("surfaces missing and dynamic targets as typed read errors", () => {
    const missing = injectMotionTextRuntime(
      '<body><h1 data-agent-native-node-id="headline">Hello</h1></body>',
      document,
    ).replace(
      'data-agent-native-node-id="headline"',
      'data-agent-native-node-id="other"',
    );
    expect(readMotionTextDocument(missing)).toMatchObject({
      status: "invalid",
      error: { code: "target-missing" },
    });

    const dynamic = injectMotionTextRuntime(
      '<body><h1 data-agent-native-node-id="headline">Hello</h1></body>',
      document,
    ).replace(
      '<h1 data-agent-native-node-id="headline">',
      '<h1 data-agent-native-node-id="headline" x-text="heading">',
    );
    expect(readMotionTextDocument(dynamic)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it("refuses dynamic and unsupported block markup rather than rewriting it", () => {
    expect(() =>
      injectMotionTextRuntime(
        '<p data-agent-native-node-id="headline" x-text="heading"></p>',
        document,
      ),
    ).toThrow(/dynamic text or structural bindings/);
    expect(() =>
      injectMotionTextRuntime(
        '<div data-agent-native-node-id="headline"><p>Hello</p><p>world</p></div>',
        document,
      ),
    ).toThrow(/supported inline formatting/);
  });

  describe("crop and pivot", () => {
    const rotating: MotionTextAnimation = {
      ...document.animations[0]!,
      unit: "character",
      direction: "forward",
      order: "left-to-right",
      property: "rotate",
      keyframes: [
        { t: 0, value: "90deg" },
        { t: 1, value: "0deg" },
      ],
    };
    const unitsOf = (target: FakeElement) =>
      target.children.filter(
        (child) =>
          child.getAttribute("data-agent-native-motion-text-unit") !== null,
      );

    it("round-trips crop and pivot and drops a false crop", () => {
      const withControls: MotionTextDocument = {
        version: 2,
        animations: [
          { ...rotating, clipContent: true, originX: 0, originY: 100 },
        ],
      };
      const encoded = encodeMotionTextDocument(withControls);

      expect(decodeMotionTextDocument(encoded)).toEqual({
        status: "valid",
        document: withControls,
      });
      expect(
        encodeMotionTextDocument({
          version: 2,
          animations: [{ ...rotating, clipContent: false }],
        }),
      ).not.toContain("clipContent");
    });

    it("fills a missing pivot axis with the center and rejects bad values", () => {
      const decoded = decodeMotionTextDocument(
        JSON.stringify({
          version: 2,
          animations: [{ ...rotating, originX: 25 }],
        }),
      );

      expect(decoded).toMatchObject({
        status: "valid",
        document: { animations: [{ originX: 25, originY: 50 }] },
      });
      for (const animation of [
        { ...rotating, originX: 101 },
        { ...rotating, originY: -1 },
        { ...rotating, originX: "left" },
        { ...rotating, clipContent: "yes" },
      ]) {
        expect(
          decodeMotionTextDocument(
            JSON.stringify({ version: 2, animations: [animation] }),
          ),
        ).toMatchObject({
          status: "invalid",
          error: { code: "invalid-document" },
        });
      }
    });

    it("crops the target to its box and pivots each unit when requested", () => {
      const target = textTarget("AB");
      executeRuntime(
        compileMotionTextRuntime({
          version: 2,
          animations: [
            { ...rotating, clipContent: true, originX: 0, originY: 100 },
          ],
        }),
        target,
      );

      expect(target.style.clipPath).toBe("inset(0)");
      expect(unitsOf(target).map((unit) => unit.style.transformOrigin)).toEqual(
        ["0% 100%", "0% 100%"],
      );
    });

    it("lifts the crop once the preview has rewritten the units", () => {
      mutationCallbacks.length = 0;
      const target = textTarget("AB");
      target.style.clipPath = "";
      executeRuntime(
        compileMotionTextRuntime({
          version: 2,
          animations: [{ ...rotating, clipContent: true }],
        }),
        target,
      );
      expect(target.style.clipPath).toBe("inset(0)");

      mutationCallbacks.forEach((notify) => notify());
      expect(target.style.clipPath).toBe("inset(0)");

      target.replaceChildren(new FakeTextNode("AB"));
      mutationCallbacks.forEach((notify) => notify());
      expect(target.style.clipPath).toBe("");
    });

    it("keeps the crop a newer run requested when an older run's observer fires", () => {
      mutationCallbacks.length = 0;
      const target = textTarget("AB");
      target.style.clipPath = "";
      const animations = compileMotionTextRuntime({
        version: 2,
        animations: [{ ...rotating, clipContent: true }],
      });
      executeRuntime(animations, target);
      target.replaceChildren(new FakeTextNode("AB"));
      executeRuntime(animations, target);

      mutationCallbacks.forEach((notify) => notify());
      expect(target.style.clipPath).toBe("inset(0)");
    });

    it("lifts the crop of a paragraph target once its content is rewritten", () => {
      mutationCallbacks.length = 0;
      const target = new FakeElement("p");
      target.setAttribute("data-agent-native-node-id", "headline");
      target.appendChild(new FakeTextNode("AB"));
      target.style.clipPath = "";
      executeRuntime(
        compileMotionTextRuntime({
          version: 2,
          animations: [{ ...rotating, unit: "paragraph", clipContent: true }],
        }),
        target,
      );
      expect(target.style.clipPath).toBe("inset(0)");

      target.replaceChildren(new FakeTextNode("CD"));
      mutationCallbacks.forEach((notify) => notify());
      expect(target.style.clipPath).toBe("");
    });

    it("lifts the crop when a rerun no longer asks for it", () => {
      const target = textTarget("AB");
      target.style.clipPath = "";
      executeRuntime(
        compileMotionTextRuntime({
          version: 2,
          animations: [{ ...rotating, clipContent: true }],
        }),
        target,
      );
      expect(target.style.clipPath).toBe("inset(0)");

      executeRuntime(
        compileMotionTextRuntime({ version: 2, animations: [rotating] }),
        target,
      );
      expect(target.style.clipPath).toBe("");
    });

    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const handlesOf = (target: FakeElement) =>
      unitsOf(target).flatMap((unit) =>
        unit.animations.map((animation) => animation.handle),
      );

    it("lifts the crop once a move that plays once has finished", async () => {
      const target = textTarget("AB");
      target.style.clipPath = "";
      executeRuntime(
        compileMotionTextRuntime(
          { version: 2, animations: [{ ...rotating, clipContent: true }] },
          "once",
        ),
        target,
      );
      expect(target.style.clipPath).toBe("inset(0)");

      handlesOf(target).forEach((handle) => handle.finish());
      await settle();
      expect(target.style.clipPath).toBe("");
    });

    it("keeps the crop of a looping move, which never finishes", async () => {
      const target = textTarget("AB");
      target.style.clipPath = "";
      executeRuntime(
        compileMotionTextRuntime(
          { version: 2, animations: [{ ...rotating, clipContent: true }] },
          "loop",
        ),
        target,
      );

      await settle();
      expect(target.style.clipPath).toBe("inset(0)");
    });

    it("lifts the crop once every move has settled, even if one was cancelled", async () => {
      const target = textTarget("AB");
      target.style.clipPath = "";
      executeRuntime(
        compileMotionTextRuntime(
          { version: 2, animations: [{ ...rotating, clipContent: true }] },
          "once",
        ),
        target,
      );
      const [cancelled, ...others] = handlesOf(target);
      cancelled!.cancel();
      others.forEach((handle) => handle.finish());
      await settle();
      expect(target.style.clipPath).toBe("");
    });

    it("does not let an earlier run's finished move lift the newer run's crop", async () => {
      const target = textTarget("AB");
      target.style.clipPath = "";
      const animations = compileMotionTextRuntime(
        { version: 2, animations: [{ ...rotating, clipContent: true }] },
        "once",
      );
      executeRuntime(animations, target);
      const earlier = handlesOf(target);
      target.replaceChildren(new FakeTextNode("AB"));
      executeRuntime(animations, target);

      earlier.forEach((handle) => handle.finish());
      await settle();
      expect(target.style.clipPath).toBe("inset(0)");

      handlesOf(target).forEach((handle) => handle.finish());
      await settle();
      expect(target.style.clipPath).toBe("");
    });

    it("restores a paragraph pivot once a later run stops setting it", () => {
      const target = new FakeElement("p");
      target.setAttribute("data-agent-native-node-id", "headline");
      target.appendChild(new FakeTextNode("AB"));
      target.style.transformOrigin = "10% 10%";
      executeRuntime(
        compileMotionTextRuntime({
          version: 2,
          animations: [
            { ...rotating, unit: "paragraph", originX: 0, originY: 100 },
          ],
        }),
        target,
      );
      expect(target.style.transformOrigin).toBe("0% 100%");

      executeRuntime(
        compileMotionTextRuntime({
          version: 2,
          animations: [{ ...rotating, unit: "paragraph" }],
        }),
        target,
      );
      expect(target.style.transformOrigin).toBe("10% 10%");
    });

    it("leaves the target uncropped and the pivot untouched by default", () => {
      const target = textTarget("AB");
      executeRuntime(
        compileMotionTextRuntime({ version: 2, animations: [rotating] }),
        target,
      );

      expect(target.style.clipPath).toBeUndefined();
      expect(unitsOf(target).map((unit) => unit.style.transformOrigin)).toEqual(
        [undefined, undefined],
      );
    });
  });

  describe("text stagger worked cases", () => {
    const stagger = (props: Record<string, string | number | boolean>) => {
      const base = createMotionNativeStyleInstance({
        styleKey: "TextStagger",
        targetNodeId: "headline",
      });
      return compileMotionTextRuntime({
        version: 2,
        animations: motionNativeStylesToTextAnimations([
          { ...base, props: { ...base.props, ...props } },
        ]),
      });
    };
    const unitsOf = (target: FakeElement) =>
      target.children.filter(
        (child) =>
          child.getAttribute("data-agent-native-motion-text-unit") !== null,
      );

    it("starts the rightmost word first for word units from right to left", () => {
      const target = textTarget("Hello big world");
      executeRuntime(
        stagger({ textDelayGrouping: "WORD", textDelayOrder: "RIGHT_LEFT" }),
        target,
      );
      const delays = unitsOf(target).map(
        (unit) => (unit.animations[0]?.options as { delay: number }).delay,
      );

      expect(unitsOf(target).map((unit) => unit.textContent)).toEqual([
        "Hello",
        "big",
        "world",
      ]);
      expect(delays[2]).toBe(0);
      expect(delays[2]).toBeLessThan(delays[1]!);
      expect(delays[1]).toBeLessThan(delays[0]!);
    });

    it("ends in the altered look when switched to out", () => {
      const target = textTarget("A");
      executeRuntime(stagger({ animationDirection: "out" }), target);

      expect(unitsOf(target)[0]?.animations[0]?.keyframes).toEqual([
        { offset: 0, easing: "ease-out", translate: "0px 0px" },
        { offset: 1, easing: "ease-out", translate: "0px -40px" },
      ]);
    });

    it("starts in the altered look when playing in", () => {
      const target = textTarget("A");
      executeRuntime(stagger({}), target);

      expect(unitsOf(target)[0]?.animations[0]?.keyframes).toEqual([
        { offset: 0, easing: "ease-out", translate: "0px -40px" },
        { offset: 1, easing: "ease", translate: "0px 0px" },
      ]);
    });

    it("crops with the move effect shown and not once the move is hidden", () => {
      const cropped = textTarget("A");
      executeRuntime(stagger({ clipContent: true }), cropped);
      expect(cropped.style.clipPath).toBe("inset(0)");

      const hidden = textTarget("A");
      executeRuntime(
        stagger({
          clipContent: true,
          positionVisible: false,
          opacityEnabled: true,
        }),
        hidden,
      );
      expect(unitsOf(hidden)[0]?.animations).toHaveLength(1);
      expect(hidden.style.clipPath).toBeUndefined();
    });
  });
});
