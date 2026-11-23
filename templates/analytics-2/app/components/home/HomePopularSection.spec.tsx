// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import messages from "@/i18n/en-US";

import { HomePopularSection } from "./popular";
import type { HomePopular } from "./types";

// A section that shows a control must back it: a "View all" button rendered
// `disabled` is a dead control on the first screen a teammate sees.
describe("Home popular section", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  const render = (popular: HomePopular) =>
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <MemoryRouter>
            <HomePopularSection popular={popular} />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });

  it("renders no control when there is nowhere to view all", () => {
    render({
      status: "ready",
      viewAllHref: null,
      projects: [
        {
          id: "p1",
          title: "Revenue overview",
          description: null,
          updatedAt: "2026-11-08T10:00:00.000Z",
        },
      ],
    } as unknown as HomePopular);

    const buttons = [...host.querySelectorAll("button")];
    expect(
      buttons.filter((button) => /View all/i.test(button.textContent ?? "")),
    ).toEqual([]);
    const links = [...host.querySelectorAll("a")].filter((link) =>
      /View all/i.test(link.textContent ?? ""),
    );
    expect(links).toEqual([]);
  });

  it("links View all when the caller supplies a destination", () => {
    render({
      status: "ready",
      viewAllHref: "/home/all?sort=popular",
      projects: [
        {
          id: "p1",
          title: "Revenue overview",
          description: null,
          updatedAt: "2026-11-08T10:00:00.000Z",
        },
      ],
    } as unknown as HomePopular);

    const links = [...host.querySelectorAll("a")].filter((link) =>
      /View all/i.test(link.textContent ?? ""),
    );
    expect(links.length).toBeGreaterThan(0);
  });

  it("report 1794900494.750729 explains the view count on hover", () => {
    render({
      status: "ready",
      projects: [
        {
          id: "p1",
          title: "Revenue",
          href: "/app/p1/latest",
          viewCountLabel: "7",
          viewCountTooltip: "7 app views in the last 7 days",
        },
      ],
    });
    expect(
      host.querySelector('[title="7 app views in the last 7 days"]'),
    ).not.toBeNull();
  });

  it("shows signed embedding status on project cards when allowEmbedding is true", () => {
    render({
      status: "ready",
      projects: [
        {
          id: "p2",
          title: "Embedded Revenue",
          href: "/app/p2/latest",
          allowEmbedding: true,
        },
      ],
    });

    const badge = host.querySelector("[data-signed-embedding-card='true']");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Signed embedding enabled");
    expect(badge?.textContent).toContain(
      "This app uses signed credentials that must be passed via the API.",
    );
  });

  it("report 1794900494.750729 reveals Project Information metadata on hover and click", () => {
    render({
      status: "ready",
      viewAllHref: "/home/all?sort=popular",
      projects: [
        {
          id: "p3",
          title: "Revenue forecast",
          href: "/app/p3/latest",
          viewCountLabel: "4",
          viewCountTooltip: "4 app views in the last 7 days",
          information: {
            creatorName: "Ada Lovelace",
            ownerName: "Grace Hopper",
            createdAt: "2026-01-05T12:00:00.000Z",
            lastEditedAt: "2026-01-12T12:00:00.000Z",
            namesUnavailable: false,
          },
        },
      ],
    });

    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Project information"]',
    );
    expect(trigger).not.toBeNull();
    expect(
      document.querySelector(
        '[role="dialog"][aria-label="Project Information"]',
      ),
    ).toBeNull();

    act(() => {
      trigger!.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }),
      );
      trigger!.dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true, relatedTarget: null }),
      );
    });
    const dialog = document.querySelector(
      '[role="dialog"][aria-label="Project Information"]',
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Project Information");
    expect(dialog?.textContent).toContain("Published");
    expect(dialog?.textContent).toContain("Creator");
    expect(dialog?.textContent).toContain("Ada Lovelace");
    expect(dialog?.textContent).toContain("Owner");
    expect(dialog?.textContent).toContain("Grace Hopper");
    expect(dialog?.textContent).toContain("Created on");
    expect(dialog?.textContent).toContain("Last updated");

    act(() => {
      trigger!.dispatchEvent(
        new MouseEvent("pointerout", { bubbles: true, relatedTarget: null }),
      );
      trigger!.dispatchEvent(
        new MouseEvent("mouseout", { bubbles: true, relatedTarget: null }),
      );
    });
    expect(
      document.querySelector(
        '[role="dialog"][aria-label="Project Information"]',
      ),
    ).toBeNull();

    act(() => {
      trigger!.click();
    });
    act(() => {
      trigger!.dispatchEvent(
        new MouseEvent("pointerout", { bubbles: true, relatedTarget: null }),
      );
      trigger!.dispatchEvent(
        new MouseEvent("mouseout", { bubbles: true, relatedTarget: null }),
      );
    });
    expect(
      document.querySelector(
        '[role="dialog"][aria-label="Project Information"]',
      ),
    ).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(
      document.querySelector(
        '[role="dialog"][aria-label="Project Information"]',
      ),
    ).toBeNull();
  });

  it("report 1794900494.750729 distinguishes unavailable names from unknown names", () => {
    render({
      status: "ready",
      projects: [
        {
          id: "p4",
          title: "Unresolved names",
          href: "/app/p4/latest",
          information: {
            creatorName: null,
            ownerName: null,
            createdAt: "2026-01-05T12:00:00.000Z",
            lastEditedAt: "2026-01-12T12:00:00.000Z",
            namesUnavailable: true,
          },
        },
      ],
    });
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Project information"]',
    );
    act(() => {
      trigger!.click();
    });
    const dialog = document.querySelector(
      '[role="dialog"][aria-label="Project Information"]',
    );
    expect(dialog?.textContent).toContain("Name unavailable");
    expect(dialog?.textContent).not.toContain("Unknown");
  });
});
