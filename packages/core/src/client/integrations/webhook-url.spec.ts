import { describe, expect, it } from "vitest";

import { isNonPublicWebhookUrl } from "./webhook-url.js";

const P = "/_agent-native/integrations/slack/webhook";

describe("isNonPublicWebhookUrl", () => {
  it("flags loopback and unspecified hosts", () => {
    for (const origin of [
      "http://localhost:8101",
      "https://localhost:8101",
      "https://app.localhost:8101",
      "http://127.0.0.1:8101",
      "https://127.0.0.1:8101",
      "https://127.1.2.3:8101",
      "http://[::1]:8101",
      "https://[::1]:8101",
      "https://[::]:8101",
      "http://0.0.0.0:8101",
      "https://0.0.0.0:8101",
    ]) {
      expect(isNonPublicWebhookUrl(`${origin}${P}`), origin).toBe(true);
    }
  });

  it("flags mDNS and private LAN hosts", () => {
    for (const origin of [
      "https://steves-laptop.local:8101",
      "https://10.0.0.7:8101",
      "https://192.168.1.42:8101",
      "https://172.16.0.5:8101",
      "https://172.31.255.254:8101",
      "https://169.254.10.10:8101",
    ]) {
      expect(isNonPublicWebhookUrl(`${origin}${P}`), origin).toBe(true);
    }
  });

  it("flags plain-http origins even on public hosts", () => {
    expect(isNonPublicWebhookUrl(`http://app.example.com${P}`)).toBe(true);
  });

  it("accepts public https origins, including near-miss private ranges", () => {
    for (const origin of [
      "https://app.example.com",
      "https://app.example.com:8443",
      "https://tunnel-1234.example-tunnel.dev",
      "https://172.15.0.1",
      "https://172.32.0.1",
      "https://10a.example.com",
      "https://localhost.example.com",
      "https://notlocal.example.com",
    ]) {
      expect(isNonPublicWebhookUrl(`${origin}${P}`), origin).toBe(false);
    }
  });

  it("leaves unparseable values alone rather than guessing", () => {
    expect(isNonPublicWebhookUrl("")).toBe(false);
    expect(isNonPublicWebhookUrl(P)).toBe(false);
  });
});
