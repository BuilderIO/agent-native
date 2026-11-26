import { describe, expect, it } from "vitest";

import "../i18n/ar-SA";
import "../i18n/de-DE";
import "../i18n/es-ES";
import "../i18n/fr-FR";
import "../i18n/hi-IN";
import "../i18n/ja-JP";
import "../i18n/ko-KR";
import "../i18n/pt-BR";
import "../i18n/zh-CN";
import "../i18n/zh-TW";
import { messagesByLocale } from "../i18n-data";
import { workspaceReferenceErrorMessage } from "./content-action-errors";

describe("protected workspace reference errors", () => {
  it("uses each registered locale instead of the server message", () => {
    const error = Object.assign(new Error("server text"), {
      errorCode: "WORKSPACE_CATALOG_REFERENCE_PROTECTED",
    });
    const english =
      messagesByLocale["en-US"].sidebar.workspaceReferenceProtected;
    expect(Object.keys(messagesByLocale)).toHaveLength(11);
    for (const messages of Object.values(messagesByLocale)) {
      const translated = messages.sidebar.workspaceReferenceProtected;
      expect(workspaceReferenceErrorMessage(error, translated)).toBe(
        translated,
      );
    }
    for (const [, messages] of Object.entries(messagesByLocale).filter(
      ([locale]) => locale !== "en-US",
    )) {
      expect(messages.sidebar.workspaceReferenceProtected).not.toBe(english);
    }
    expect(messagesByLocale["fr-FR"]?.sidebar.workspaceReferenceProtected).toBe(
      "Les références aux espaces de travail sont protégées et ne peuvent pas être modifiées comme des pages.",
    );
  });

  it("leaves other errors to their existing handlers", () => {
    expect(
      workspaceReferenceErrorMessage(new Error("other"), "localized"),
    ).toBeUndefined();
    expect(workspaceReferenceErrorMessage(null, "localized")).toBeUndefined();
  });
});
