// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { cellSchema, type Cell } from "@/lib/model/contracts";

import { applyAppPatches, emptyAppLayout } from "../../../shared/app-layout";
import { revisionSchema } from "../../../shared/notebook-snapshot-contract";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: (action: string, params?: { componentId?: string }) => {
    if (
      action === "list-components" &&
      params?.componentId === "comp-builder"
    ) {
      return {
        data: {
          component: {
            id: "comp-builder",
            name: "Builder Block",
            cellCount: 1,
          },
          cells: [
            {
              id: "inner-1",
              kind: "markdown",
              label: "Notes",
              contents: {
                kind: "markdown",
                markdown: "Builder component body",
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

const { ProjectAppBuilder } = await import("./ProjectAppBuilder");

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

it("report QA-1795079397 renders component-import cells in the App Builder instead of No result", async () => {
  const now = "2026-11-22T00:00:00.000Z";
  const componentCell: Cell = cellSchema.parse({
    id: "cel_comp_builder",
    projectId: "prj_1",
    versionId: "working",
    createdAt: now,
    updatedAt: now,
    contents: {
      id: "cel_comp_builder",
      kind: "component-import",
      order: "a1",
      label: "Builder Block",
      hidden: false,
      gridX: 0,
      gridY: 0,
      gridWidth: 12,
      gridHeight: 4,
      componentVersionId: "comp-builder",
      title: "Builder Block",
    },
  });
  const layout = applyAppPatches(
    emptyAppLayout(revisionSchema.parse("0")),
    [{ type: "initialize" }],
    [componentCell],
  );

  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <TooltipProvider>
          <ProjectAppBuilder
            cells={[componentCell]}
            outputs={{}}
            layout={layout}
            canEdit={false}
            onChangeLayout={async () => layout}
          />
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    ),
  );

  expect(container.textContent).toContain("Builder component body");
  expect(container.textContent).not.toContain("No result");
});
