import { describe, expect, it } from "vitest";

import { ALL_TAB_ID } from "./inbox-threads";
import {
  filteredPathForView,
  mailListPath,
  openThreadPath,
  resolveMailOpenPath,
  STARRED_MAIL_PATH,
  UNREAD_INBOX_PATH,
} from "./mail-routes";
import { mailSettingsRoute } from "./settings-navigation";

describe("Mail open paths", () => {
  it("opens the linked thread in its view", () => {
    expect(
      resolveMailOpenPath({
        view: "inbox",
        params: { threadId: "1a1167f0aa08b90a" },
      }),
    ).toBe("/inbox/1a1167f0aa08b90a");
    expect(
      resolveMailOpenPath({ view: "sent", params: { threadId: "t/1 2" } }),
    ).toBe("/sent/t%2F1%202");
  });

  it("opens a thread linked from a view without thread routes in the inbox", () => {
    expect(
      resolveMailOpenPath({ view: "unknown", params: { threadId: "abc" } }),
    ).toBe("/inbox/abc");
    expect(resolveMailOpenPath({ params: { threadId: "abc" } })).toBe(
      "/inbox/abc",
    );
  });

  it("checks in the order InboxPage acts on the navigate command", () => {
    expect(
      resolveMailOpenPath({ view: "settings", params: { threadId: "abc" } }),
    ).toBe(mailSettingsRoute("general"));
    expect(
      resolveMailOpenPath({
        view: "settings",
        params: { settingsSection: "ai-filter" },
      }),
    ).toBe(mailSettingsRoute("ai-filter"));
    expect(
      resolveMailOpenPath({
        view: "inbox",
        params: { tab: "important", threadId: "abc" },
      }),
    ).toBe("/inbox/abc?tab=important");
  });

  it("carries the queued draft, inbox tab, saved filter, and search", () => {
    expect(
      resolveMailOpenPath({
        view: "draft-queue",
        params: { queuedDraftId: "draft 1" },
      }),
    ).toBe("/draft-queue?id=draft%201");
    expect(
      resolveMailOpenPath({ view: "inbox", params: { tab: "important" } }),
    ).toBe("/inbox?tab=important");
    expect(
      resolveMailOpenPath({ view: "inbox", params: { tab: ALL_TAB_ID } }),
    ).toBe(`/inbox?tab=${ALL_TAB_ID}`);
    expect(
      resolveMailOpenPath({ view: "inbox", params: { filter: "vip & co" } }),
    ).toBe("/inbox?filter=vip%20%26%20co");
    expect(
      resolveMailOpenPath({ view: "all", params: { q: "from:alice" } }),
    ).toBe("/all?q=from%3Aalice");
  });

  it("leaves links without a record to the open route's /<view> fallback", () => {
    expect(resolveMailOpenPath({ view: "scheduled", params: {} })).toBeNull();
    expect(
      resolveMailOpenPath({ view: "sent", params: { messageId: "m1" } }),
    ).toBeNull();
    expect(resolveMailOpenPath({ view: "draft-queue", params: {} })).toBeNull();
    // InboxPage has no search branch and would navigate to the view itself.
    expect(
      resolveMailOpenPath({ view: "unknown", params: { q: "term" } }),
    ).toBeNull();
  });

  it("keeps the inbox filter on links from list-inbox-threads", () => {
    expect(
      resolveMailOpenPath({
        view: "inbox",
        params: { tab: "important", inboxFilter: "r=unread:is_checked" },
      }),
    ).toBe("/inbox?tab=important&r=unread:is_checked");
    expect(
      resolveMailOpenPath({
        view: "inbox",
        params: { inboxFilter: "r=starred:is_checked&r=bogus:is_checked" },
      }),
    ).toBe("/inbox?r=starred:is_checked");
    expect(
      resolveMailOpenPath({
        view: "inbox",
        params: { inboxFilter: "r=bogus:is_checked" },
      }),
    ).toBeNull();
  });

  it("builds one destination from the view, thread, search and filter", () => {
    expect(
      resolveMailOpenPath({
        view: "all",
        params: { q: "from:alice", inboxFilter: "r=starred:is_checked" },
      }),
    ).toBe("/all?q=from:alice&r=starred:is_checked");
    expect(
      resolveMailOpenPath({
        view: "all",
        params: { threadId: "t/1", inboxFilter: "r=starred:is_checked" },
      }),
    ).toBe("/all/t%2F1?r=starred:is_checked");
    expect(
      mailListPath({
        view: "inbox",
        tab: "important",
        threadId: "t1",
        inboxFilter: "r=unread:is_checked",
      }),
    ).toBe("/inbox/t1?tab=important&r=unread:is_checked");
    expect(
      mailListPath({ view: "sent", inboxFilter: "r=unread:is_checked" }),
    ).toBe("/sent");
  });

  it("sends the old Unread page to the filtered inbox and Starred to All Mail", () => {
    expect(UNREAD_INBOX_PATH).toBe("/inbox?r=unread:is_checked");
    expect(STARRED_MAIL_PATH).toBe("/all?r=starred:is_checked");
    expect(filteredPathForView("unread", "")).toBe(UNREAD_INBOX_PATH);
    expect(filteredPathForView("starred", "")).toBe(STARRED_MAIL_PATH);
    expect(filteredPathForView("unread", "?tab=other", "t/1")).toBe(
      "/inbox/t%2F1?tab=other&r=unread:is_checked",
    );
    expect(
      filteredPathForView("starred", "?accountEmail=a%40example.com", "t/1"),
    ).toBe("/all/t%2F1?accountEmail=a%40example.com&r=starred:is_checked");
    expect(filteredPathForView("sent", "")).toBeNull();
    expect(filteredPathForView(undefined, "")).toBeNull();
  });

  it("builds the same encoded thread URL for the navigate command", () => {
    expect(openThreadPath("sent", "t/1 2")).toBe("/sent/t%2F1%202");
    expect(openThreadPath("settings", "abc")).toBe("/inbox/abc");
    expect(openThreadPath(undefined, "abc")).toBe("/inbox/abc");
  });
});
