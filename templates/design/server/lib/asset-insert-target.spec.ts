import { ActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: state.read,
}));

import {
  pickAssetInsertFile,
  resolveAssetInsertTarget,
} from "./asset-insert-target.js";

interface DesignFile {
  id: string;
  fileType: string | null;
  filename: string | null;
}

const cssFile: DesignFile = {
  id: "file-css",
  fileType: "css",
  filename: "styles.css",
};
const htmlA: DesignFile = {
  id: "file-a",
  fileType: "html",
  filename: "index.html",
};
const htmlB: DesignFile = {
  id: "file-b",
  fileType: "html",
  filename: "details.html",
};

function givenState(values: Record<string, unknown>) {
  state.read.mockImplementation(async (key: string) => {
    const value = values[key] ?? null;
    if (value instanceof Error) throw value;
    return value;
  });
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("resolveAssetInsertTarget and pickAssetInsertFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    givenState({});
  });

  it("treats readable empty state as no screen open and picks the first HTML screen", async () => {
    givenState({ navigation: null, "design-selection": null });

    const target = await resolveAssetInsertTarget({ fileIds: [] });

    expect(target.stateUnreadable).toBe(false);
    expect(target.designId).toBeUndefined();
    expect(pickAssetInsertFile([cssFile, htmlA, htmlB], target)).toBe(htmlA);
  });

  it("refuses when navigation cannot be read and no designId can be found", async () => {
    givenState({ navigation: new Error("db down") });

    const error = await resolveAssetInsertTarget({ fileIds: [] }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ActionContractError);
    expect(error).toMatchObject({
      errorCode: "asset_target_state_unreadable",
      statusCode: 503,
    });
  });

  it("lets an explicit fileId through when navigation cannot be read", async () => {
    givenState({ navigation: new Error("db down") });

    const target = await resolveAssetInsertTarget({
      designId: "design-1",
      fileIds: ["file-b"],
    });

    expect(target.stateUnreadable).toBe(true);
    expect(pickAssetInsertFile([cssFile, htmlA, htmlB], target)).toBe(htmlB);
  });

  it("refuses to guess among several screens when state cannot be read and no fileId is given", async () => {
    givenState({ navigation: new Error("db down") });

    const target = await resolveAssetInsertTarget({
      designId: "design-1",
      fileIds: [],
    });

    expect(
      thrownBy(() => pickAssetInsertFile([cssFile, htmlA, htmlB], target)),
    ).toMatchObject({
      errorCode: "asset_target_state_unreadable",
      statusCode: 503,
    });
  });

  it("uses the only HTML screen when state cannot be read and the design has exactly one", async () => {
    givenState({ navigation: new Error("db down") });

    const target = await resolveAssetInsertTarget({
      designId: "design-1",
      fileIds: [],
    });

    expect(pickAssetInsertFile([cssFile, htmlA], target)).toBe(htmlA);
  });

  it("refuses an explicit fileId that is not in the design", async () => {
    const target = await resolveAssetInsertTarget({
      designId: "design-1",
      fileIds: ["missing-file"],
    });

    expect(
      thrownBy(() => pickAssetInsertFile([cssFile, htmlA], target)),
    ).toMatchObject({
      errorCode: "asset_target_screen_invalid",
      statusCode: 404,
    });
  });

  it("refuses an empty explicit screen id instead of treating it as omitted", async () => {
    givenState({
      navigation: { designId: "design-1", activeFileId: "file-b" },
    });
    const target = await resolveAssetInsertTarget({
      designId: "design-1",
      fileIds: [""],
    });

    expect(
      thrownBy(() => pickAssetInsertFile([cssFile, htmlA, htmlB], target)),
    ).toMatchObject({
      errorCode: "asset_target_screen_invalid",
      statusCode: 400,
    });
  });

  it("refuses when the native screenId is empty even if fileId is valid", async () => {
    const target = await resolveAssetInsertTarget({
      designId: "design-1",
      fileIds: ["", htmlB.id],
    });

    expect(
      thrownBy(() => pickAssetInsertFile([cssFile, htmlA, htmlB], target)),
    ).toMatchObject({ errorCode: "asset_target_screen_invalid" });
  });

  it("refuses an explicit fileId that names a non-HTML file", async () => {
    const target = await resolveAssetInsertTarget({
      designId: "design-1",
      fileIds: [cssFile.id],
    });

    expect(
      thrownBy(() => pickAssetInsertFile([cssFile, htmlA], target)),
    ).toMatchObject({
      errorCode: "asset_target_screen_invalid",
      statusCode: 404,
    });
  });

  it("returns the first explicit id that is an HTML screen", async () => {
    const target = await resolveAssetInsertTarget({
      designId: "design-1",
      fileIds: ["missing-screen", htmlB.id],
    });

    expect(pickAssetInsertFile([htmlA, htmlB], target)).toBe(htmlB);
  });

  it("uses the navigation activeFileId when navigation is for the resolved design", async () => {
    givenState({
      navigation: { designId: "design-1", activeFileId: htmlB.id },
    });

    const target = await resolveAssetInsertTarget({ fileIds: [] });

    expect(pickAssetInsertFile([cssFile, htmlA, htmlB], target)).toBe(htmlB);
  });

  it("ignores navigation activeFileId when navigation is for another design", async () => {
    givenState({
      navigation: { designId: "design-2", activeFileId: htmlB.id },
    });

    const target = await resolveAssetInsertTarget({
      designId: "design-1",
      fileIds: [],
    });

    expect(pickAssetInsertFile([cssFile, htmlA, htmlB], target)).toBe(htmlA);
  });

  it("falls back to the first HTML screen when the readable active file id is stale", async () => {
    givenState({
      navigation: { designId: "design-1", activeFileId: "file-gone" },
    });

    const target = await resolveAssetInsertTarget({ fileIds: [] });

    expect(pickAssetInsertFile([cssFile, htmlA, htmlB], target)).toBe(htmlA);
  });

  it("falls back to the first HTML screen when the active file id is not HTML", async () => {
    givenState({
      navigation: { designId: "design-1", activeFileId: cssFile.id },
    });

    const target = await resolveAssetInsertTarget({ fileIds: [] });

    expect(pickAssetInsertFile([cssFile, htmlA, htmlB], target)).toBe(htmlA);
  });

  it("uses the selection designId and activeFileId when the owner matches", async () => {
    givenState({
      "design-selection": {
        ownerId: "owner-1",
        designId: "design-1",
        activeFileId: htmlB.id,
      },
    });

    const target = await resolveAssetInsertTarget({
      ownerId: "owner-1",
      fileIds: [],
    });

    expect(target.designId).toBe("design-1");
    expect(pickAssetInsertFile([cssFile, htmlA, htmlB], target)).toBe(htmlB);
  });

  it("ignores the selection when the owner does not match", async () => {
    givenState({
      "design-selection": {
        ownerId: "owner-1",
        designId: "design-2",
        activeFileId: htmlB.id,
      },
    });

    const target = await resolveAssetInsertTarget({
      ownerId: "owner-2",
      fileIds: [],
    });

    expect(target.designId).toBeUndefined();
    expect(pickAssetInsertFile([cssFile, htmlA, htmlB], target)).toBe(htmlA);
  });

  it("does not use the selection activeFileId for a different resolved design", async () => {
    givenState({
      "design-selection": {
        ownerId: "owner-1",
        designId: "design-1",
        activeFileId: htmlB.id,
      },
    });

    const target = await resolveAssetInsertTarget({
      designId: "design-2",
      ownerId: "owner-1",
      fileIds: [],
    });

    expect(pickAssetInsertFile([cssFile, htmlA, htmlB], target)).toBe(htmlA);
  });

  it("returns null when the design has no HTML file and state is readable", async () => {
    const target = await resolveAssetInsertTarget({
      designId: "design-1",
      fileIds: [],
    });

    expect(target.stateUnreadable).toBe(false);
    expect(pickAssetInsertFile([cssFile], target)).toBeNull();
  });
});
