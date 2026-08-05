// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { docsI18nCatalog } from "../i18n";
import { SlidesTryNow } from "./SlidesTryNow";

const callAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));

afterEach(() => {
  cleanup();
  callAction.mockReset();
});

describe("SlidesTryNow", () => {
  it("replaces action details with actionable crawl guidance", async () => {
    callAction.mockRejectedValueOnce(
      new Error("Action crawl-design-reference failed: Internal server error"),
    );

    render(
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <SlidesTryNow />
      </AgentNativeI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Website URL" }), {
      target: { value: "https://www.cbre.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect website" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "We couldn't inspect this site. It may block automated access. Try another URL or upload a design reference instead.",
      ),
    );
    expect(screen.queryByText(/crawl-design-reference/)).toBeNull();
  });
});
