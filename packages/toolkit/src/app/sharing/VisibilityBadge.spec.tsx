// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import { OwnershipFilter } from "./OwnershipFilter.js";
import { VisibilityBadge } from "./VisibilityBadge.js";

const catalog = createToolkitI18nCatalog({ messages: {} });

describe("localized sharing wrappers", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // The i18n provider reads the saved language over HTTP; keep it offline.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(node: React.ReactNode) {
    act(() =>
      root.render(
        <AgentNativeI18nProvider catalog={catalog}>
          {node}
        </AgentNativeI18nProvider>,
      ),
    );
  }

  it("names every visibility through Core copy, with Organization spelled out", () => {
    const texts = (["private", "org", "public"] as const).map((visibility) => {
      render(<VisibilityBadge visibility={visibility} />);
      return container.querySelector("span")?.textContent;
    });
    expect(texts).toEqual(["Private", "Organization", "Public"]);
  });

  it("lets a caller override a single label", () => {
    render(<VisibilityBadge visibility="org" labels={{ org: "Team" }} />);
    expect(container.querySelector("span")?.textContent).toBe("Team");
  });

  it("labels the ownership filter through Core copy", () => {
    render(<OwnershipFilter value="shared" onChange={() => {}} />);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Shared with me",
    );
  });
});
