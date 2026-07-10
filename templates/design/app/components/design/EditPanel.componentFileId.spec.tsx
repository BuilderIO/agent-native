/**
 * Bug 2 regression — the active design file id must reach both the
 * `get-component-details` read and the `apply-component-prop-edit` write, so
 * editing a component on a non-`index.html` screen targets the right file
 * instead of defaulting to `index.html`.
 *
 * We render `ComponentSection` with the client hooks mocked, capturing the
 * arguments the component passes to `useActionQuery` (read) and to the
 * mutation's `mutate` (write). The Select primitive is mocked to fire
 * `onValueChange` during render so the write path executes without a DOM.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Capture buckets ─────────────────────────────────────────────────────────
const queryCalls: Array<{ name: string; params: unknown }> = [];
const mutateCalls: unknown[] = [];

// A component instance whose x-data exposes a single editable enum prop, so the
// section renders one Select row and our mocked Select can fire a value change.
const detailsData = {
  name: "Button",
  sourceType: "inline",
  observedProps: [{ name: "variant", value: "solid" }],
  persistedVariants: { variant: ["solid", "outline"] },
  sourceLocation: null,
  instance: { alpineData: "{ variant: 'solid' }", nodeId: "node_1" },
  capabilities: {
    canResolveToFile: false,
    hasFullIndex: false,
    canEditProps: true,
    ctaRequired: false,
  },
};

vi.mock("@agent-native/core/client", () => ({
  useActionQuery: (name: string, params: unknown) => {
    queryCalls.push({ name, params });
    return { data: detailsData, isLoading: false, error: null };
  },
  useActionMutation: () => ({
    mutate: (args: unknown) => {
      mutateCalls.push(args);
    },
  }),
  useT: () => (key: string) => key,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
}));

// Fire `onValueChange` during render so the commit path runs without events.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    onValueChange,
  }: {
    onValueChange?: (v: string) => void;
    children?: unknown;
  }) => {
    onValueChange?.("outline");
    return null;
  },
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

// Stub the remaining UI primitives the section renders to trivial passthroughs
// so it renders to static markup without Radix providers / `cn` styling helpers
// in this lightweight (no-jsdom) test env. The hook arguments — what we assert
// on — are unaffected by these stubs.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children?: unknown }) => children as never,
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children?: unknown }) => children as never,
}));
vi.mock("@/components/ui/input", () => ({ Input: () => null }));
vi.mock("@/components/ui/switch", () => ({ Switch: () => null }));

import { ComponentSection } from "./EditPanel";

describe("ComponentSection — active fileId threading (Bug 2)", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    mutateCalls.length = 0;
  });

  it("threads fileId into the get-component-details read", () => {
    renderToStaticMarkup(
      createElement(ComponentSection, {
        designId: "design_1",
        nodeId: "node_1",
        fileId: "file_about",
      }),
    );

    const read = queryCalls.find((c) => c.name === "get-component-details");
    expect(read).toBeTruthy();
    expect(read!.params).toMatchObject({
      designId: "design_1",
      nodeId: "node_1",
      fileId: "file_about",
    });
  });

  it("threads fileId into the apply-component-prop-edit write (not index.html default)", () => {
    renderToStaticMarkup(
      createElement(ComponentSection, {
        designId: "design_1",
        nodeId: "node_1",
        fileId: "file_about",
      }),
    );

    // The mocked Select fired onValueChange → commitProp → persistPropEdit →
    // applyPropMutation.mutate. That payload must carry the active fileId.
    expect(mutateCalls.length).toBeGreaterThan(0);
    expect(mutateCalls[0]).toMatchObject({
      designId: "design_1",
      nodeId: "node_1",
      fileId: "file_about",
    });
  });

  it("omits fileId when none is active (read falls back to index.html in the action)", () => {
    renderToStaticMarkup(
      createElement(ComponentSection, {
        designId: "design_1",
        nodeId: "node_1",
      }),
    );

    const read = queryCalls.find((c) => c.name === "get-component-details");
    expect(read).toBeTruthy();
    expect((read!.params as { fileId?: string }).fileId).toBeUndefined();
  });
});
