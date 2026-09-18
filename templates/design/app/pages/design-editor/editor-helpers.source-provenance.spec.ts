import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runtimeMultiplicityForElementProvenance } from "./editor-helpers";

describe("runtime provenance multiplicity", () => {
  it("counts only nodes at the selected element's own source site", () => {
    const snapshots = {
      "screen-1": {
        html: `<!doctype html><html><body>
          <h1 data-source-file="src/AuthPage.tsx" data-source-line="12" data-source-column="7" data-component-name="AuthPage">A</h1>
          <h1 data-source-file="src/AuthPage.tsx" data-source-line="12" data-source-column="7" data-component-name="AuthPage">B</h1>
          <section data-source-file="src/MarketingHome.tsx" data-source-line="163" data-source-column="41" data-component-name="MarketingHome"><h1>Ancestor site</h1></section>
        </body></html>`,
        nodeCount: 4,
      },
    };

    expect(
      runtimeMultiplicityForElementProvenance(snapshots, {
        provenance: {
          sourceFile: "src/AuthPage.tsx",
          line: 12,
          column: 7,
          component: "AuthPage",
        },
      } as ElementInfo),
    ).toBe(2);
    expect(
      runtimeMultiplicityForElementProvenance(snapshots, {
        provenance: {
          sourceFile: "src/MarketingHome.tsx",
          line: 163,
          column: 41,
          component: "MarketingHome",
        },
      } as ElementInfo),
    ).toBe(1);
  });

  it("counts runtime component invocation sites instead of definition hosts", () => {
    const snapshots = {
      "screen-1": {
        html: `<!doctype html><html><body>
          <div data-agent-native-node-id="one" data-source-file="src/Component.jsx" data-source-line="8" data-source-column="5" data-component-name="PrimaryButton" data-source-owner-file="src/App.jsx" data-source-owner-line="20" data-source-owner-column="7" data-agent-native-runtime-component-id="runtime-component-one">
            <button data-agent-native-node-id="two" data-source-file="src/Component.jsx" data-source-line="8" data-source-column="5" data-component-name="PrimaryButton" data-source-owner-file="src/App.jsx" data-source-owner-line="20" data-source-owner-column="7" data-agent-native-runtime-component-id="runtime-component-one">A<span data-source-file="src/Component.jsx" data-source-line="8" data-source-column="5" data-component-name="PrimaryButton" data-source-owner-file="src/App.jsx" data-source-owner-line="20" data-source-owner-column="7" data-agent-native-runtime-component-id="runtime-component-one">nested</span></button>
          </div>
          <button data-agent-native-node-id="two" data-source-file="src/Component.jsx" data-source-line="8" data-source-column="5" data-component-name="PrimaryButton" data-source-owner-file="src/App.jsx" data-source-owner-line="35" data-source-owner-column="7" data-agent-native-runtime-component-id="runtime-component-one">B</button>
        </body></html>`,
        nodeCount: 4,
      },
    };

    expect(
      runtimeMultiplicityForElementProvenance(snapshots, {
        tagName: "button",
        classes: [],
        computedStyles: {},
        boundingRect: { x: 0, y: 0, width: 0, height: 0 },
        isFlexChild: false,
        isFlexContainer: false,
        provenance: {
          sourceFile: "src/Component.jsx",
          line: 8,
          column: 5,
          component: "PrimaryButton",
        },
        runtimeComponent: {
          componentId: "runtime-component-one",
          instanceId: "one",
          name: "PrimaryButton",
          framework: "react",
          sourceFile: "src/App.jsx",
          line: 20,
          column: 7,
          method: "debug-source",
          props: [],
          writeCapability: "authored-jsx-literal",
        },
      } as ElementInfo),
    ).toBe(1);
  });

  it("keeps keyed map instances distinct while deduplicating their descendants", () => {
    const snapshots = {
      "screen-1": {
        html: `<!doctype html><html><body>
          <button data-source-file="src/Component.jsx" data-source-line="8" data-source-column="5" data-component-name="PrimaryButton" data-source-owner-file="src/App.jsx" data-source-owner-line="20" data-source-owner-column="7" data-source-owner-key="a" data-agent-native-runtime-component-id="runtime-component-one">A<span data-source-file="src/Component.jsx" data-source-line="8" data-source-column="5" data-component-name="PrimaryButton" data-source-owner-file="src/App.jsx" data-source-owner-line="20" data-source-owner-column="7" data-source-owner-key="a" data-agent-native-runtime-component-id="runtime-component-one">nested</span></button>
          <button data-source-file="src/Component.jsx" data-source-line="8" data-source-column="5" data-component-name="PrimaryButton" data-source-owner-file="src/App.jsx" data-source-owner-line="20" data-source-owner-column="7" data-source-owner-key="b" data-agent-native-runtime-component-id="runtime-component-one">B</button>
        </body></html>`,
        nodeCount: 3,
      },
    };

    expect(
      runtimeMultiplicityForElementProvenance(snapshots, {
        tagName: "button",
        classes: [],
        computedStyles: {},
        boundingRect: { x: 0, y: 0, width: 0, height: 0 },
        isFlexChild: false,
        isFlexContainer: false,
        provenance: {
          sourceFile: "src/Component.jsx",
          line: 8,
          column: 5,
          component: "PrimaryButton",
        },
        runtimeComponent: {
          componentId: "runtime-component-one",
          instanceId: "one",
          name: "PrimaryButton",
          framework: "react",
          sourceFile: "src/App.jsx",
          line: 20,
          column: 7,
          ownerKey: "a",
          method: "debug-source",
          props: [],
          writeCapability: "authored-jsx-literal",
        },
      } as ElementInfo),
    ).toBe(2);
  });
});
