import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

/**
 * Exercises the REAL `frameworkDebugProvenance` shipped inside
 * `editor-chrome.bridge.ts`, pulled out of the compiled bridge string the same
 * way editor-chrome-bridge.snap.test.ts isolates the snap math — the function
 * only reads `Object.keys(el)` and the fiber graph, so a plain object stands in
 * for a DOM element and no browser is needed.
 *
 * Fixtures below are the shapes React actually produces:
 *   • React <=18 — `_debugSource` with authored file/line/column.
 *   • React 19 — `_debugStack` owner stacks (Vite `/@fs/` + plain dev-server
 *     URLs, and webpack-internal:/// for Next.js/CRA).
 * The Vite fixtures are copied from a live React 19 + Vite dev server (a <Card>
 * authored directly plus three from ITEMS.map()).
 */

interface FrameworkDebugProvenance {
  framework?: "html" | "react" | "vue" | "svelte" | "angular" | "lwc";
  sourceFile?: string;
  line?: number;
  column?: number;
  component?: string;
  ownerSourceFile?: string;
  ownerLine?: number;
  ownerColumn?: number;
  ownerComponentName?: string;
  ownerKey?: string;
  method?:
    | "data-attribute"
    | "debug-source"
    | "debug-stack"
    | "vue-inspector"
    | "svelte-meta";
  ownerMethod?: "debug-source" | "debug-stack";
  unavailableReason?: "not-framework" | "no-debug-info";
}

function loadProvenanceFunctions(): {
  frameworkDebugProvenance: (el: object) => FrameworkDebugProvenance;
  elementDebugProvenance: (el: object) => FrameworkDebugProvenance;
} {
  const source = editorChromeBridgeScript;
  const start = source.indexOf("var PROVENANCE_NOISE_SEGMENTS");
  const fnStart = source.indexOf("function elementDebugProvenance(", start);
  if (start === -1 || fnStart === -1) {
    throw new Error(
      "provenance block not found in compiled editor-chrome bridge",
    );
  }
  let depth = 0;
  let end = -1;
  for (
    let index = source.indexOf("{", fnStart);
    index < source.length;
    index += 1
  ) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error("unbalanced frameworkDebugProvenance body");
  return new Function(
    `${source.slice(start, end)}; return { frameworkDebugProvenance, elementDebugProvenance };`,
  )() as {
    frameworkDebugProvenance: (el: object) => FrameworkDebugProvenance;
    elementDebugProvenance: (el: object) => FrameworkDebugProvenance;
  };
}

const { frameworkDebugProvenance, elementDebugProvenance } =
  loadProvenanceFunctions();

function Card() {}

function elementWithFiber(fiber: unknown): object {
  return { __reactFiber$abc123: fiber };
}

function viteStack(frame: string): { stack: string } {
  return {
    stack: [
      "Error: react-stack-top-frame",
      "    at exports.jsxDEV (http://localhost:8220/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=cd0a49d9:193:83)",
      frame,
      "    at renderWithHooks (http://localhost:8220/node_modules/.vite/deps/react-dom_client.js?v=712ea63d:4213:19)",
    ].join("\n"),
  };
}

/** Host fiber for a <button> inside Card, rendered by a <Card> in App.jsx. */
function mappedCardButton(key: string | null) {
  const cardFiber = {
    type: Card,
    key,
    _debugStack: viteStack(
      key === null
        ? "    at App (http://localhost:8220/src/App.jsx:44:20)"
        : "    at http://localhost:8220/src/App.jsx:55:51",
    ),
    return: null,
  };
  return elementWithFiber({
    type: "button",
    key: null,
    _debugStack: viteStack(
      "    at Card (http://localhost:8220/src/components/Card.jsx:25:32)",
    ),
    return: cardFiber,
  });
}

describe("editor-chrome bridge — frameworkDebugProvenance", () => {
  it("reads React <=18 structured _debugSource, which the React 19 stack path cannot see", () => {
    const cardFiber = {
      type: Card,
      key: "b",
      _debugSource: {
        fileName: "src/App.jsx",
        lineNumber: 17,
        columnNumber: 7,
      },
      return: null,
    };
    const provenance = frameworkDebugProvenance(
      elementWithFiber({
        type: "button",
        key: null,
        _debugSource: {
          fileName: "src/components/Card.jsx",
          lineNumber: 7,
          columnNumber: 9,
        },
        return: cardFiber,
      }),
    );

    expect(provenance).toMatchObject({
      sourceFile: "src/components/Card.jsx",
      line: 7,
      column: 9,
      component: "Card",
      ownerSourceFile: "src/App.jsx",
      ownerLine: 17,
      ownerColumn: 7,
      ownerComponentName: "Card",
      ownerKey: "b",
    });
  });

  it("resolves webpack-internal:/// frames from Next.js/CRA dev servers", () => {
    const provenance = frameworkDebugProvenance(
      elementWithFiber({
        type: "button",
        key: null,
        _debugStack: {
          stack: [
            "Error: react-stack-top-frame",
            "    at exports.jsxDEV (webpack-internal:///./node_modules/react/jsx-dev-runtime.js:20:1)",
            "    at Card (webpack-internal:///./src/components/Card.tsx:7:9)",
          ].join("\n"),
        },
        return: null,
      }),
    );

    expect(provenance).toMatchObject({
      sourceFile: "src/components/Card.tsx",
      line: 7,
      column: 9,
      component: "Card",
    });
  });

  it("resolves Vite /@fs/ absolute-path frames", () => {
    const provenance = frameworkDebugProvenance(
      elementWithFiber({
        type: "button",
        key: null,
        _debugStack: viteStack(
          "    at Card (http://localhost:5173/@fs/Users/dev/app/src/Card.jsx?t=1730:25:32)",
        ),
        return: null,
      }),
    );

    expect(provenance).toMatchObject({
      sourceFile: "/Users/dev/app/src/Card.jsx",
      line: 25,
      column: 32,
    });
  });

  it("separates a directly-authored instance from .map() siblings by owner line and ownerKey", () => {
    const direct = frameworkDebugProvenance(mappedCardButton(null));
    const mapped = ["a", "b", "c"].map((key) =>
      frameworkDebugProvenance(mappedCardButton(key)),
    );

    // Own location is the button's line in Card.jsx for every instance.
    for (const provenance of [direct, ...mapped]) {
      expect(provenance.sourceFile).toBe("src/components/Card.jsx");
      expect(provenance.line).toBe(25);
    }
    expect(direct.ownerLine).toBe(44);
    expect(direct.ownerKey).toBeUndefined();
    expect(mapped.map((provenance) => provenance.ownerLine)).toEqual([
      55, 55, 55,
    ]);
    expect(mapped.map((provenance) => provenance.ownerKey)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("labels which tier produced the position, so a React 19 stack line is not read as authored", () => {
    const structured = frameworkDebugProvenance(
      elementWithFiber({
        type: "button",
        key: null,
        _debugSource: {
          fileName: "src/components/Card.jsx",
          lineNumber: 7,
          columnNumber: 9,
        },
        return: null,
      }),
    );
    expect(structured.method).toBe("debug-source");

    // The React 19 case: the line is Vite's transformed output, not line 7.
    const fromStack = frameworkDebugProvenance(
      elementWithFiber({
        type: "button",
        key: null,
        _debugStack: viteStack(
          "    at Card (http://localhost:8220/src/components/Card.jsx:25:32)",
        ),
        return: null,
      }),
    );
    expect(fromStack.method).toBe("debug-stack");

    // The owner site is labelled separately: the two tiers can differ on one
    // element, so a single `method` would misreport one of them.
    const mapped = frameworkDebugProvenance(mappedCardButton("b"));
    expect(mapped.ownerMethod).toBe("debug-stack");
    expect(
      frameworkDebugProvenance(
        elementWithFiber({
          type: "button",
          key: null,
          _debugStack: viteStack(
            "    at Card (http://localhost:8220/src/components/Card.jsx:25:32)",
          ),
          return: {
            type: Card,
            key: "b",
            _debugSource: {
              fileName: "src/App.jsx",
              lineNumber: 55,
              columnNumber: 51,
            },
            return: null,
          },
        }),
      ),
    ).toMatchObject({ method: "debug-stack", ownerMethod: "debug-source" });
  });

  it("reports why a location is missing instead of returning nothing", () => {
    expect(frameworkDebugProvenance({ id: "plain-dom-node" })).toEqual({
      unavailableReason: "not-framework",
    });
    expect(
      frameworkDebugProvenance(
        elementWithFiber({ type: "button", key: null, return: null }),
      ),
    ).toEqual({ framework: "react", unavailableReason: "no-debug-info" });
  });

  it("reads Vue compiler inspector locations from the selected vnode", () => {
    const provenance = frameworkDebugProvenance({
      __vnode: {
        type: { __name: "SettingsCard" },
        props: { __v_inspector: "src/components/SettingsCard.vue:12:7" },
      },
      parentElement: null,
    });

    expect(provenance).toEqual({
      framework: "vue",
      sourceFile: "src/components/SettingsCard.vue",
      line: 12,
      column: 7,
      component: "SettingsCard",
      method: "vue-inspector",
    });
  });

  it("walks to the closest Vue compiler-tracked ancestor", () => {
    const provenance = frameworkDebugProvenance({
      parentElement: {
        __vnode: {
          props: { __v_inspector: "C:/app/src/App.vue:24:5" },
        },
        parentElement: null,
      },
    });

    expect(provenance).toMatchObject({
      framework: "vue",
      sourceFile: "C:/app/src/App.vue",
      line: 24,
      column: 5,
      method: "vue-inspector",
    });
  });

  it("walks from a Vue shadow child through ShadowRoot.host", () => {
    const host = {
      __vnode: {
        type: { __name: "SettingsCard" },
        props: { __v_inspector: "src/components/SettingsCard.vue:18:4" },
      },
      parentElement: null,
    };
    const provenance = frameworkDebugProvenance({
      parentElement: null,
      getRootNode: () => ({ host, mode: "open" }),
    });

    expect(provenance).toEqual({
      framework: "vue",
      sourceFile: "src/components/SettingsCard.vue",
      line: 18,
      column: 4,
      component: "SettingsCard",
      method: "vue-inspector",
    });
  });

  it("reads Svelte compiler metadata and keeps it authored", () => {
    const provenance = frameworkDebugProvenance({
      __svelte_meta: {
        loc: { file: "src/routes/+page.svelte", line: 9, column: 3 },
        component: "Page",
      },
      parentElement: null,
    });

    expect(provenance).toEqual({
      framework: "svelte",
      sourceFile: "src/routes/+page.svelte",
      line: 9,
      column: 3,
      component: "Page",
      method: "svelte-meta",
    });
  });

  it("walks from a Svelte shadow child through ShadowRoot.host", () => {
    const host = {
      __svelte_meta: {
        loc: { filename: "src/lib/Toolbar.svelte", line: 14, column: 8 },
        name: "Toolbar",
      },
      parentElement: null,
    };
    const provenance = frameworkDebugProvenance({
      parentElement: null,
      getRootNode: () => ({ host, mode: "closed" }),
    });

    expect(provenance).toEqual({
      framework: "svelte",
      sourceFile: "src/lib/Toolbar.svelte",
      line: 14,
      column: 8,
      component: "Toolbar",
      method: "svelte-meta",
    });
  });

  it("walks through ShadowRoot.host for explicit data-source provenance", () => {
    const attrs = new Map([
      ["data-source-file", "src/components/checkout-button.ts"],
      ["data-source-line", "22"],
      ["data-source-column", "6"],
      ["data-component-name", "CheckoutButton"],
      ["data-source-framework", "html"],
    ]);
    const host = {
      parentElement: null,
      getAttribute: (name: string) => attrs.get(name) ?? null,
    };
    const provenance = elementDebugProvenance({
      parentElement: null,
      getRootNode: () => ({ host, mode: "open" }),
    });

    expect(provenance).toEqual({
      framework: "html",
      sourceFile: "src/components/checkout-button.ts",
      line: 22,
      column: 6,
      component: "CheckoutButton",
      method: "data-attribute",
    });
  });

  it("identifies Angular and LWC runtime markers without fabricating source coordinates", () => {
    const angular = frameworkDebugProvenance({
      parentElement: null,
      tagName: "APP-ROOT",
      attributes: [{ name: "_nghost-ng-c120" }],
      hasAttribute: (name: string) => name === "ng-version",
      getAttribute: () => null,
    });
    expect(angular).toEqual({
      framework: "angular",
      unavailableReason: "no-debug-info",
    });
    expect(angular.sourceFile).toBeUndefined();
    expect(angular.line).toBeUndefined();

    const lwcHost = {
      parentElement: null,
      tagName: "LIGHTNING-BUTTON",
      attributes: [{ name: "lwc-66unc5l95ad-host" }],
      hasAttribute: () => false,
      getAttribute: () => null,
    };
    const lwc = frameworkDebugProvenance({
      parentElement: null,
      getRootNode: () => ({ host: lwcHost, mode: "open" }),
    });
    expect(lwc).toEqual({
      framework: "lwc",
      unavailableReason: "no-debug-info",
    });
    expect(lwc.sourceFile).toBeUndefined();
    expect(lwc.line).toBeUndefined();
  });
});
