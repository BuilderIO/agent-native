import { describe, expect, it } from "vitest";

import {
  CHAT_DOCUMENT_ATTACHMENT_ACCEPT,
  PROMPT_DOCUMENT_ATTACHMENT_ACCEPT,
} from "./attachment-accept.js";

describe("attachment accept lists", () => {
  it("keeps SVGs out of standalone prompt composer document uploads", () => {
    const accept = PROMPT_DOCUMENT_ATTACHMENT_ACCEPT.split(",");

    expect(accept).not.toContain("image/svg+xml");
    expect(accept).not.toContain(".svg");
  });

  it("allows SVGs in the main chat document upload path", () => {
    const accept = CHAT_DOCUMENT_ATTACHMENT_ACCEPT.split(",");

    expect(accept).toContain("image/svg+xml");
    expect(accept).toContain(".svg");
  });
});
