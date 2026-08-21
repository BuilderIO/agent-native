import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { shouldShowInboxZero, type InboxZeroState } from "./inbox-zero";

const emptyInbox: InboxZeroState = {
  view: "inbox",
  activeLabel: null,
  hasEmailData: true,
  isLoading: false,
  isError: false,
  hasThread: false,
  searchQuery: undefined,
  threadCount: 0,
  hasNextPage: false,
};

function InboxZeroBoundary({ state }: { state: InboxZeroState }) {
  return shouldShowInboxZero(state) ? (
    <div data-testid="inbox-zero" />
  ) : (
    <div data-testid="email-list" />
  );
}

describe("InboxZero rendering", () => {
  it("keeps the paginated empty view mounted until all pages are exhausted", () => {
    const markup = renderToStaticMarkup(
      <InboxZeroBoundary state={{ ...emptyInbox, hasNextPage: true }} />,
    );

    expect(markup).toContain('data-testid="email-list"');
    expect(markup).not.toContain('data-testid="inbox-zero"');
  });

  it("renders Inbox Zero after the final empty page", () => {
    const markup = renderToStaticMarkup(
      <InboxZeroBoundary state={emptyInbox} />,
    );

    expect(markup).toContain('data-testid="inbox-zero"');
    expect(markup).not.toContain('data-testid="email-list"');
  });
});
