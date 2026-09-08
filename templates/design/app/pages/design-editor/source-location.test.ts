import { describe, expect, it } from "vitest";

import {
  extractSourceFromDebugStack,
  parseReactStackFrame,
} from "./source-location";

describe("parseReactStackFrame", () => {
  it("parses a webpack-internal:/// frame (webpack/Next.js/CRA dev)", () => {
    expect(
      parseReactStackFrame(
        "    at Card (webpack-internal:///./src/components/Card.tsx:15:20)",
      ),
    ).toEqual({
      sourceFile: "src/components/Card.tsx",
      line: 15,
      column: 20,
      functionName: "Card",
    });
  });

  it("parses a Vite dev-server frame served under /src", () => {
    expect(
      parseReactStackFrame(
        "    at Card (http://localhost:8220/src/components/Card.jsx:12:9)",
      ),
    ).toEqual({
      sourceFile: "src/components/Card.jsx",
      line: 12,
      column: 9,
      functionName: "Card",
    });
  });

  it("parses a Vite /@fs/ absolute-path frame and strips a cache-busting query", () => {
    expect(
      parseReactStackFrame(
        "    at App (http://localhost:8220/@fs/Users/dev/app/src/App.jsx?t=1690000000000:9:5)",
      ),
    ).toEqual({
      sourceFile: "/Users/dev/app/src/App.jsx",
      line: 9,
      column: 5,
      functionName: "App",
    });
  });

  it("parses an anonymous frame with no function name", () => {
    expect(
      parseReactStackFrame("    at http://localhost:8220/src/App.jsx:20:11"),
    ).toEqual({
      sourceFile: "src/App.jsx",
      line: 20,
      column: 11,
      functionName: undefined,
    });
  });

  it("parses a file:// frame", () => {
    expect(
      parseReactStackFrame("    at Card (file:///Users/dev/App.jsx:3:1)"),
    ).toEqual({
      sourceFile: "/Users/dev/App.jsx",
      line: 3,
      column: 1,
      functionName: "Card",
    });
  });

  it("rejects node_modules frames", () => {
    expect(
      parseReactStackFrame(
        "    at jsxDEV (http://localhost:8220/node_modules/react/cjs/react-jsx-dev-runtime.development.js:100:20)",
      ),
    ).toBeNull();
  });

  it("rejects build-output frames (dist/.next/_next/static/build/public)", () => {
    for (const url of [
      "webpack-internal:///./dist/App.js:1:1",
      "http://localhost:3000/_next/static/chunks/App.js:1:1",
      "webpack-internal:///./.next/server/App.js:1:1",
    ]) {
      expect(parseReactStackFrame(`    at App (${url})`)).toBeNull();
    }
  });

  it("returns null for a non-frame line", () => {
    expect(parseReactStackFrame("Error: some message")).toBeNull();
  });
});

describe("extractSourceFromDebugStack", () => {
  it("skips leading node_modules frames and returns the first app frame", () => {
    const stack = [
      "Error",
      "    at jsxDEV (http://localhost:8220/node_modules/react/jsx-dev-runtime.js:50:10)",
      "    at Card (http://localhost:8220/src/components/Card.jsx:15:20)",
      "    at App (http://localhost:8220/src/App.jsx:9:5)",
    ].join("\n");
    expect(extractSourceFromDebugStack(stack)).toEqual({
      sourceFile: "src/components/Card.jsx",
      line: 15,
      column: 20,
      functionName: "Card",
    });
  });

  it("returns null when every frame is noise", () => {
    const stack = [
      "Error",
      "    at jsxDEV (http://localhost:8220/node_modules/react/jsx-dev-runtime.js:50:10)",
    ].join("\n");
    expect(extractSourceFromDebugStack(stack)).toBeNull();
  });
});
