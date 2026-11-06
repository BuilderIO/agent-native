import { parse } from "parse5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHubSpotEmailHtml, isHubSpotEmailHtml } from "./hubspot-email.js";

vi.mock("parse5", async (importOriginal) => {
  const actual = await importOriginal<typeof import("parse5")>();
  return { ...actual, parse: vi.fn(actual.parse) };
});

const MARKER = '<meta name="agent-native:frame-type" content="hubspot-email">';

function documentWithHead(head: string, body = "Ordinary frame") {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

describe("HubSpot email frame classification", () => {
  it("recognizes the authored email document", () => {
    expect(isHubSpotEmailHtml(createHubSpotEmailHtml())).toBe(true);
  });

  it.each([
    MARKER,
    "<META content='HUBSPOT-EMAIL' name='AGENT-NATIVE:FRAME-TYPE'>",
    "<meta content=hubspot-email name=agent-native:frame-type>",
    '<meta name="agent-native&#58;frame-type" content="hubspot&#45;email">',
  ])("recognizes actual metadata with valid HTML attributes (%s)", (marker) => {
    expect(isHubSpotEmailHtml(documentWithHead(marker))).toBe(true);
  });

  it.each([
    `<!-- ${MARKER} -->`,
    `<script type="application/json">${JSON.stringify(MARKER)}</script>`,
    `<style>p::before { content: '${MARKER}'; }</style>`,
    `<title>${MARKER}</title>`,
    `<template>${MARKER}</template>`,
    `<meta name="description" content='${MARKER}'>`,
    '<meta name="description" name="agent-native:frame-type" content="hubspot-email">',
    "{{ \"<meta name='agent-native:frame-type' content='hubspot-email'>\" }}",
    "{{ \"}} <meta name='agent-native:frame-type' content='hubspot-email'>\" }}",
    String.raw`{{ "escaped \" }} <meta name='agent-native:frame-type' content='hubspot-email'>" }}`,
    `{{ '${MARKER}`,
  ])("does not classify inert marker lookalikes (%s)", (head) => {
    expect(isHubSpotEmailHtml(documentWithHead(head))).toBe(false);
  });

  it("requires the metadata to belong to the head", () => {
    expect(isHubSpotEmailHtml(documentWithHead("", MARKER))).toBe(false);
  });

  it("does not let HubL quoted defaults corrupt head parsing", () => {
    const head =
      '<meta name="description" content="{{ personalization_token("contact.firstname", "Hi > }} there") }}">' +
      MARKER;
    expect(isHubSpotEmailHtml(documentWithHead(head))).toBe(true);
  });

  it("classifies many unclosed HubL openers within the interaction budget", () => {
    const source = MARKER + "{{".repeat(40_000);
    const start = performance.now();
    expect(isHubSpotEmailHtml(source)).toBe(false);
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  it("rejects ordinary metadata", () => {
    const source = documentWithHead(
      '<meta name="viewport" content="width=600">',
    );
    expect(isHubSpotEmailHtml(source)).toBe(false);
  });

  describe("marker precheck", () => {
    beforeEach(() => {
      vi.mocked(parse).mockClear();
    });

    it("scans many unterminated meta tags in linear time", () => {
      const started = performance.now();
      expect(isHubSpotEmailHtml(`${"<meta ".repeat(200_000)}&`)).toBe(false);
      expect(performance.now() - started).toBeLessThan(500);
      expect(parse).not.toHaveBeenCalled();
    });

    it("skips the parse for a document that never names the marker", () => {
      const body = '<div data-agent-native-locked="true">Row</div>'.repeat(
        5_000,
      );
      expect(isHubSpotEmailHtml(documentWithHead("", body))).toBe(false);
      expect(parse).not.toHaveBeenCalled();
    });

    it.each([
      MARKER,
      '<meta name="agent-native&#58;frame-type" content="hubspot-email">',
      '<meta name="Agent-Native&colon;Frame-Type" content="hubspot-email">',
      '<meta name="&#97;gent-native:frame-type" content="hubspot-email">',
      '<meta name="agent-native:frame&#x2D;type" content="hubspot-email">',
    ])("parses when the marker name is spelled %s", (marker) => {
      expect(isHubSpotEmailHtml(documentWithHead(marker))).toBe(true);
      expect(parse).toHaveBeenCalledTimes(1);
    });
  });
});
