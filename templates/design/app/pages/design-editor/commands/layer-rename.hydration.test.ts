import { sourceContentHash } from "@shared/source-workspace";
import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

import { runLayerRename } from "./layer-rename";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

it("renames a loaded screen while preserving loaded edits and ignoring unloaded bodies", () => {
  const files = [
    { id: "one", filename: "one.html", fileType: "html", content: "saved" },
    { id: "two", filename: "two.html", fileType: "html", content: "" },
  ];
  const mutate = vi.fn();
  const getScreenContent = vi.fn(() => "edited");
  runLayerRename(
    {
      canEditDesign: true,
      files,
      screenFiles: files,
      serverFiles: [files[0]],
      overviewScreens: [
        { id: "one", sourceState: "ready", sourceType: "inline" },
        { id: "two", sourceState: "unloaded", sourceType: "inline" },
      ],
      designSourceType: "inline",
      getScreenContent,
      queryClient: new QueryClient(),
      renameScreenMutation: { mutate },
    } as unknown as Parameters<typeof runLayerRename>[0],
    "one",
    "renamed",
  );
  expect(getScreenContent).toHaveBeenCalledTimes(1);
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "one",
      contentOverrides: [
        {
          fileId: "one",
          content: "edited",
          expectedVersionHash: sourceContentHash("saved"),
        },
      ],
    }),
    expect.any(Object),
  );
});

it("preserves edited bodies even when their preview dependencies failed", () => {
  const files = [
    { id: "one", filename: "one.html", fileType: "html", content: "saved" },
    { id: "two", filename: "two.html", fileType: "html", content: "saved" },
  ];
  const mutate = vi.fn();
  runLayerRename(
    {
      canEditDesign: true,
      files,
      screenFiles: files,
      serverFiles: files,
      overviewScreens: [
        { id: "one", sourceState: "ready" },
        { id: "two", sourceState: "error" },
      ],
      getScreenContent: (id: string) =>
        id === "two" ? '<a data-screen="one.html">edited</a>' : "saved",
      designSourceType: "inline",
      queryClient: new QueryClient(),
      renameScreenMutation: { mutate },
      t: (key: string) => key,
    } as unknown as Parameters<typeof runLayerRename>[0],
    "one",
    "renamed",
  );
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      contentOverrides: [
        {
          fileId: "two",
          content: '<a data-screen="one.html">edited</a>',
          expectedVersionHash: sourceContentHash("saved"),
        },
      ],
    }),
    expect.any(Object),
  );
});

it("renames a screen whose source has not loaded", () => {
  const loaded = {
    id: "one",
    filename: "one.html",
    fileType: "html",
    content: "saved",
  };
  const mutate = vi.fn();
  runLayerRename(
    {
      canEditDesign: true,
      files: [loaded],
      screenFiles: [loaded, { id: "two", filename: "two.html" }],
      serverFiles: [loaded],
      overviewScreens: [
        { id: "one", sourceState: "ready", sourceType: "inline" },
        { id: "two", sourceState: "unloaded", sourceType: "inline" },
      ],
      designSourceType: "inline",
      getScreenContent: () => "saved",
      queryClient: new QueryClient(),
      renameScreenMutation: { mutate },
    } as unknown as Parameters<typeof runLayerRename>[0],
    "two",
    "renamed",
  );
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ id: "two" }),
    expect.any(Object),
  );
});
