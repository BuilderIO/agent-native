import { describe, expect, it } from "vitest";

import {
  inspectCodeDataForElement,
  inspectCodeSourceLocation,
} from "./inspect-code-source";

describe("inspectCodeSourceLocation", () => {
  it("surfaces React 19 element and owner provenance without claiming transformed lines are authored", () => {
    expect(
      inspectCodeSourceLocation({
        sourceFile: "src/components/Card.jsx",
        line: 25,
        column: 32,
        component: "Card",
        method: "debug-stack",
        ownerSourceFile: "src/App.jsx",
        ownerLine: 55,
        ownerColumn: 51,
        ownerComponentName: "Card",
        ownerKey: "b",
        ownerMethod: "debug-stack",
      }),
    ).toEqual({
      filePath: "src/components/Card.jsx",
      line: 25,
      column: 32,
      componentName: "Card",
      method: "debug-stack",
      owner: {
        filePath: "src/App.jsx",
        line: 55,
        column: 51,
        componentName: "Card",
        key: "b",
        method: "debug-stack",
      },
    });
  });

  it("only creates a local-editor target for an absolute source path", () => {
    expect(
      inspectCodeSourceLocation({
        sourceFile: "/Users/dev/app/src/Card.tsx",
        line: 7,
        column: 9,
        method: "debug-source",
      }),
    ).toMatchObject({
      filePath: "/Users/dev/app/src/Card.tsx",
      absolutePath: "/Users/dev/app/src/Card.tsx",
    });
    expect(
      inspectCodeSourceLocation({
        sourceFile: "src/Card.tsx",
        line: 7,
        column: 9,
        method: "debug-source",
      }),
    ).not.toHaveProperty("absolutePath");
  });

  it("does not invent a location when the bridge reported only unavailability", () => {
    expect(
      inspectCodeSourceLocation({ unavailableReason: "no-debug-info" }),
    ).toBeNull();
    expect(inspectCodeSourceLocation(undefined)).toBeNull();
  });

  it("threads a selected React element's provenance into Inspect Code data", () => {
    expect(
      inspectCodeDataForElement(
        {
          tagName: "button",
          id: "buy",
          classes: ["primary"],
          provenance: {
            sourceFile: "src/components/Card.jsx",
            line: 25,
            column: 32,
            component: "Card",
            method: "debug-stack",
          },
        },
        '<button id="buy" class="primary">Buy</button>',
      ),
    ).toMatchObject({
      html: '<button id="buy" class="primary">Buy</button>',
      tagName: "button",
      id: "buy",
      classes: ["primary"],
      sourceLocation: {
        filePath: "src/components/Card.jsx",
        line: 25,
        column: 32,
        componentName: "Card",
        method: "debug-stack",
      },
    });
  });
});
