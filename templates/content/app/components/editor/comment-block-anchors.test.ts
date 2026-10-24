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

import {
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
});
