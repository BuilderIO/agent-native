// @vitest-environment happy-dom

import { nfmQuoteAnchor } from "@shared/comment-quote-anchor";
import { nfmToDoc } from "@shared/nfm";
import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import arSA from "@/i18n/ar-SA";
import deDE from "@/i18n/de-DE";
import enUS from "@/i18n/en-US";
import esES from "@/i18n/es-ES";
import frFR from "@/i18n/fr-FR";
import hiIN from "@/i18n/hi-IN";
import jaJP from "@/i18n/ja-JP";
import koKR from "@/i18n/ko-KR";
import ptBR from "@/i18n/pt-BR";
import zhCN from "@/i18n/zh-CN";
import zhTW from "@/i18n/zh-TW";

import { resolveAnchor } from "./comment-anchors";
import {
  commentThreadAt,
  commentThreadHoverHandlers,
  LEGACY_VIDEO_COMMENT_QUOTES,
  threadCommentBlock,
} from "./comment-block-anchors";

describe("comments from before videos had ids", () => {
  it("knows the video label each language quoted", () => {
    const catalogs = [
      enUS,
      arSA,
      deDE,
      esES,
      frFR,
      hiIN,
      jaJP,
      koKR,
      ptBR,
      zhCN,
      zhTW,
    ];
    for (const messages of catalogs) {
      expect(LEGACY_VIDEO_COMMENT_QUOTES).toContain(
        messages.editor.media.video,
      );
    }
  });
});

describe("the block a thread is on", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*" },
      video: {
        group: "block",
        atom: true,
        attrs: { src: { default: null }, blockId: { default: null } },
      },
      text: {},
    },
  });
  const page = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("Video notes")),
    schema.node("video", {
      src: "https://example.com/a.mp4",
      blockId: "video-only001",
    }),
  ]);
  const legacy = {
    quotedText: "Video",
    prefix: null,
    suffix: null,
    startOffset: null,
  };

  it("puts a thread from before videos had ids on the page's one video", () => {
    expect(threadCommentBlock(page, legacy)?.blockId).toBe("video-only001");
  });

  it("leaves a thread on the word Video in the text where it is", () => {
    expect(threadCommentBlock(page, { ...legacy, startOffset: 0 })).toBeNull();
  });

  it("keeps a thread add-comment starts on the word Video on that word", () => {
    const saved = nfmToDoc(
      'Video notes\n<video src="https://example.com/a.mp4" id="video-only001"></video>',
    );
    const thread = { quotedText: "Video", ...nfmQuoteAnchor(saved, "Video")! };
    expect(threadCommentBlock(page, thread)).toBeNull();
    expect(resolveAnchor(page, thread)).toEqual({ from: 1, to: 6 });
  });
});

describe("the thread under the pointer", () => {
  function page() {
    document.body.innerHTML = [
      '<p><span data-comment-thread="text">quoted</span> plain</p>',
      '<div data-comment-block-threads="first second"><video></video></div>',
    ].join("");
    return {
      quoted: document.querySelector("span")!,
      plain: document.querySelector("p")!,
      ring: document.querySelector("div")!,
      video: document.querySelector("video")!,
    };
  }

  it("is a highlight's thread, or on a video the open one of its threads", () => {
    const { quoted, plain, video } = page();
    expect(commentThreadAt(quoted)).toBe("text");
    expect(commentThreadAt(plain)).toBeNull();
    expect(commentThreadAt(video)).toBe("first");
    expect(commentThreadAt(video, "second")).toBe("second");
    expect(commentThreadAt(video, "text")).toBe("first");
  });

  it("fronts a video's thread while the pointer rests on the video", () => {
    const { plain, ring, video } = page();
    const hovered: Array<string | null> = [];
    const hover = commentThreadHoverHandlers("second", (threadId) =>
      hovered.push(threadId),
    );
    hover.onPointerOverCapture({ target: video });
    // Moving from the video onto its outline stays on the thread.
    hover.onPointerOutCapture({ target: video, relatedTarget: ring });
    hover.onPointerOutCapture({ target: ring, relatedTarget: plain });
    expect(hovered).toEqual(["second", null]);
  });
});
