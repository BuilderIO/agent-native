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
    // Date heading is humanized.
    expect(document.body.textContent).toContain("June 23, 2026");
  });

  it("ChangelogSettingsCard shows a limited set with a 'View all' affordance", () => {
    act(() => {
      root.render(<ChangelogSettingsCard markdown={MARKDOWN} limit={2} />);
    });
    expect(document.body.textContent).toContain("Recordings can be trimmed");
    expect(document.body.textContent).toContain("Faster transcript search");
    // Third (oldest) entry is hidden behind "View all".
    expect(document.body.textContent).not.toContain("Older fix.");
    expect(document.body.textContent).toContain("View all updates");
  });

  it("ChangelogSettingsCard renders nothing for an empty changelog", () => {
    act(() => {
      root.render(<ChangelogSettingsCard markdown="" />);
    });
    expect(container.textContent).toBe("");
  });

  it("useChangelogSeen does not nag first-time users but flags newer releases", () => {
    const seen: { unseen: boolean; markSeen: () => void }[] = [];
    function Harness({ latestId }: { latestId: string }) {
      const state = useChangelogSeen("test-app", latestId);
      seen.push(state);
      return null;
    }

    // First-ever visit: nothing stored → not flagged as unseen.
    act(() => {
      root.render(<Harness latestId="2026-06-23" />);
    });
    expect(seen.at(-1)!.unseen).toBe(false);

    // User opens it once (markSeen stores the current id).
    act(() => {
      seen.at(-1)!.markSeen();
    });
    expect(window.localStorage.getItem("an:changelog-seen:test-app")).toBe(
      "2026-06-23",
    );

    // A newer release lands → flagged unseen again.
    act(() => {
      root.render(<Harness latestId="2026-06-30" />);
    });
    expect(seen.at(-1)!.unseen).toBe(true);
  });
});
