/**
 * Tests for the full-app shared helpers: designs.data parsing and the
 * fusionApp linkage read/write round-trip.
 */

import { describe, expect, it } from "vitest";

import {
  parseDesignDataBlob,
  readFusionApp,
  writeFusionApp,
  type DesignFusionApp,
} from "./full-app.js";

const app: DesignFusionApp = {
  projectId: "proj_1",
  branchName: "sunny-meadow",
  editorUrl: "https://builder.io/app/projects/proj_1/sunny-meadow",
  previewUrl: "https://proj-1-sunny-meadow.builderio.xyz",
  status: "ready",
  createdAt: "2026-07-03T00:00:00.000Z",
  updatedAt: "2026-07-03T00:00:00.000Z",
};

describe("parseDesignDataBlob", () => {
  it("parses a JSON string", () => {
    expect(parseDesignDataBlob('{"a":1}')).toEqual({ a: 1 });
  });

  it("passes through an object", () => {
    expect(parseDesignDataBlob({ a: 1 })).toEqual({ a: 1 });
  });

  it("returns {} for invalid JSON, arrays, and empty values", () => {
    expect(parseDesignDataBlob("not json")).toEqual({});
    expect(parseDesignDataBlob("[1,2]")).toEqual({});
    expect(parseDesignDataBlob(null)).toEqual({});
    expect(parseDesignDataBlob("")).toEqual({});
  });
});

describe("readFusionApp / writeFusionApp", () => {
  it("round-trips through a design data blob", () => {
    const data = writeFusionApp('{"canvasFrames":{"f1":{"x":10}}}', app);
    expect(data.sourceType).toBe("fusion");
    expect(data.sourceMode).toBe("fusion");
    expect(data.canvasFrames).toEqual({ f1: { x: 10 } });

    const read = readFusionApp(JSON.stringify(data));
    expect(read).toEqual(app);
  });

  it("returns null when there is no linkage or ids are missing", () => {
    expect(readFusionApp("{}")).toBeNull();
    expect(readFusionApp('{"fusionApp":{"projectId":"p"}}')).toBeNull();
    expect(readFusionApp('{"fusionApp":{"branchName":"b"}}')).toBeNull();
    expect(readFusionApp(undefined)).toBeNull();
  });

  it("defaults unknown status to building and drops blank optionals", () => {
    const read = readFusionApp({
      fusionApp: {
        projectId: "p",
        branchName: "b",
        status: "bogus",
        previewUrl: "",
      },
    });
    expect(read?.status).toBe("building");
    expect(read?.previewUrl).toBeUndefined();
  });

  it("preserves unrelated keys when writing", () => {
    const data = writeFusionApp(
      { screenMetadata: { s1: { sourceType: "inline" } }, tweaks: [1] },
      app,
    );
    expect(data.screenMetadata).toEqual({ s1: { sourceType: "inline" } });
    expect(data.tweaks).toEqual([1]);
    expect((data.fusionApp as DesignFusionApp).branchName).toBe("sunny-meadow");
  });
});
