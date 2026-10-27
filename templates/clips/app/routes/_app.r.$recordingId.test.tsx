// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import {
  buildRecordingBreadcrumbItems,
  mergeRecordingReactions,
  recordingAccessView,
  RecordingShareRedirect,
  removePendingReaction,
} from "./_app.r.$recordingId";

describe("buildRecordingBreadcrumbItems", () => {
  const labels = {
    libraryLabel: "Library",
    trashLabel: "Trash",
    spacesLabel: "Spaces",
  };

  it("links trashed recordings back to Trash", () => {
    expect(
      buildRecordingBreadcrumbItems({
        ...labels,
        title: "Retired demo",
        trashedAt: "2026-09-22T12:00:00.000Z",
        space: { id: "space-1", name: "Research" },
        folder: { id: "folder-1", name: "Old demos", spaceId: "space-1" },
      }),
    ).toEqual([{ label: "Trash", to: "/trash" }, { label: "Retired demo" }]);
  });

  it("preserves the normal space and folder breadcrumbs", () => {
    expect(
      buildRecordingBreadcrumbItems({
        ...labels,
        title: "Current demo",
        trashedAt: null,
        space: { id: "space-1", name: "Research" },
        folder: { id: "folder-1", name: "Demos", spaceId: "space-1" },
      }),
    ).toEqual([
      { label: "Spaces", to: "/spaces" },
      { label: "Research", to: "/spaces/space-1" },
      { label: "Demos", to: "/spaces/space-1/folder/folder-1" },
      { label: "Current demo" },
    ]);
  });
});

describe("mergeRecordingReactions", () => {
  it("keeps optimistic reactions visible until the server copy arrives", () => {
    const merged = mergeRecordingReactions(
      [{ id: "reaction-1", emoji: "🔥", videoTimestampMs: 42_000 }],
      [
        {
          id: "pending-1",
          emoji: "🔥",
          videoTimestampMs: 42_000,
          recordingId: "recording-1",
        },
      ],
      "recording-1",
    );

    expect(merged).toEqual([
      { id: "reaction-1", emoji: "🔥", videoTimestampMs: 42_000 },
      {
        id: "pending-1",
        emoji: "🔥",
        videoTimestampMs: 42_000,
        recordingId: "recording-1",
      },
    ]);
  });

  it("does not show pending reactions from another recording", () => {
    expect(
      mergeRecordingReactions(
        [],
        [
          {
            id: "pending-a",
            emoji: "🔥",
            videoTimestampMs: 42_000,
            recordingId: "recording-a",
          },
          {
            id: "pending-b",
            emoji: "👏",
            videoTimestampMs: 5_000,
            recordingId: "recording-b",
          },
        ],
        "recording-b",
      ),
    ).toEqual([
      {
        id: "pending-b",
        emoji: "👏",
        videoTimestampMs: 5_000,
        recordingId: "recording-b",
      },
    ]);
  });
});

describe("removePendingReaction", () => {
  it("removes the client-only entry after the server write succeeds", () => {
    expect(
      removePendingReaction(
        [
          {
            id: "pending-1",
            emoji: "🔥",
            videoTimestampMs: 42_000,
            recordingId: "recording-1",
          },
          {
            id: "pending-2",
            emoji: "👏",
            videoTimestampMs: 42_000,
            recordingId: "recording-1",
          },
        ],
        "pending-1",
      ),
    ).toEqual([
      {
        id: "pending-2",
        emoji: "👏",
        videoTimestampMs: 42_000,
        recordingId: "recording-1",
      },
    ]);
  });
});

describe("recordingAccessView", () => {
  it.each([
    [401, false, "share"],
    [403, false, "share"],
    [403, true, "share"],
    [401, true, "retry"],
    [404, false, "page"],
    [500, true, "page"],
    [undefined, false, "page"],
  ] as const)(
    "a %s read with signedIn=%s shows %s",
    (accessStatus, signedIn, view) => {
      expect(
        recordingAccessView({ isPending: false, accessStatus, signedIn }),
      ).toBe(view);
    },
  );

  it("waits on the read before deciding", () => {
    expect(
      recordingAccessView({
        isPending: true,
        accessStatus: undefined,
        signedIn: false,
      }),
    ).toBe("pending");
  });
});

describe("RecordingShareRedirect", () => {
  it("paints only the skeleton, then puts the share page in its history entry", async () => {
    const to = "/share/clip-a?ref=clip";
    const firstPaint = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/r/clip-a"]}>
        <RecordingShareRedirect to={to} />
      </MemoryRouter>,
    );
    expect(firstPaint).toContain("skeleton-shimmer");
    expect(firstPaint).not.toContain("somethingWentWrong");

    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const router = createMemoryRouter(
      [
        { path: "/library", Component: () => <p>Library</p> },
        {
          path: "/r/:recordingId",
          element: <RecordingShareRedirect to={to} />,
        },
        { path: "/share/:shareId", Component: () => <p>Share page</p> },
      ],
      { initialEntries: ["/library", "/r/clip-a"], initialIndex: 1 },
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<RouterProvider router={router} />);
      });
      expect(router.state.location.pathname).toBe("/share/clip-a");
      expect(router.state.location.search).toBe("?ref=clip");
      expect(container.textContent).toBe("Share page");

      await act(async () => {
        await router.navigate(-1);
      });
      expect(router.state.location.pathname).toBe("/library");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
