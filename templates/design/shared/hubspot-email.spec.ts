import { describe, expect, it } from "vitest";

import { createHubSpotEmailHtml, isHubSpotEmailHtml } from "./hubspot-email.js";

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

  it("rejects ordinary metadata", () => {
    const source = documentWithHead(
      '<meta name="viewport" content="width=600">',
    );
    expect(isHubSpotEmailHtml(source)).toBe(false);
  });
});
