import { describe, expect, it } from "vitest";

import {
  CARD_HEADER_HEIGHT,
  CARD_PROVENANCE_HEADER_HEIGHT,
  COLUMN_GAP,
  JourneyLayoutError,
  LABEL_HEIGHT,
  ROW_GAP,
  STACK_STEP,
  STUB_HEIGHT,
  STUB_WIDTH,
  cardSize,
  clampAspect,
  layoutJourneyAppBands,
  layoutJourney,
  type JourneyLayoutNode,
  type PlacedNode,
  type Rect,
} from "./journey-layout.js";

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function randomTree(seed: number, size: number): JourneyLayoutNode[] {
  const random = mulberry32(seed);
  const nodes: JourneyLayoutNode[] = [];
  const cards: string[] = [];
  const aspects = [0.1, 0.46, 0.56, 1, 1.6, 2, 3.4, 5];
  for (let index = 0; index < size; index += 1) {
    const key = `n${index}`;
    const parent =
      cards.length === 0 || random() < 0.12
        ? null
        : cards[Math.floor(random() * cards.length)]!;
    const isStub = parent !== null && random() < 0.25;
    if (isStub) {
      nodes.push({ key, parentKey: parent, kind: "stub" });
      continue;
    }
    const aspect = aspects[Math.floor(random() * aspects.length)]!;
    const width = 400 + Math.floor(random() * 1600);
    nodes.push({
      key,
      parentKey: parent,
      kind: "card",
      frame: { width, height: Math.max(1, Math.round(width / aspect)) },
      layers: Math.floor(random() * 4),
      footer: random() < 0.9,
    });
    cards.push(key);
  }
  return nodes;
}

describe("cardSize", () => {
  it("derives the image height from the real aspect ratio", () => {
    expect(cardSize(360, { width: 1440, height: 900 })).toEqual({
      width: 360,
      height: CARD_HEADER_HEIGHT + 225,
      imageHeight: 225,
    });
    expect(cardSize(360, { width: 390, height: 780 }).imageHeight).toBe(720);
  });

  it("reserves card height for visible journey-example provenance", () => {
    expect(
      cardSize(
        360,
        { width: 1440, height: 900 },
        undefined,
        CARD_PROVENANCE_HEADER_HEIGHT,
      ).height,
    ).toBe(CARD_PROVENANCE_HEADER_HEIGHT + 225);
  });

  it("clamps the box to [0.5, 2] so ultra-wide and ultra-tall frames stay bounded", () => {
    expect(clampAspect(4)).toBe(2);
    expect(clampAspect(0.1)).toBe(0.5);
    expect(cardSize(360, { width: 3000, height: 500 }).imageHeight).toBe(180);
    expect(cardSize(360, { width: 300, height: 3000 }).imageHeight).toBe(720);
  });
});

describe("layoutJourney", () => {
  const tree: JourneyLayoutNode[] = [
    {
      key: "a",
      parentKey: null,
      kind: "card",
      frame: { width: 1440, height: 900 },
      layers: 2,
      footer: true,
    },
    {
      key: "b",
      parentKey: "a",
      kind: "card",
      frame: { width: 390, height: 844 },
      footer: true,
    },
    {
      key: "c",
      parentKey: "a",
      kind: "card",
      frame: { width: 1280, height: 800 },
      footer: true,
    },
    { key: "a-drop", parentKey: "a", kind: "stub" },
  ];

  it("puts depth in columns and centres a parent on its children", () => {
    const layout = layoutJourney(tree, { cardWidth: 360 });
    const byKey = new Map(layout.nodes.map((node) => [node.key, node]));
    const a = byKey.get("a")!;
    const b = byKey.get("b")!;
    const stub = byKey.get("a-drop")!;
    expect(a.rect.x).toBe(0);
    expect(b.rect.x).toBe(360 + COLUMN_GAP);
    expect(stub.rect.width).toBe(STUB_WIDTH);
    const centre = (node: PlacedNode) => node.rect.y + node.rect.height / 2;
    expect(
      Math.abs(centre(a) - (centre(b) + centre(stub)) / 2),
    ).toBeLessThanOrEqual(1);
  });

  it("stacks extra examples below the front card and puts the date under the stack", () => {
    const a = layoutJourney(tree, { cardWidth: 360 }).nodes.find(
      (node) => node.key === "a",
    )!;
    expect(a.layers.map((layer) => layer.y - a.rect.y)).toEqual([
      STACK_STEP,
      STACK_STEP * 2,
    ]);
    expect(a.footer!.y).toBeGreaterThanOrEqual(
      a.rect.y + a.rect.height + STACK_STEP * 2,
    );
    expect(a.footprint.y + a.footprint.height).toBe(
      a.footer!.y + a.footer!.height,
    );
  });

  it("draws one edge per child, ending on the child's left edge, with the label inside the column gap", () => {
    const layout = layoutJourney(tree, { cardWidth: 360 });
    expect(layout.edges.map((edge) => edge.toKey).sort()).toEqual([
      "a-drop",
      "b",
      "c",
    ]);
    const byKey = new Map(layout.nodes.map((node) => [node.key, node]));
    const a = byKey.get("a")!;
    for (const edge of layout.edges) {
      const child = byKey.get(edge.toKey)!;
      const end = edge.points[edge.points.length - 1]!;
      expect(end.x).toBe(child.rect.x);
      expect(end.y).toBe(Math.round(child.rect.y + child.rect.height / 2));
      expect(edge.labelRect.x).toBeGreaterThanOrEqual(a.rect.x + a.rect.width);
      expect(edge.labelRect.x + edge.labelRect.width).toBeLessThanOrEqual(
        child.rect.x,
      );
      expect(edge.labelRect.height).toBe(LABEL_HEIGHT);
    }
  });

  it("lays out several roots top to bottom and is deterministic", () => {
    const forest: JourneyLayoutNode[] = [
      { key: "r1", parentKey: null, kind: "card", footer: true },
      { key: "r2", parentKey: null, kind: "card", footer: true },
      { key: "r1-drop", parentKey: "r1", kind: "stub" },
    ];
    const first = layoutJourney(forest, { cardWidth: 360 });
    expect(layoutJourney(forest, { cardWidth: 360 })).toEqual(first);
    const [r1, r2] = first.nodes;
    expect(r2!.footprint.y).toBeGreaterThan(
      r1!.footprint.y + r1!.footprint.height,
    );
  });

  it("rejects duplicate keys, missing parents, stub parents and cycles", () => {
    const card = (
      key: string,
      parentKey: string | null,
    ): JourneyLayoutNode => ({
      key,
      parentKey,
      kind: "card",
    });
    expect(() =>
      layoutJourney([card("a", null), card("a", null)], { cardWidth: 360 }),
    ).toThrow(JourneyLayoutError);
    expect(() =>
      layoutJourney([card("a", "ghost")], { cardWidth: 360 }),
    ).toThrow(/missing parent "ghost"/);
    expect(() =>
      layoutJourney(
        [
          card("a", null),
          { key: "s", parentKey: "a", kind: "stub" },
          card("c", "s"),
        ],
        { cardWidth: 360 },
      ),
    ).toThrow(/Stub "s" cannot have child/);
    expect(() =>
      layoutJourney([card("a", "b"), card("b", "a")], { cardWidth: 360 }),
    ).toThrow(/cycle/);
  });

  it("never overlaps: seeded random trees, up to 120 nodes, mixed aspect ratios and stacks", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const size = seed % 5 === 0 ? 120 : 5 + (seed % 55);
      const nodes = randomTree(seed, size);
      const layout = layoutJourney(nodes, { cardWidth: 360 });
      expect(layout.nodes).toHaveLength(nodes.length);

      for (let i = 0; i < layout.nodes.length; i += 1) {
        const a = layout.nodes[i]!;
        for (const rect of [a.rect, a.footprint, ...a.layers]) {
          expect(
            Number.isFinite(rect.x + rect.y + rect.width + rect.height),
          ).toBe(true);
        }
        for (let j = i + 1; j < layout.nodes.length; j += 1) {
          const b = layout.nodes[j]!;
          expect(
            intersects(a.footprint, b.footprint),
            `seed ${seed}: ${a.key} overlaps ${b.key}`,
          ).toBe(false);
        }
        for (const edge of layout.edges) {
          if (edge.fromKey === a.key || edge.toKey === a.key) continue;
          expect(
            intersects(a.footprint, edge.labelRect),
            `seed ${seed}: label ${edge.fromKey}>${edge.toKey} overlaps ${a.key}`,
          ).toBe(false);
        }
      }

      for (let i = 0; i < layout.edges.length; i += 1) {
        for (let j = i + 1; j < layout.edges.length; j += 1) {
          expect(
            intersects(layout.edges[i]!.labelRect, layout.edges[j]!.labelRect),
            `seed ${seed}: edge labels ${i} and ${j} overlap`,
          ).toBe(false);
        }
      }

      const byKey = new Map(layout.nodes.map((node) => [node.key, node]));
      for (const node of layout.nodes) {
        if (node.parentKey === null) continue;
        const parent = byKey.get(node.parentKey)!;
        expect(node.rect.x).toBeGreaterThanOrEqual(
          parent.rect.x + parent.rect.width + COLUMN_GAP,
        );
      }
    }
  });

  it("keeps stubs at least a row gap away from their siblings", () => {
    const nodes: JourneyLayoutNode[] = [
      { key: "p", parentKey: null, kind: "card", footer: true },
      ...Array.from({ length: 6 }, (_, index) => ({
        key: `s${index}`,
        parentKey: "p",
        kind: "stub" as const,
      })),
    ];
    const { nodes: placed } = layoutJourney(nodes, { cardWidth: 360 });
    const stubs = placed.filter((node) => node.kind === "stub");
    for (let index = 1; index < stubs.length; index += 1) {
      expect(stubs[index]!.rect.y - stubs[index - 1]!.rect.y).toBe(
        STUB_HEIGHT + ROW_GAP,
      );
    }
  });
});

describe("layoutJourneyAppBands", () => {
  it("packs sibling forks independently of each branch's descendant depth", () => {
    const layout = layoutJourneyAppBands(
      [
        {
          key: "clips",
          rootN: 100,
          nodes: [
            { key: "clips::choice", parentKey: null, kind: "card" },
            { key: "clips::custom", parentKey: "clips::choice", kind: "card" },
            {
              key: "clips::custom-1",
              parentKey: "clips::custom",
              kind: "card",
            },
            {
              key: "clips::custom-2",
              parentKey: "clips::custom-1",
              kind: "card",
            },
            {
              key: "clips::custom-3",
              parentKey: "clips::custom-2",
              kind: "card",
            },
            {
              key: "clips::builder",
              parentKey: "clips::choice",
              kind: "card",
            },
            { key: "clips::skip", parentKey: "clips::choice", kind: "card" },
          ],
        },
      ],
      { cardWidth: 360 },
    );
    const byKey = new Map(layout.nodes.map((node) => [node.key, node]));
    const custom = byKey.get("clips::custom")!;
    const builder = byKey.get("clips::builder")!;
    const skip = byKey.get("clips::skip")!;

    expect(builder.rect.y).toBe(
      custom.footprint.y + custom.footprint.height + ROW_GAP,
    );
    expect(skip.rect.y).toBe(
      builder.footprint.y + builder.footprint.height + ROW_GAP,
    );
    expect(layout.edges).toContainEqual(
      expect.objectContaining({
        fromKey: "clips::choice",
        toKey: "clips::builder",
      }),
    );
  });

  it("keeps independent app trees side by side with only their internal edges", () => {
    const layout = layoutJourneyAppBands(
      [
        {
          key: "clips",
          rootN: 100,
          nodes: [
            { key: "clips::root", parentKey: null, kind: "card" },
            { key: "clips::child", parentKey: "clips::root", kind: "card" },
          ],
        },
        {
          key: "design",
          rootN: 40,
          nodes: [
            { key: "design::root", parentKey: null, kind: "card" },
            { key: "design::child", parentKey: "design::root", kind: "card" },
          ],
        },
      ],
      { cardWidth: 360 },
    );
    const byKey = new Map(layout.nodes.map((node) => [node.key, node]));
    const clipsRoot = byKey.get("clips::root")!;
    const clipsChild = byKey.get("clips::child")!;
    const designRoot = byKey.get("design::root")!;
    const designChild = byKey.get("design::child")!;

    expect(layout.bands.map((band) => band.key)).toEqual(["clips", "design"]);
    expect(layout.edges.map((edge) => [edge.fromKey, edge.toKey])).toEqual([
      ["clips::root", "clips::child"],
      ["design::root", "design::child"],
    ]);
    expect(designRoot.rect.x).toBeGreaterThan(clipsChild.footprint.x);
    expect(clipsRoot.rect.y).toBe(designRoot.rect.y);
    for (const left of layout.nodes) {
      for (const right of layout.nodes) {
        if (left.key >= right.key) continue;
        expect(intersects(left.footprint, right.footprint)).toBe(false);
      }
    }
  });

  it("keeps top-aligned onboarding bands free of card and label overlaps", () => {
    const prefixNodes = (app: string, nodes: JourneyLayoutNode[]) =>
      nodes.map((node) => ({
        ...node,
        key: `${app}::${node.key}`,
        parentKey: node.parentKey ? `${app}::${node.parentKey}` : null,
      }));
    const layout = layoutJourneyAppBands(
      [
        {
          key: "clips",
          rootN: 900,
          nodes: prefixNodes("clips", randomTree(91, 80)),
        },
        {
          key: "slides",
          rootN: 700,
          nodes: prefixNodes("slides", randomTree(92, 80)),
        },
      ],
      { cardWidth: 360 },
    );

    for (let index = 0; index < layout.nodes.length; index += 1) {
      const node = layout.nodes[index]!;
      for (
        let otherIndex = index + 1;
        otherIndex < layout.nodes.length;
        otherIndex += 1
      ) {
        expect(
          intersects(node.footprint, layout.nodes[otherIndex]!.footprint),
          `${node.key} overlaps ${layout.nodes[otherIndex]!.key}`,
        ).toBe(false);
      }
      for (const edge of layout.edges) {
        if (edge.fromKey === node.key || edge.toKey === node.key) continue;
        expect(
          intersects(node.footprint, edge.labelRect),
          `label ${edge.fromKey}>${edge.toKey} overlaps ${node.key}`,
        ).toBe(false);
      }
    }
    for (let index = 0; index < layout.edges.length; index += 1) {
      for (
        let otherIndex = index + 1;
        otherIndex < layout.edges.length;
        otherIndex += 1
      ) {
        expect(
          intersects(
            layout.edges[index]!.labelRect,
            layout.edges[otherIndex]!.labelRect,
          ),
          `edge labels ${index} and ${otherIndex} overlap`,
        ).toBe(false);
      }
    }
    expect(
      layout.edges.every(
        ({ fromKey, toKey }) =>
          fromKey.startsWith("clips::") === toKey.startsWith("clips::"),
      ),
    ).toBe(true);
  });

  it("rejects duplicate node keys across bands and missing intra-band parents", () => {
    expect(() =>
      layoutJourneyAppBands(
        [
          {
            key: "clips",
            rootN: 2,
            nodes: [{ key: "same", parentKey: null, kind: "card" }],
          },
          {
            key: "design",
            rootN: 2,
            nodes: [{ key: "same", parentKey: null, kind: "card" }],
          },
        ],
        { cardWidth: 360 },
      ),
    ).toThrow(/Duplicate node key/);
    expect(() =>
      layoutJourneyAppBands(
        [
          {
            key: "clips",
            rootN: 2,
            nodes: [
              { key: "clips::child", parentKey: "design::root", kind: "card" },
            ],
          },
        ],
        { cardWidth: 360 },
      ),
    ).toThrow(/missing parent/);
  });
});
