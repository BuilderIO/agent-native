// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  SESSION_REPLAY_DEFAULT_BLOCK_SELECTOR,
  SESSION_REPLAY_DEFAULT_IGNORE_SELECTOR,
  SESSION_REPLAY_DEFAULT_MASK_TEXT_CLASS,
  SESSION_REPLAY_DEFAULT_MASK_TEXT_SELECTOR,
} from "./session-replay-privacy.js";

function element(html: string): Element {
  const template = document.createElement("template");
  template.innerHTML = html;
  const first = template.content.firstElementChild;
  if (!first) throw new Error(`no element in ${html}`);
  return first;
}

describe("session replay's default privacy selectors", () => {
  it.each([
    "<iframe data-agent-native-session-replay></iframe>",
    "<div data-sensitive></div>",
    "<div data-an-block></div>",
    "<div data-an-private></div>",
    "<div data-private></div>",
    '<div class="an-block"></div>',
    '<div class="an-replay-block"></div>',
    '<div class="an-private"></div>',
    '<div class="rr-block"></div>',
    '<input autocomplete="cc-number">',
    '<input autocomplete="cc-csc">',
    '<input autocomplete="cc-exp">',
    '<input name="NewPassword">',
    '<input name="creditLimit">',
    '<input name="cardHolder">',
    '<input name="ssn_last4">',
  ])("blocks %s", (html) => {
    expect(element(html).matches(SESSION_REPLAY_DEFAULT_BLOCK_SELECTOR)).toBe(
      true,
    );
  });

  it("leaves an ordinary field and iframe unblocked", () => {
    expect(
      element('<input name="search">').matches(
        SESSION_REPLAY_DEFAULT_BLOCK_SELECTOR,
      ),
    ).toBe(false);
    expect(
      element("<iframe></iframe>").matches(
        SESSION_REPLAY_DEFAULT_BLOCK_SELECTOR,
      ),
    ).toBe(false);
  });

  it.each(['<div class="an-ignore"></div>', "<div data-an-ignore></div>"])(
    "ignores %s",
    (html) => {
      expect(
        element(html).matches(SESSION_REPLAY_DEFAULT_IGNORE_SELECTOR),
      ).toBe(true);
    },
  );

  it("masks text marked by class or attribute", () => {
    expect(
      element('<p class="an-mask"></p>').classList.contains(
        SESSION_REPLAY_DEFAULT_MASK_TEXT_CLASS,
      ),
    ).toBe(true);
    expect(
      element("<p data-an-mask></p>").matches(
        SESSION_REPLAY_DEFAULT_MASK_TEXT_SELECTOR,
      ),
    ).toBe(true);
  });
});
