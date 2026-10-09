import { describe, expect, it } from "vitest";

import { scrubUrl } from "./url-scrub";

describe("scrubUrl", () => {
  it("redacts local Plan bridge credentials carried in a fragment", () => {
    const url =
      "https://plan.agent-native.com/local-plans/local#bridge=http%3A%2F%2F127.0.0.1%3A58201%2Flocal-plan.json%3Ftoken%3Dsecret";

    const scrubbed = scrubUrl(url);

    expect(scrubbed).toBe(
      "https://plan.agent-native.com/local-plans/local#bridge=%3Credacted%3E",
    );
    expect(scrubbed).not.toContain("secret");
    expect(scrubbed).not.toContain("127.0.0.1");
  });

  it("preserves ordinary section anchors", () => {
    expect(scrubUrl("https://plan.agent-native.com/plans/123#overview")).toBe(
      "https://plan.agent-native.com/plans/123#overview",
    );
  });

  it("redacts sensitive query values inside hash routes", () => {
    const url = "https://app.agent-native.com/auth#/verify?token=secret&step=1";

    const scrubbed = scrubUrl(url);

    expect(scrubbed).toBe(
      "https://app.agent-native.com/auth#/verify?token=%3Credacted%3E&step=1",
    );
    expect(scrubbed).not.toContain("secret");
  });

  it("redacts Mail search terms from absolute and relative URLs", () => {
    const query = "private.sender@example.com";
    const absolute = scrubUrl(
      `https://mail.agent-native.com/all?q=${encodeURIComponent(query)}&tab=inbox`,
      ["q"],
    );
    const relative = scrubUrl(`/all?q=${encodeURIComponent(query)}`, ["q"]);

    expect(absolute).toBe(
      "https://mail.agent-native.com/all?q=%3Credacted%3E&tab=inbox",
    );
    expect(relative).toBe("/all?q=%3Credacted%3E");
    expect(absolute).not.toContain(query);
    expect(relative).not.toContain(encodeURIComponent(query));
  });

  it("redacts the signed agent_access token from pageview and replay URLs", () => {
    const secret = "signed.agent.token";
    const absolute = scrubUrl(
      `https://analytics.agent-native.com/sessions/rec_1?frame=1&agent_access=${secret}`,
    );
    const relative = scrubUrl(`/sessions/rec_1?agent_access=${secret}&frame=1`);

    expect(absolute).toBe(
      "https://analytics.agent-native.com/sessions/rec_1?frame=1&agent_access=%3Credacted%3E",
    );
    expect(relative).toBe(
      "/sessions/rec_1?agent_access=%3Credacted%3E&frame=1",
    );
    expect(`${absolute}${relative}`).not.toContain(secret);
  });

  it("leaves other apps' q parameters unchanged by default", () => {
    const url = "https://example.com/search?q=public-topic";
    expect(scrubUrl(url)).toBe(url);
  });
});
