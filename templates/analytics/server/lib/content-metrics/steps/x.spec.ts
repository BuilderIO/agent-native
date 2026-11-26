import { describe, expect, it } from "vitest";

import type { XPost, XPostLink } from "../../x-api.js";
import {
  projectXMonthSpend,
  xCheckpointDue,
  xCountedBy,
  xPostExcerpt,
  xTermMatches,
} from "./x.js";

const SPACED_BRAND = ["Agent", "Native"].join(" ");
const RULE = {
  links: ["builder.io/blog", "agent-native.com"],
  terms: ["Builder.io", "@builderio", "Agent-Native", SPACED_BRAND],
};
const BUILDERIO = { handle: "@builderio", allPosts: true };
const STEVE = { handle: "@Steve8708", allPosts: false };

function link(expandedUrl: string, url = "https://t.co/abc"): XPostLink {
  return { url, expandedUrl, unwoundUrl: null, displayUrl: null };
}

function post(text: string, links: XPostLink[] = []): XPost {
  return {
    id: "1",
    createdAt: "2026-11-20T12:00:00.000Z",
    text,
    links,
    metrics: {
      views: 1,
      likes: 1,
      reposts: 1,
      replies: 1,
      quotes: 1,
      bookmarks: 1,
    },
  };
}

describe("X counting rule", () => {
  it("counts every post from an account set to count all its posts", () => {
    expect(xCountedBy(post("Happy Thanksgiving!"), BUILDERIO, RULE)).toBe(
      "account",
    );
  });

  it("counts another account's post that links under a tracked link, judged on the real address", () => {
    expect(
      xCountedBy(
        post("New post https://t.co/abc", [
          link("https://www.builder.io/blog/visual-copilot"),
        ]),
        STEVE,
        RULE,
      ),
    ).toBe("link:builder.io/blog");
    expect(
      xCountedBy(
        post("Docs https://t.co/abc", [
          {
            url: "https://t.co/abc",
            expandedUrl: "https://bit.ly/short",
            unwoundUrl: "https://docs.agent-native.com/start",
            displayUrl: "bit.ly/short",
          },
        ]),
        STEVE,
        RULE,
      ),
    ).toBe("link:agent-native.com");
  });

  it("doesn't count a link elsewhere on builder.io, a look-alike host or a path that only starts the same", () => {
    for (const href of [
      "https://www.builder.io/pricing",
      "https://builder.io.example.com/blog/x",
      "https://notbuilder.io/blog/x",
      "https://www.builder.io/blogroll",
    ]) {
      expect(
        xCountedBy(post("Look https://t.co/abc", [link(href)]), STEVE, RULE),
      ).toBeNull();
    }
  });

  it("counts a post that names Builder.io, @builderio or Agent-Native as a whole word", () => {
    expect(
      xCountedBy(post("We shipped this at builder.io today"), STEVE, RULE),
    ).toBe("term:Builder.io");
    expect(xCountedBy(post("Thanks @BuilderIO!"), STEVE, RULE)).toBe(
      "term:@builderio",
    );
    expect(xCountedBy(post("Built with Agent-Native."), STEVE, RULE)).toBe(
      "term:Agent-Native",
    );
    expect(xCountedBy(post(`${SPACED_BRAND} apps are fun`), STEVE, RULE)).toBe(
      `term:${SPACED_BRAND}`,
    );
  });

  it("doesn't count the generic word builder, a lowercase spaced name or a longer handle", () => {
    for (const text of [
      "Every builder should try this",
      "The Builder pattern in Java",
      `${SPACED_BRAND.toLowerCase()} workflows for everyone`,
      "Thanks @builderio_fan",
      "mybuilder.io is not it",
    ]) {
      expect(xCountedBy(post(text), STEVE, RULE)).toBeNull();
    }
  });

  it("counts a term with a hyphen in any case, with the Unicode hyphens X posts often carry", () => {
    expect(
      xCountedBy(post("an agent-native workflow for everyone"), STEVE, RULE),
    ).toBe("term:Agent-Native");
    for (const hyphen of [0x2010, 0x2011]) {
      expect(
        xCountedBy(
          post(`Built with Agent${String.fromCharCode(hyphen)}Native.`),
          STEVE,
          RULE,
        ),
      ).toBe("term:Agent-Native");
    }
    expect(
      xCountedBy(
        post(`Built with Agent${String.fromCharCode(0x2013)}Native.`),
        STEVE,
        RULE,
      ),
    ).toBeNull();
  });

  it("doesn't let a t.co address or a builder.io homepage link count as a mention", () => {
    expect(
      xCountedBy(
        post("See https://t.co/abc", [
          {
            url: "https://t.co/abc",
            expandedUrl: "https://www.builder.io/",
            unwoundUrl: null,
            displayUrl: "builder.io",
          },
        ]),
        STEVE,
        RULE,
      ),
    ).toBeNull();
  });

  it("counts a quote of an @builderio post or a link to its profile through the link", () => {
    for (const href of [
      "https://x.com/builderio/status/123",
      "https://x.com/BuilderIO/status/123/photo/1",
      "https://mobile.twitter.com/builderio/status/123",
      "https://x.com/builderio",
      "https://www.x.com/builderio/",
    ]) {
      expect(
        xCountedBy(
          post("This is great https://t.co/q", [link(href, "https://t.co/q")]),
          STEVE,
          RULE,
        ),
      ).toBe("term:@builderio");
    }
  });

  it("doesn't count a link to another account, another page of @builderio's or a search for it", () => {
    for (const href of [
      "https://twitter.com/someoneelse/status/123",
      "https://x.com/builderio_fan/status/123",
      "https://x.com/builderio/likes",
      "https://x.com/builderio/followers",
      "https://x.com/search?q=builderio",
      "https://notx.com/builderio",
    ]) {
      expect(
        xCountedBy(
          post("Look https://t.co/q", [link(href, "https://t.co/q")]),
          STEVE,
          RULE,
        ),
      ).toBeNull();
    }
  });

  it("matches a term with anything besides letters and spaces in any case and other terms in their own case", () => {
    expect(xTermMatches("BUILDER.IO rocks", "Builder.io")).toBe(true);
    expect(xTermMatches("AGENT-NATIVE", "Agent-Native")).toBe(true);
    expect(xTermMatches("v2 is out", "V2")).toBe(true);
    expect(xTermMatches(SPACED_BRAND.toLowerCase(), SPACED_BRAND)).toBe(false);
    expect(xTermMatches("(Agent-Native)", "Agent-Native")).toBe(true);
  });

  it("treats any letter, accented or not, as part of the word around a term", () => {
    expect(xTermMatches("éBuilder.io", "Builder.io")).toBe(false);
    expect(xTermMatches("Builder.ioñ", "Builder.io")).toBe(false);
    expect(xTermMatches("«Builder.io»", "Builder.io")).toBe(true);
    expect(xTermMatches("Builder.io’s new editor", "Builder.io")).toBe(true);
    expect(xTermMatches(`Café ${SPACED_BRAND}`, SPACED_BRAND)).toBe(true);
    expect(xTermMatches(`Café${SPACED_BRAND}`, SPACED_BRAND)).toBe(false);
  });
});

describe("X post excerpt", () => {
  it("shows link addresses as X displays them and shortens a long post", () => {
    expect(
      xPostExcerpt(
        post("Read   this\nhttps://t.co/abc", [
          {
            url: "https://t.co/abc",
            expandedUrl: "https://www.builder.io/blog/x",
            unwoundUrl: null,
            displayUrl: "builder.io/blog/x",
          },
        ]),
      ),
    ).toBe("Read this builder.io/blog/x");
    const long = xPostExcerpt(post("word ".repeat(60)));
    expect(long).toHaveLength(140);
    expect(long?.endsWith("…")).toBe(true);
    expect(xPostExcerpt(post("  "))).toBeNull();
  });
});

describe("X re-read schedule", () => {
  const published = "2026-11-01T12:00:00.000Z";
  const at = (hours: number) =>
    new Date(Date.parse(published) + hours * 3_600_000);

  it("re-reads a post once in each window that opens at 1, 3, 7 and 30 days old", () => {
    expect(xCheckpointDue(published, at(5).toISOString(), at(23))).toBeNull();
    expect(xCheckpointDue(published, at(5).toISOString(), at(29))).toBe(1);
    expect(xCheckpointDue(published, at(29).toISOString(), at(53))).toBeNull();
    expect(xCheckpointDue(published, at(29).toISOString(), at(77))).toBe(3);
    expect(xCheckpointDue(published, at(77).toISOString(), at(173))).toBe(7);
    expect(xCheckpointDue(published, at(173).toISOString(), at(725))).toBe(30);
    expect(
      xCheckpointDue(published, at(725).toISOString(), at(749)),
    ).toBeNull();
    expect(
      xCheckpointDue(published, at(725).toISOString(), at(800)),
    ).toBeNull();
  });

  it("skips a window the post was already read in, or one that closed before a read came", () => {
    expect(xCheckpointDue(published, at(50).toISOString(), at(52))).toBeNull();
    expect(xCheckpointDue(published, at(5).toISOString(), at(60))).toBeNull();
    expect(xCheckpointDue(published, at(400).toISOString(), at(730))).toBe(30);
  });

  it("leaves out the 30-day read when asked to", () => {
    expect(
      xCheckpointDue(published, at(173).toISOString(), at(725), [1, 3, 7]),
    ).toBeNull();
  });
});

describe("X month-end projection", () => {
  const now = new Date("2026-11-20T08:00:00.000Z");

  it("adds pending re-reads and the rest of the month's posts and re-reads to what is spent", () => {
    const base = {
      now,
      spentMicros: 1_000_000,
      countedPosts: [],
      postsPerDay: 0,
      countedPerDay: 0,
      lookupsPerDay: 0,
      includeDay30: true,
    };
    expect(projectXMonthSpend(base)).toBe(1_000_000);
    expect(projectXMonthSpend({ ...base, postsPerDay: 10 })).toBe(
      1_000_000 + 10 * 10 * 5_000,
    );
    expect(projectXMonthSpend({ ...base, lookupsPerDay: 1 })).toBe(
      1_000_000 + 10 * 10_000,
    );
    expect(
      projectXMonthSpend({
        ...base,
        countedPosts: [
          {
            publishedAt: "2026-11-19T12:00:00.000Z",
            lastReadAt: "2026-11-19T20:00:00.000Z",
          },
        ],
      }),
    ).toBe(1_000_000 + 3 * 5_000);
  });

  it("counts a 30-day read only when it is asked for and falls inside the month", () => {
    const old = {
      publishedAt: "2026-10-21T12:00:00.000Z",
      lastReadAt: "2026-10-28T20:00:00.000Z",
    };
    const base = {
      now,
      spentMicros: 0,
      countedPosts: [old],
      postsPerDay: 0,
      countedPerDay: 0,
      lookupsPerDay: 0,
    };
    expect(projectXMonthSpend({ ...base, includeDay30: true })).toBe(5_000);
    expect(projectXMonthSpend({ ...base, includeDay30: false })).toBe(0);
    expect(
      projectXMonthSpend({
        ...base,
        countedPosts: [
          {
            publishedAt: "2026-11-10T12:00:00.000Z",
            lastReadAt: "2026-11-17T20:00:00.000Z",
          },
        ],
        includeDay30: true,
      }),
    ).toBe(0);
  });
});
