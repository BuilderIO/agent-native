import { describe, expect, it } from "vitest";

import {
  conversationFilterFlags,
  inboxFilterAccepts,
  inboxFilterGmailClause,
  inboxFilterIsReadable,
  inboxFilterParam,
  inboxFilterParamFor,
  inboxFilterParamForView,
  inboxFilterRequest,
  keepAcceptedConversations,
  readInboxFilter,
  viewTakesInboxFilter,
  withInboxFilter,
  type InboxFilterFlags,
} from "./inbox-filters";

const UNREAD = "r=unread:is_checked";
const STARRED = "r=starred:is_checked";
const EITHER = "match=any&r=unread:is_checked&r=starred:is_checked";
const SAME_OR_NEITHER =
  "match=any&g=1:all&r=1/unread:is_checked&r=1/starred:is_checked&g=2:all&r=2/unread:is_unchecked&r=2/starred:is_unchecked";

const COMBINATIONS: InboxFilterFlags[] = [
  { unread: true, starred: true },
  { unread: true, starred: false },
  { unread: false, starred: true },
  { unread: false, starred: false },
];

function kept(param: string) {
  const accepts = inboxFilterAccepts(param);
  if (!accepts) throw new Error(`no rules in ${param}`);
  return COMBINATIONS.filter(accepts);
}

describe("inbox filter URL", () => {
  it("writes each yes/no filter as a finished rule with no value step", () => {
    expect(inboxFilterParamFor({ unread: true })).toBe(UNREAD);
    expect(inboxFilterParamFor({ starred: true })).toBe(STARRED);
    expect(inboxFilterParamFor({ unread: false })).toBe(
      "r=unread:is_unchecked",
    );
    expect(inboxFilterParamFor({ unread: true, starred: true })).toBe(
      `${UNREAD}&${STARRED}`,
    );
    expect(inboxFilterParamFor({})).toBe("");
  });

  it("reads back the same rules it writes, through the page's own query", () => {
    for (const param of [UNREAD, STARRED, EITHER, `${UNREAD}&${STARRED}`]) {
      const search = `?tab=important&${param}&accountEmail=a%40example.com`;
      expect(inboxFilterParam(search)).toBe(param);
      expect(inboxFilterParam(new URLSearchParams(search))).toBe(param);
    }
    expect(readInboxFilter(`?${EITHER}`).mode).toBe("or");
  });

  it("drops rules for fields the inbox does not have", () => {
    expect(inboxFilterParam("?r=label:is_checked&q=receipts")).toBe("");
    expect(inboxFilterAccepts("r=label:is_checked")).toBeNull();
    expect(inboxFilterAccepts("")).toBeNull();
  });

  it("swaps the filter on a link and keeps its other params", () => {
    expect(withInboxFilter("/inbox?tab=important", UNREAD)).toBe(
      `/inbox?tab=important&${UNREAD}`,
    );
    expect(withInboxFilter(`/inbox/t-1?q=hi&${UNREAD}`, STARRED)).toBe(
      `/inbox/t-1?q=hi&${STARRED}`,
    );
    expect(withInboxFilter(`/inbox?tab=other&${UNREAD}`, "")).toBe(
      "/inbox?tab=other",
    );
  });
});

describe("inbox filter rules", () => {
  it("keeps the conversations each filter names", () => {
    expect(kept(UNREAD)).toEqual([
      { unread: true, starred: true },
      { unread: true, starred: false },
    ]);
    expect(kept(STARRED)).toEqual([
      { unread: true, starred: true },
      { unread: false, starred: true },
    ]);
    expect(kept(`${UNREAD}&${STARRED}`)).toEqual([
      { unread: true, starred: true },
    ]);
    expect(kept(EITHER)).toEqual([
      { unread: true, starred: true },
      { unread: true, starred: false },
      { unread: false, starred: true },
    ]);
    expect(kept("r=starred:is_unchecked")).toEqual([
      { unread: true, starred: false },
      { unread: false, starred: false },
    ]);
  });
});

describe("inbox filter Gmail clause", () => {
  it("asks Gmail for the same mail the Unread and Starred pages did", () => {
    expect(inboxFilterGmailClause(UNREAD)).toBe("is:unread");
    expect(inboxFilterGmailClause(STARRED)).toBe("is:starred");
    expect(inboxFilterGmailClause("r=unread:is_unchecked")).toBe("-is:unread");
  });

  it("asks for one Yes rule per term, since one message need not carry both", () => {
    expect(inboxFilterGmailClause(`${UNREAD}&${STARRED}`)).toBe("is:unread");
    expect(inboxFilterGmailClause(EITHER)).toBe(
      "{is:unread (is:unread -is:starred) (-is:unread is:starred)}",
    );
    expect(inboxFilterGmailClause(SAME_OR_NEITHER)).toBe(
      "{is:unread (-is:unread -is:starred)}",
    );
    expect(inboxFilterGmailClause("")).toBe("");
  });

  it("keeps every No rule beside a Yes rule", () => {
    expect(inboxFilterGmailClause(`${UNREAD}&r=starred:is_unchecked`)).toBe(
      "is:unread -is:starred",
    );
    expect(
      inboxFilterGmailClause("r=unread:is_unchecked&r=starred:is_unchecked"),
    ).toBe("-is:unread -is:starred");
  });

  it("matches nothing when the rules contradict each other", () => {
    expect(
      inboxFilterGmailClause("r=unread:is_checked&r=unread:is_unchecked"),
    ).toBe("is:unread -is:unread");
  });
});

describe("conversation-level filtering", () => {
  const reply = {
    id: "reply",
    threadId: "t-mixed",
    accountEmail: "a@example.com",
    isRead: false,
    isStarred: false,
  };
  const mixed = [
    {
      id: "older",
      threadId: "t-mixed",
      accountEmail: "a@example.com",
      isRead: true,
      isStarred: true,
    },
    reply,
  ];
  const plain = {
    id: "plain",
    threadId: "t-plain",
    accountEmail: "a@example.com",
    isRead: true,
    isStarred: false,
  };

  function keptIds(param: string, rows = [...mixed, plain]) {
    const accepts = inboxFilterAccepts(param);
    if (!accepts) throw new Error(`no rules in ${param}`);
    return keepAcceptedConversations(rows, accepts).map((row) => row.id);
  }

  it("reads a conversation as starred or unread when any message is", () => {
    expect(conversationFilterFlags(mixed)).toEqual({
      unread: true,
      starred: true,
    });
    expect(
      conversationFilterFlags([
        { isRead: true, isStarred: false },
        { isRead: false, isStarred: true, isDraft: true },
      ]),
    ).toEqual({ unread: false, starred: false });
  });

  it("keeps or drops every message of a mixed conversation together", () => {
    expect(keptIds(STARRED)).toEqual(["older", "reply"]);
    expect(keptIds("r=starred:is_unchecked")).toEqual(["plain"]);
    expect(keptIds("r=unread:is_unchecked")).toEqual(["plain"]);
  });

  it("judges shown rows by their whole conversation", () => {
    const accepts = inboxFilterAccepts("r=starred:is_unchecked");
    if (!accepts) throw new Error("no rules");
    expect(
      keepAcceptedConversations([reply], accepts, mixed).map((row) => row.id),
    ).toEqual([]);
  });
});

describe("views with the Filter menu", () => {
  it("reads the filter on Inbox and All Mail only", () => {
    expect(viewTakesInboxFilter("inbox")).toBe(true);
    expect(viewTakesInboxFilter("all")).toBe(true);
    expect(viewTakesInboxFilter("sent")).toBe(false);
    expect(viewTakesInboxFilter(undefined)).toBe(false);
    expect(inboxFilterParamForView("all", `?${STARRED}`)).toBe(STARRED);
    expect(inboxFilterParamForView("archive", `?${STARRED}`)).toBe("");
  });
});

describe("inbox filter requests", () => {
  it("sends the same rows the menu's rules keep, in a bounded form", () => {
    for (const param of [
      UNREAD,
      STARRED,
      EITHER,
      SAME_OR_NEITHER,
      `${UNREAD}&${STARRED}`,
      "r=unread:is_checked&r=unread:is_unchecked",
    ]) {
      expect(kept(inboxFilterRequest(`?${param}`))).toEqual(kept(param));
    }
    expect(inboxFilterRequest(`?${UNREAD}`)).toBe(UNREAD);
    expect(inboxFilterRequest(`?${SAME_OR_NEITHER}`)).toBe(SAME_OR_NEITHER);
  });

  it("collapses repeated lines, so the request stays under the action's cap", () => {
    const repeated = Array.from({ length: 40 }, () => UNREAD).join("&");
    expect(repeated.length).toBeGreaterThan(500);
    expect(inboxFilterRequest(`?${repeated}`)).toBe(UNREAD);
    const sprawling = [
      "match=any",
      ...Array.from(
        { length: 30 },
        (_, index) =>
          `g=${index + 1}:all&r=${index + 1}/unread:is_checked&r=${index + 1}/starred:is_unchecked`,
      ),
    ].join("&");
    expect(inboxFilterRequest(`?${sprawling}`)).toBe(
      "r=unread:is_checked&r=starred:is_unchecked",
    );
  });

  it("sends nothing when the rules keep every conversation", () => {
    expect(
      inboxFilterRequest(
        "?match=any&r=unread:is_checked&r=unread:is_unchecked",
      ),
    ).toBe("");
    expect(inboxFilterRequest("?q=receipts")).toBe("");
  });
});

describe("reading an inbox filter strictly", () => {
  it("accepts what the menu writes", () => {
    for (const param of [
      UNREAD,
      EITHER,
      SAME_OR_NEITHER,
      "r=starred:is_unchecked",
      "match=all&r=unread:is_checked",
    ]) {
      expect(inboxFilterIsReadable(param)).toBe(true);
    }
  });

  it("rejects input the inbox would only partly read", () => {
    for (const param of [
      "",
      "r=label:is_checked",
      "r=unread:is_checked&r=unknown:is_checked",
      "r=unread:is_yes",
      "r=3/unread:is_checked",
      "g=1:all",
      "match=some&r=unread:is_checked",
      "r=unread:is_checked&tab=important",
      "match=all&match=any&r=unread:is_checked&r=starred:is_checked",
    ]) {
      expect(inboxFilterIsReadable(param)).toBe(false);
    }
  });
});
