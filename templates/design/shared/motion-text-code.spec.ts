import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  MOTION_TEXT_RUNTIME_ATTRIBUTE,
  MOTION_TEXT_SOURCE_ATTRIBUTE,
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

  pause(): void {
    this.paused = true;
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

  getBoundingClientRect(): { top: number } {
    return { top: this.top };
  }

  animate(keyframes: unknown, options: unknown): FakeWebAnimation {
    const handle = new FakeWebAnimation();
    this.animations.push({ keyframes, options, handle });
    return handle;
  }
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
): { sendMessage: (data: unknown) => void } {
  const runtimeTargets = [target];
  const parent = {};
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
    window: fakeWindow,
  });
  return {
    sendMessage: (data) => messageListener?.({ source: parent, data }),
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

    expect(decodeMotionTextDocument(JSON.stringify(legacy))).toEqual({
      status: "valid",
      document: expected,
    });
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
      [160, 135],
      [200, 160],
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
      [160, 200],
    );

    preview.sendMessage({ type: "motion-preview-clear" });
    expect(units.map((unit) => unit.animations[0]?.handle.currentTime)).toEqual(
      [0, 0],
    );
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
});
