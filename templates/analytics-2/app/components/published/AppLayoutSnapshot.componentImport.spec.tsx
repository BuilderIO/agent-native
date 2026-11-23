// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import { cellSchema, type Cell } from "@/lib/model/contracts";

import { applyAppPatches, emptyAppLayout } from "../../../shared/app-layout";
import { revisionSchema } from "../../../shared/notebook-snapshot-contract";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: (action: string, params?: { componentId?: string }) => {
    if (action === "list-components" && params?.componentId === "comp-1") {
      return {
        data: {
          component: { id: "comp-1", name: "Revenue Summary", cellCount: 1 },
          cells: [
            {
              id: "inner-1",
              kind: "markdown",
              label: "Headline",
              contents: {
                kind: "markdown",
                markdown: "Published component content",
              },
            },
          ],
        },
        isPending: false,
        error: null,
      };
    }
    return { data: undefined, isPending: false, error: null };
  },
}));

const { AppLayoutSnapshot } = await import("./AppLayoutSnapshot");

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("report QA-1795079397 renders component-import cells in the published app instead of No result", async () => {
  const now = "2026-11-22T00:00:00.000Z";
  const componentCell: Cell = cellSchema.parse({
    id: "cel_comp_1",
    projectId: "prj_1",
    versionId: "ver_1",
    createdAt: now,
    updatedAt: now,
    contents: {
      id: "cel_comp_1",
      kind: "component-import",
      order: "a1",
      label: "Revenue Summary",
      hidden: false,
      gridX: 0,
      gridY: 0,
      gridWidth: 12,
      gridHeight: 4,
      componentVersionId: "comp-1",
      title: "Revenue Summary",
    },
  });
  const layout = applyAppPatches(
    emptyAppLayout(revisionSchema.parse("0")),
    [{ type: "initialize" }],
    [componentCell],
  );

  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        <AppLayoutSnapshot
          cells={[componentCell]}
          outputs={{}}
          layout={layout}
          tabBookmark={null}
          onTabChange={() => {}}
          canViewSource={false}
          values={{}}
        />
      </AgentNativeI18nProvider>,
    ),
  );

  expect(container.textContent).toContain("Published component content");
  expect(container.textContent).not.toContain("No result");
});
