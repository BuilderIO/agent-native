import { describe, expect, it } from "vitest";

import {
  EMBED_SESSION_EXPIRED_MESSAGE,
  isEmbedSessionExpiredMessage,
} from "./embed-session-recovery";

const frameWindow = {} as Window;
const frame = {
  contentWindow: frameWindow,
  src: "https://mail.example.test/_agent-native/embed/start?ticket=one",
} as HTMLIFrameElement;

describe("isEmbedSessionExpiredMessage", () => {
  it("accepts a message from the active app frame", () => {
    expect(
      isEmbedSessionExpiredMessage(
        { data: { type: EMBED_SESSION_EXPIRED_MESSAGE }, source: frameWindow },
        frame,
      ),
    ).toBe(true);
  });

  it("rejects messages from another frame", () => {
    expect(
      isEmbedSessionExpiredMessage(
        { data: { type: EMBED_SESSION_EXPIRED_MESSAGE }, source: {} as Window },
        frame,
      ),
    ).toBe(false);
  });

  it("accepts a matching start URL when the browser omits event.source", () => {
    expect(
      isEmbedSessionExpiredMessage(
        {
          data: {
            type: EMBED_SESSION_EXPIRED_MESSAGE,
            embedStartUrl: frame.src,
          },
          source: null,
        },
        frame,
      ),
    ).toBe(true);
  });

  it("can match the expected URL before the iframe ref is available", () => {
    expect(
      isEmbedSessionExpiredMessage(
        {
          data: {
            type: EMBED_SESSION_EXPIRED_MESSAGE,
            embedStartUrl: frame.src,
          },
          source: null,
        },
        null,
        frame.src,
      ),
    ).toBe(true);
  });
});
