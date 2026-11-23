// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18nCatalog } from "@/i18n";

import { ProjectsListView } from "./ProjectsListView";

const user = { name: "Sam Reader", email: "reader@example.test" };

describe("archive and trash list controls", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });

  const render = (view: "archive" | "trash") =>
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <ProjectsListView
            status="ready"
            projects={[]}
            currentUser={user}
            search=""
            onSearchChange={() => undefined}
            onCreateProject={() => undefined}
            listView={view}
          />
        </AgentNativeI18nProvider>,
      );
    });

  it.each(["archive", "trash"] as const)(
    "%s offers a clickable display settings button that opens its menu",
    (view) => {
      render(view);
      const button = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Display settings"]',
      );
      expect(button).not.toBeNull();
      expect(button?.disabled).toBe(false);
      act(() => button?.click());
      expect(button?.getAttribute("aria-expanded")).toBe("true");
      expect(
        host.querySelector('[aria-label="Display settings"][role]'),
      ).not.toBeNull();
    },
  );

  it.each(["archive", "trash"] as const)(
    "%s shows a Created by you pill that toggles the filter",
    (view) => {
      render(view);
      const pill = [...host.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Created by you",
      );
      expect(pill).toBeDefined();
      act(() => pill?.click());
      const after = [...host.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Created by you",
      );
      expect(after?.getAttribute("aria-pressed")).toBe("true");
    },
  );
});
