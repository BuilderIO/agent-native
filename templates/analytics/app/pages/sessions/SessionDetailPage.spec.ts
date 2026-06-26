import { describe, expect, it } from "vitest";

import { sanitizeReplayEvents } from "./SessionDetailPage";

describe("session replay sanitization", () => {
  it("strips live-loading resource attributes from replay snapshots", () => {
    const [event] = sanitizeReplayEvents([
      {
        type: 2,
        timestamp: 1000,
        data: {
          node: {
            type: 2,
            tagName: "body",
            attributes: { class: "page" },
            childNodes: [
              {
                type: 2,
                tagName: "img",
                attributes: {
                  alt: "Hero",
                  src: "https://cdn.example.test/hero.png",
                  srcset: "https://cdn.example.test/hero-2x.png 2x",
                  style:
                    "background-image: url(https://cdn.example.test/bg.png)",
                  onclick: "steal()",
                },
                childNodes: [],
              },
              {
                type: 2,
                tagName: "a",
                attributes: {
                  href: "https://example.test/account",
                  title: "Account",
                },
                childNodes: [],
              },
              {
                type: 2,
                tagName: "script",
                attributes: { src: "https://cdn.example.test/app.js" },
                childNodes: [],
              },
            ],
          },
        },
      },
    ]);

    expect(event?.data.node.childNodes[0].attributes).toEqual({ alt: "Hero" });
    expect(event?.data.node.childNodes[1].attributes).toEqual({
      title: "Account",
    });
    expect(event?.data.node.childNodes[2]).toMatchObject({
      tagName: "noscript",
      attributes: {},
      childNodes: [],
    });
  });

  it("strips live-loading attributes from replay mutation patches", () => {
    const [event] = sanitizeReplayEvents([
      {
        type: 3,
        timestamp: 1000,
        data: {
          source: 0,
          attributes: [
            {
              id: 1,
              attributes: {
                class: "avatar",
                src: "https://cdn.example.test/avatar.png",
                style: "color: red",
                href: "https://example.test/profile",
              },
            },
          ],
          adds: [
            {
              parentId: 1,
              nextId: null,
              node: {
                type: 2,
                tagName: "iframe",
                attributes: {
                  src: "https://evil.example.test/frame",
                  srcdoc: "<script>alert(1)</script>",
                  title: "Preview",
                },
                childNodes: [],
              },
            },
          ],
        },
      },
    ]);

    expect(event?.data.attributes[0].attributes).toEqual({
      class: "avatar",
      style: "color: red",
    });
    expect(event?.data.adds[0].node.attributes).toEqual({ title: "Preview" });
  });

  it("strips stylesheet text that can trigger external replay fetches", () => {
    const [event] = sanitizeReplayEvents([
      {
        type: 2,
        timestamp: 1000,
        data: {
          node: {
            type: 2,
            tagName: "body",
            attributes: {},
            childNodes: [
              {
                type: 2,
                tagName: "style",
                attributes: { nonce: "replay" },
                childNodes: [
                  {
                    type: 3,
                    textContent:
                      '@import "https://evil.example.test/app.css"; body { background: url(https://evil.example.test/bg.png); }',
                  },
                ],
              },
            ],
          },
        },
      },
    ]);

    expect(event?.data.node.childNodes[0]).toMatchObject({
      tagName: "style",
      attributes: { nonce: "replay" },
      childNodes: [],
    });
  });

  it("strips replay text mutations that can inject stylesheet fetches", () => {
    const [event] = sanitizeReplayEvents([
      {
        type: 3,
        timestamp: 1000,
        data: {
          source: 0,
          texts: [
            {
              id: 10,
              value:
                '@import "https://evil.example.test/app.css"; .x { background: url(https://evil.example.test/bg.png); }',
            },
            { id: 11, value: "Normal page copy" },
          ],
        },
      },
    ]);

    expect(event?.data.texts[0].value).toBe("");
    expect(event?.data.texts[1].value).toBe("Normal page copy");
  });
});
