// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/navigation", () => ({
  buildSettingsRoute: (section: string) => `/settings/${section}`,
}));

vi.mock("@agent-native/toolkit/app/settings", () => ({
  BuilderConnectPopover: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  useBuilderConnectFlow: () => ({ connecting: false, error: null }),
}));

vi.mock("react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { ThreadSummaryCard } from "./ThreadSummaryCard";

afterEach(cleanup);

const summary = {
  threadId: "t1",
  accountEmail: "me@example.com",
  line: "Launch moves to Friday.",
  points: ["Ana asked to ship Friday", "QA still needs a build"],
  lastMessageId: "m1",
  messageCount: 2,
  updatedAt: 1,
};

function codedError(errorCode: string) {
  return Object.assign(new Error(errorCode), { errorCode });
}

function renderCard(props: Partial<Parameters<typeof ThreadSummaryCard>[0]>) {
  const handlers = { onHide: vi.fn(), onRetry: vi.fn() };
  render(
    <ThreadSummaryCard
      summary={null}
      pending={false}
      error={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("ThreadSummaryCard", () => {
  it("shows the summary's line and points and hides on request", () => {
    const { onHide } = renderCard({ summary });
    expect(screen.getByText("Launch moves to Friday.")).toBeTruthy();
    expect(screen.getByText("Ana asked to ship Friday")).toBeTruthy();
    expect(screen.getByText("QA still needs a build")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mail.summary.hide" }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("shows just the line when there are no points", () => {
    renderCard({ summary: { ...summary, points: [] } });
    expect(screen.getByText("Launch moves to Friday.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("announces a summary in progress", () => {
    renderCard({ pending: true });
    expect(
      screen
        .getByRole("region", { name: "mail.summary.label" })
        .getAttribute("aria-busy"),
    ).toBe("true");
    expect(screen.getByText("mail.summary.summarizing")).toBeTruthy();
  });

  it("offers Builder or an API key when no model is connected", () => {
    renderCard({ error: codedError("no_ai_model") });
    expect(screen.getByText("mail.summary.needsModel")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "mail.aiFilter.connectBuilder" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "mail.aiFilter.addOpenAiApiKey" })
        .getAttribute("href"),
    ).toBe("/settings/keys:secrets:OPENAI_API_KEY");
  });

  it("says a refresh failed while keeping the older summary, and retries", () => {
    const { onRetry } = renderCard({
      summary,
      error: codedError("summary_failed"),
    });
    expect(screen.getByText("Ana asked to ship Friday")).toBeTruthy();
    expect(screen.getByText("mail.summary.refreshFailed")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "mail.error.tryAgain" }),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders nothing with no summary, no request and no error", () => {
    renderCard({});
    expect(screen.queryByRole("region")).toBeNull();
  });
});
