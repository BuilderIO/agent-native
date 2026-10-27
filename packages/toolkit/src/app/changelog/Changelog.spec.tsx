// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChangelogDialog,
  ChangelogSettingsCard,
  useChangelogSeen,
} from "./Changelog.js";

const MARKDOWN = `# Changelog

## 2026-06-23

### Added

- Recordings can be trimmed before sharing.

## 2026-05-01

### Improved

- Faster transcript search.

## 2026-04-01

### Fixed

- Older fix.
`;

const MANY_ENTRIES = `# Changelog

${Array.from(
  { length: 21 },
  (_, index) =>
    `## ${index < 10 ? "2026-06-23" : "2026-06-22"}\n\n- Update ${index + 1}.`,
).join("\n\n")}
`;

describe("Changelog UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("ChangelogDialog renders nothing when closed and entries when open", () => {
    act(() => {
      root.render(
        <ChangelogDialog
          open={false}
          onOpenChange={() => undefined}
          markdown={MARKDOWN}
        />,
      );
    });
    expect(document.body.textContent).not.toContain(
      "Recordings can be trimmed",
    );

    act(() => {
      root.render(
        <ChangelogDialog
          open
          onOpenChange={() => undefined}
          markdown={MARKDOWN}
        />,
      );
    });
    expect(document.body.textContent).toContain("Recordings can be trimmed");
    expect(document.body.textContent).toContain("June 23, 2026");
  });

  it("groups updates by date and reveals ten more cards at a time", () => {
    act(() => {
      root.render(<ChangelogSettingsCard markdown={MANY_ENTRIES} />);
    });
    expect(container.querySelectorAll("article")).toHaveLength(10);
    expect(container.querySelectorAll("h4")).toHaveLength(1);
    expect(container.textContent).toContain("Update 1.");
    expect(container.textContent).toContain("Update 10.");
    expect(container.textContent).not.toContain("Update 11.");
    expect(container.textContent).toContain("Load more");
    expect(container.querySelector("[class~='overflow-y-auto']")).toBeNull();

    const toggle = container.querySelector("button");
    expect(toggle).toBeTruthy();

    act(() => {
      toggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.querySelectorAll("article")).toHaveLength(20);
    expect(container.querySelectorAll("h4")).toHaveLength(2);
    expect(container.textContent).toContain("June 22, 2026");
    expect(container.textContent).toContain("Update 20.");
    expect(container.textContent).not.toContain("Update 21.");

    act(() => {
      toggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.querySelectorAll("article")).toHaveLength(21);
    expect(container.textContent).toContain("Update 21.");
    expect(container.querySelector("button")).toBeNull();
  });

  it("ChangelogSettingsCard preserves its empty state", () => {
    act(() => {
      root.render(
        <ChangelogSettingsCard markdown="" emptyText="No updates yet." />,
      );
    });
    expect(container.textContent).toContain("No updates yet.");
  });

  it("useChangelogSeen does not nag first-time users but flags newer releases", () => {
    const seen: { unseen: boolean; markSeen: () => void }[] = [];
    function Harness({ latestId }: { latestId: string }) {
      const state = useChangelogSeen("test-app", latestId);
      seen.push(state);
      return null;
    }

    act(() => {
      root.render(<Harness latestId="2026-06-23" />);
    });
    expect(seen.at(-1)!.unseen).toBe(false);

    act(() => {
      seen.at(-1)!.markSeen();
    });
    expect(window.localStorage.getItem("an:changelog-seen:test-app")).toBe(
      "2026-06-23",
    );

    act(() => {
      root.render(<Harness latestId="2026-06-30" />);
    });
    expect(seen.at(-1)!.unseen).toBe(true);
  });
});
