// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActionCard } from "./ActionCard.js";

describe("ActionCard", () => {
  it("keeps the title and status truncatable when actions wrap on narrow cards", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <ActionCard
        icon={<span />}
        title="Release agentkit-acceptance to production"
        status="Approval needed"
        action={<button type="button">Approve</button>}
      />,
    );

    const card = container.querySelector("[data-action-card]");
    const title = card?.querySelector("p");
    const status = card?.querySelector("span[title='Approval needed']");
    const action = card?.querySelector("[data-action-card-action]");

    expect(card?.classList.contains("flex-wrap")).toBe(true);
    expect(title?.classList.contains("truncate")).toBe(true);
    expect(title?.classList.contains("flex-1")).toBe(true);
    expect(status?.classList.contains("truncate")).toBe(true);
    expect(status?.classList.contains("whitespace-nowrap")).toBe(true);
    expect(action?.classList.contains("ms-auto")).toBe(true);
  });
});
