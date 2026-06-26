import { describe, expect, it } from "vitest";

import type { PlanContent } from "../../shared/plan-content.js";
import { assertRecapWireframesHaveContent } from "./visual-recap-validation.js";

function content(blocks: PlanContent["blocks"]): PlanContent {
  return { version: 2, blocks };
}

describe("assertRecapWireframesHaveContent", () => {
  it("rejects empty wireframes inside before/after columns", () => {
    expect(() =>
      assertRecapWireframesHaveContent(
        content([
          {
            id: "ui-comparison",
            type: "columns",
            data: {
              columns: [
                {
                  id: "before",
                  label: "Before",
                  blocks: [
                    {
                      id: "empty-before",
                      type: "wireframe",
                      data: { surface: "browser", screen: [] },
                    },
                  ],
                },
                {
                  id: "after",
                  label: "After",
                  blocks: [
                    {
                      id: "filled-after",
                      type: "wireframe",
                      data: {
                        surface: "browser",
                        html: "<div><h1>Resources</h1><button>Save</button></div>",
                      },
                    },
                  ],
                },
              ],
            },
          },
        ]),
      ),
    ).toThrow(/empty wireframes[\s\S]*empty-before/i);
  });

  it("rejects HTML wireframes with only empty containers", () => {
    expect(() =>
      assertRecapWireframesHaveContent(
        content([
          {
            id: "blank-html",
            type: "wireframe",
            data: {
              surface: "browser",
              html: '<div class="wf-card"><div></div></div>',
            },
          },
        ]),
      ),
    ).toThrow(/HTML mockup has no visible text/i);
  });

  it("accepts meaningful text from kit tree nodes", () => {
    expect(() =>
      assertRecapWireframesHaveContent(
        content([
          {
            id: "kit-screen",
            type: "wireframe",
            data: {
              surface: "browser",
              screen: [
                {
                  el: "screen",
                  children: [
                    { el: "title", text: "Workspace resources" },
                    { el: "btn", text: "Save" },
                  ],
                },
              ],
            },
          },
        ]),
      ),
    ).not.toThrow();
  });

  it("rejects kit-tree canvas artboards so recaps use HTML screens on canvas", () => {
    expect(() =>
      assertRecapWireframesHaveContent({
        version: 2,
        blocks: [],
        canvas: {
          title: "Flow",
          frames: [
            {
              id: "canvas-kit",
              label: "Canvas kit",
              wireframe: {
                surface: "browser",
                screen: [
                  {
                    el: "screen",
                    children: [
                      { el: "title", text: "Connect storage" },
                      { el: "btn", label: "Connect Builder.io" },
                    ],
                  },
                ],
              },
            },
          ],
        },
      }),
    ).toThrow(/legacy kit-tree Screen children/i);
  });
});
