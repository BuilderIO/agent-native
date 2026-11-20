import { describe, expect, it } from "vitest";

import { searchPlaces } from "./search-places";

const workspaces = [
  {
    id: "ws-1",
    name: "Marketing",
    position: 0,
    formCount: 2,
    folders: [
      { id: "f-1", name: "Campaigns", position: 0, formCount: 1 },
      { id: "f-2", name: "Archive", position: 1, formCount: 0 },
    ],
  },
  {
    id: "ws-2",
    name: "Support",
    position: 1,
    formCount: 1,
    folders: [{ id: "f-3", name: "Escalations", position: 0, formCount: 1 }],
  },
] as unknown as Parameters<typeof searchPlaces>[0];

describe("searchPlaces", () => {
  it("finds a workspace by name", () => {
    expect(searchPlaces(workspaces, "mark")).toEqual([
      {
        kind: "workspace",
        id: "ws-1",
        name: "Marketing",
        workspaceId: "ws-1",
        folderId: null,
      },
    ]);
  });

  it("finds a folder and keeps the workspace it belongs to", () => {
    expect(searchPlaces(workspaces, "escal")).toEqual([
      {
        kind: "folder",
        id: "f-3",
        name: "Escalations",
        workspaceId: "ws-2",
        folderId: "f-3",
        workspaceName: "Support",
      },
    ]);
  });

  it("finds nothing for an empty query", () => {
    expect(searchPlaces(workspaces, "   ")).toEqual([]);
  });

  it("caps how many places one search offers", () => {
    expect(searchPlaces(workspaces, "a", 1)).toHaveLength(1);
  });
});
