import { describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError }),
}));

import { runApplyLayoutFlow } from "./apply-layout-flow";

const CONTENT = `<body><div data-agent-native-node-id="row" style="display: flex; width: 320px"><div data-agent-native-node-id="grow" style="flex-grow: 1; margin: 4px"></div></div></body>`;

const styleOf = (content: string, id: string) =>
  new RegExp(`data-agent-native-node-id="${id}"[^>]*style="([^"]*)"`).exec(
    content,
  )?.[1] ?? "";

function apply(
  patches: Map<string, Record<string, string | null>>,
  containerStyles: Record<string, string> = {},
) {
  const published: string[] = [];
  const outcome = runApplyLayoutFlow(
    {
      applyLocalContentUpdate: (next) => published.push(next),
      canEditDesign: true,
      getFreshActiveContent: () => CONTENT,
      source: { kind: "design-file", fileId: "screen" },
      t: (key) => key,
    },
    [],
    containerStyles,
    patches,
  );
  return { outcome, published };
}

describe("runApplyLayoutFlow with node patches", () => {
  it("lands the frame and its children in one content update", () => {
    const { outcome, published } = apply(
      new Map<string, Record<string, string | null>>([
        ["row", { width: "fit-content" }],
        ["grow", { width: "212px", flexGrow: "0", margin: null }],
      ]),
    );
    expect(outcome).toBe("applied");
    expect(published).toHaveLength(1);
    expect(styleOf(published[0]!, "row")).toMatch(/width:\s*fit-content/);
    const grow = styleOf(published[0]!, "grow");
    expect(grow).toMatch(/width:\s*212px/);
    expect(grow).toMatch(/flex-grow:\s*0/);
    expect(grow).not.toMatch(/margin/);
  });

  it("publishes nothing when any node cannot be patched", () => {
    toastError.mockClear();
    const { outcome, published } = apply(
      new Map([
        ["row", { width: "fit-content" }],
        ["missing", { width: "10px" }],
      ]),
    );
    expect(outcome).toBe("failed");
    expect(published).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
