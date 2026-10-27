// @vitest-environment happy-dom

import { readStoredCommentMentions } from "@shared/comment-mentions";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderCommentBody } from "./CommentRow";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: () => "Oct 11, 2026, 9:37 AM" }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  requestAgentChatThreadOpen: vi.fn(),
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The text a screen reader reads: avatars and logos are hidden from it. */
function spokenText(node: Node): string {
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true")
    return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return [...node.childNodes].map(spokenText).join("");
}

function render(content: string, mentionsJson: string | null) {
  act(() =>
    root.render(
      <p>
        {renderCommentBody(content, readStoredCommentMentions(mentionsJson))}
      </p>,
    ),
  );
  return [...host.querySelectorAll<HTMLElement>("[data-comment-mention]")];
}

describe("sent comment mentions", () => {
  it("draws each stored person and agent as a pill", () => {
    const pills = render(
      "@Sam can you ask @Claude Sonnet 4.6 to check this?",
      JSON.stringify([
        { kind: "person", email: "sam@example.com", name: "Sam" },
        {
          kind: "agent",
          model: "claude-sonnet-4-6",
          engine: "anthropic",
          provider: "Anthropic",
          name: "Claude Sonnet 4.6",
        },
      ]),
    );

    expect(
      pills.map((pill) => [pill.dataset.commentMention, spokenText(pill)]),
    ).toEqual([
      ["person", "@Sam"],
      ["agent", "@Claude Sonnet 4.6"],
    ]);
    expect(pills.every((pill) => pill.tabIndex === 0)).toBe(true);
    expect(spokenText(host)).toBe(
      "@Sam can you ask @Claude Sonnet 4.6 to check this?",
    );
  });

  it("draws a mention saved before mentions had a kind as a person", () => {
    const pills = render(
      "Thanks @Sam",
      JSON.stringify([{ email: "sam@example.com", name: "Sam" }]),
    );

    expect(pills.map((pill) => pill.dataset.commentMention)).toEqual([
      "person",
    ]);
  });

  it("leaves plain-text mentions with no stored identity as text", () => {
    expect(render("Thanks @Sam, and @Claude too", null)).toEqual([]);
    expect(spokenText(host)).toBe("Thanks @Sam, and @Claude too");
  });

  it("draws each of two people who share a name as their own pill", () => {
    const pills = render(
      "@Sam Lee and @Sam Lee, plus @Priya",
      JSON.stringify([
        { kind: "person", email: "sam.lee@example.com", name: "Sam Lee" },
        { kind: "person", email: "sam.l@example.org", name: "Sam Lee" },
        { kind: "person", email: "priya@example.com", name: "Priya" },
      ]),
    );
    const cardFor = (pill: HTMLElement) => {
      act(() => pill.click());
      const text = document.querySelector(
        "[data-comment-identity-card]",
      )?.textContent;
      act(() => pill.click());
      return text;
    };

    expect(pills.map((pill) => spokenText(pill))).toEqual([
      "@Sam Lee",
      "@Sam Lee",
      "@Priya",
    ]);
    expect(cardFor(pills[0]!)).toContain("sam.lee@example.com");
    expect(cardFor(pills[1]!)).toContain("sam.l@example.org");
    expect(spokenText(host)).toBe("@Sam Lee and @Sam Lee, plus @Priya");
  });

  it("draws a name inside a longer stored name once, as the longer one", () => {
    const pills = render(
      "@Sam Lee met @Sam; @Samantha did not",
      JSON.stringify([
        { kind: "person", email: "sam@example.com", name: "Sam" },
        { kind: "person", email: "sam.lee@example.com", name: "Sam Lee" },
      ]),
    );

    expect(pills.map((pill) => spokenText(pill))).toEqual(["@Sam Lee", "@Sam"]);
    expect(spokenText(host)).toBe("@Sam Lee met @Sam; @Samantha did not");
    expect(host.textContent).not.toContain("](");
  });

  it("leaves an @name in inline code or a URL as code and as the address", () => {
    const pills = render(
      "Ask @Sam about `@Sam` and https://medium.com/@Sam",
      JSON.stringify([
        { kind: "person", email: "sam@example.com", name: "Sam" },
      ]),
    );

    expect(pills.map((pill) => spokenText(pill))).toEqual(["@Sam"]);
    expect(host.querySelector("code")?.textContent).toBe("@Sam");
    expect(
      [...host.querySelectorAll("a[href^='https://medium.com']")].map(
        (link) => [link.getAttribute("href"), link.textContent],
      ),
    ).toEqual([["https://medium.com/@Sam", "https://medium.com/@Sam"]]);
    expect(host.textContent).not.toContain("](");
  });

  it("leaves an @name in a Markdown link's label as the link", () => {
    const pills = render(
      "See [@Sam](https://x.com/profile), [@Sam](https://x.com/Sam_(name)), and ask @Sam",
      JSON.stringify([
        { kind: "person", email: "sam@example.com", name: "Sam" },
      ]),
    );

    expect(pills.map((pill) => spokenText(pill))).toEqual(["@Sam"]);
    expect(
      [...host.querySelectorAll("a[href^='https://x.com/']")].map(
        (link) => link.textContent,
      ),
    ).toEqual(["@Sam", "@Sam"]);
    expect(host.textContent).not.toContain("](");
  });

  it("leaves an @name in a reference link's label as the link", () => {
    const pills = render(
      "See [@Sam][profile] and ask @Sam\n\n[profile]: https://x.com/profile",
      JSON.stringify([
        { kind: "person", email: "sam@example.com", name: "Sam" },
      ]),
    );

    expect(pills.map((pill) => spokenText(pill))).toEqual(["@Sam"]);
    expect(
      [...host.querySelectorAll("a[href='https://x.com/profile']")].map(
        (link) => link.textContent,
      ),
    ).toEqual(["@Sam"]);
  });

  it("never turns markup in a name or comment into elements", () => {
    const pills = render(
      "<b>bold</b> @<img src=x>",
      JSON.stringify([
        { kind: "person", email: "x@example.com", name: "<img src=x>" },
      ]),
    );

    expect(pills).toHaveLength(1);
    expect(host.querySelector("img[src='x'], b")).toBeNull();
  });
});
