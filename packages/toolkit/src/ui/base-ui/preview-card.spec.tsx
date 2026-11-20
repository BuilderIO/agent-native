// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from "./preview-card.js";

afterEach(cleanup);

describe("PreviewCard", () => {
  it("renders the preview-card part's classes", async () => {
    render(
      <PreviewCard defaultOpen>
        <PreviewCardTrigger href="#profile">@agent-native</PreviewCardTrigger>
        <PreviewCardContent className="w-80" data-testid="card">
          Profile
        </PreviewCardContent>
      </PreviewCard>,
    );

    const card = await screen.findByTestId("card");
    expect(card.classList.contains("preview-card-popup")).toBe(true);
    expect(card.classList.contains("w-80")).toBe(true);
    expect(card.parentElement?.className).toContain("preview-card-positioner");
  });

  it("writes size 2 on the popup by default, and the size it is given", async () => {
    render(
      <>
        <PreviewCard defaultOpen>
          <PreviewCardTrigger href="#a">a</PreviewCardTrigger>
          <PreviewCardContent data-testid="default">A</PreviewCardContent>
        </PreviewCard>
        <PreviewCard defaultOpen>
          <PreviewCardTrigger href="#b">b</PreviewCardTrigger>
          <PreviewCardContent data-testid="small" size="1">
            B
          </PreviewCardContent>
        </PreviewCard>
      </>,
    );
    expect((await screen.findByTestId("default")).dataset.size).toBe("2");
    expect(screen.getByTestId("small").dataset.size).toBe("1");
  });

  it("takes its delay on the trigger", () => {
    render(
      <PreviewCard>
        <PreviewCardTrigger delay={0} closeDelay={0} href="#profile">
          @agent-native
        </PreviewCardTrigger>
        <PreviewCardContent>Profile</PreviewCardContent>
      </PreviewCard>,
    );
    expect(screen.getByRole("link", { name: "@agent-native" })).not.toBeNull();
  });
});
