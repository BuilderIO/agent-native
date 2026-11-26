// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { MailCount } from "./MailCount";

describe("MailCount", () => {
  afterEach(cleanup);

  it("reads out what the number counts instead of the bare number", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <a href="/inbox">
          Inbox
          <MailCount display="12" meaning="Unread conversations: 12" />
        </a>
      </TooltipProvider>,
    );

    expect(screen.getByRole("link").textContent).toContain(
      "Unread conversations: 12",
    );
    expect(screen.getByText("12").getAttribute("aria-hidden")).toBe("true");
  });
});
