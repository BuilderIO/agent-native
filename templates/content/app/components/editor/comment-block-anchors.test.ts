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

import { LEGACY_VIDEO_COMMENT_QUOTES } from "./comment-block-anchors";

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
