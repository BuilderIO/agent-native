import { describe, expect, it } from "vitest";

import {
  inboxFilterAccepts,
  inboxFilterGmailClause,
  inboxFilterParam,
  inboxFilterParamFor,
  readInboxFilter,
  withInboxFilter,
  type InboxFilterFlags,
} from "./inbox-filters";

const UNREAD = "r=unread:is_checked";
const STARRED = "r=starred:is_checked";
const EITHER = "match=any&r=unread:is_checked&r=starred:is_checked";

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

  it("joins rules the way the filter does", () => {
    expect(inboxFilterGmailClause(`${UNREAD}&${STARRED}`)).toBe(
      "is:unread is:starred",
    );
    expect(inboxFilterGmailClause(EITHER)).toBe(
      "{(is:unread is:starred) (is:unread -is:starred) (-is:unread is:starred)}",
    );
    expect(inboxFilterGmailClause("")).toBe("");
  });

  it("matches nothing when the rules contradict each other", () => {
    expect(
      inboxFilterGmailClause("r=unread:is_checked&r=unread:is_unchecked"),
    ).toBe("is:unread -is:unread");
  });
});
