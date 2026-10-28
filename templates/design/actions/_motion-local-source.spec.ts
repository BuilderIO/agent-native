import { describe, expect, it } from "vitest";

import {
  isBridgeSha256VersionHash,
  MotionLocalSourceError,
  resolveMotionLocalSourceLocation,
} from "./_motion-local-source.js";

const designData = {
  sourceType: "localhost",
  connectionId: "connection-1",
  screenMetadata: {
    "screen-1": {
      sourceType: "localhost",
      connectionId: "connection-1",
      sourceFile: "app/routes/home.tsx",
      path: "/home",
      url: "http://localhost:5173/home",
    },
  },
  localhostScreens: {
    "screen-1": {
      sourceType: "localhost",
      connectionId: "connection-1",
      sourceFile: "app/routes/home.tsx",
    },
  },
};

describe("resolveMotionLocalSourceLocation", () => {
  it("distinguishes invalid JSON from malformed metadata", () => {
    expect(() =>
      resolveMotionLocalSourceLocation({
        designData: "{",
        screenId: "screen-1",
      }),
    ).toThrow(/invalid JSON/);

    expect(() =>
      resolveMotionLocalSourceLocation({
        designData: "null",
        screenId: "screen-1",
      }),
    ).toThrow(/malformed/);
  });

  it("uses the authored sourceFile, never the route path or URL", () => {
    expect(
      resolveMotionLocalSourceLocation({
        designData,
        screenId: "screen-1",
      }),
    ).toEqual({
      screenId: "screen-1",
      connectionId: "connection-1",
      filePath: "app/routes/home.tsx",
    });
  });

  it("requires a unique bridge mapping while allowing an imported JSX module", () => {
    expect(() =>
      resolveMotionLocalSourceLocation({
        designData: {
          ...designData,
          localhostScreens: {
            "screen-1": {
              ...designData.localhostScreens["screen-1"],
              sourceFile: "app/routes/other.tsx",
            },
          },
        },
        screenId: "screen-1",
      }),
    ).toThrow(MotionLocalSourceError);

    expect(
      resolveMotionLocalSourceLocation({
        designData,
        screenId: "screen-1",
        declaration: {
          connectionId: "connection-1",
          filePath: "app/components/Card.tsx",
        },
      }).filePath,
    ).toBe("app/components/Card.tsx");

    expect(() =>
      resolveMotionLocalSourceLocation({
        designData,
        screenId: "screen-1",
        declaration: {
          connectionId: "another-connection",
          filePath: "app/components/Card.tsx",
        },
      }),
    ).toThrow(/bridge connection/);

    expect(() =>
      resolveMotionLocalSourceLocation({
        designData,
        screenId: "screen-1",
        declaration: {
          filePath: "../outside.tsx",
        },
      }),
    ).toThrow(/project-relative/);
  });

  it("resolves a linked HTML entrypoint and rejects unsupported source files", () => {
    const htmlDesignData = {
      ...designData,
      screenMetadata: {
        "screen-1": {
          sourceType: "localhost",
          connectionId: "connection-1",
          sourceFile: "pages/home.html",
        },
      },
      localhostScreens: {},
    };
    expect(
      resolveMotionLocalSourceLocation({
        designData: htmlDesignData,
        screenId: "screen-1",
      }),
    ).toEqual({
      screenId: "screen-1",
      connectionId: "connection-1",
      filePath: "pages/home.html",
    });

    expect(() =>
      resolveMotionLocalSourceLocation({
        designData: htmlDesignData,
        screenId: "screen-1",
        declaration: { filePath: "pages/site.css" },
      }),
    ).toThrow(/project-relative/);

    expect(() =>
      resolveMotionLocalSourceLocation({
        designData: htmlDesignData,
        screenId: "screen-1",
        declaration: { filePath: "pages/site.js" },
      }),
    ).toThrow(/project-relative/);

    expect(() =>
      resolveMotionLocalSourceLocation({ designData, screenId: "missing" }),
    ).toThrow(/No localhost source metadata/);
  });
});

describe("isBridgeSha256VersionHash", () => {
  it("accepts bridge SHA-256 values and rejects helper hashes", () => {
    expect(isBridgeSha256VersionHash("a".repeat(64))).toBe(true);
    expect(isBridgeSha256VersionHash("9k31m5")).toBe(false);
    expect(isBridgeSha256VersionHash(undefined)).toBe(false);
  });
});
