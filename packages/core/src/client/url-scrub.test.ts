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

  it("redacts sensitive parameters before a question mark in parameter fragments", () => {
    const url =
      "https://app.agent-native.com/auth#token=secret&return=/inbox?tab=1";

    const scrubbed = scrubUrl(url);

    expect(scrubbed).toContain("#token=%3Credacted%3E");
    expect(scrubbed).not.toContain("token=secret");
  });

  it("redacts sensitive queries when a hash route prefix contains an equals sign", () => {
    const url = "https://app.agent-native.com/auth#/verify=legacy?token=secret";

    const scrubbed = scrubUrl(url);

    expect(scrubbed).toBe(
      "https://app.agent-native.com/auth#/verify=legacy?token=%3Credacted%3E",
    );
    expect(scrubbed).not.toContain("secret");
  });

  it.each([
    [
      "https://app.agent-native.com/auth#/verify&token=secret?step=1",
      "https://app.agent-native.com/auth#/verify&token=%3Credacted%3E?step=1",
    ],
    [
      "https://app.agent-native.com/auth#/verify&token=secret",
      "https://app.agent-native.com/auth#/verify&token=%3Credacted%3E",
    ],
    [
      "https://app.agent-native.com/auth#verify&token=secret",
      "https://app.agent-native.com/auth#verify&token=%3Credacted%3E",
    ],
    [
      "https://app.agent-native.com/auth#return=/inbox&code=secret?x=1",
      "https://app.agent-native.com/auth#return=/inbox&code=%3Credacted%3E?x=1",
    ],
  ])("redacts sensitive parameters in hash route prefixes", (url, expected) => {
    const scrubbed = scrubUrl(url);

    expect(scrubbed).toBe(expected);
    expect(scrubbed).not.toContain("secret");
  });

  it.each([
    "https://app.agent-native.com/auth#/verify%3Ftoken%3Dsecret",
    "https://app.agent-native.com/auth#/verify%253Ftoken%253Dsecret",
  ])("redacts ambiguous encoded hash route queries", (url) => {
    const scrubbed = scrubUrl(url);

    expect(scrubbed).toContain("#%3Credacted%3E");
    expect(scrubbed).not.toContain("secret");
  });

  it("does not treat a sensitive parameter value as a hash route", () => {
    const url = "https://app.agent-native.com/auth#token=/inbox?tab=1";

    expect(scrubUrl(url)).toBe(
      "https://app.agent-native.com/auth#token=%3Credacted%3E",
    );
  });

  it.each([
    "https://app.agent-native.com/auth#return=/inbox?token=secret",
    "https://app.agent-native.com/auth#return=%2Finbox%3Ftoken%3Dsecret",
    "https://app.agent-native.com/auth#return=%252Finbox%253Ftoken%253Dsecret",
    "https://app.agent-native.com/auth#return=%252Finbox%253F%252574oken%253Dsecret",
  ])("redacts a sensitive query nested inside a hash parameter", (url) => {
    const scrubbed = scrubUrl(url);

    expect(scrubbed).not.toContain("secret");
    expect(scrubbed).toContain("return=");
  });

  it("redacts nested URLs that exceed the decoding bound", () => {
    let nestedUrl = "/inbox?token=secret";
    for (let depth = 0; depth < 9; depth += 1) {
      nestedUrl = encodeURIComponent(nestedUrl);
    }

    const scrubbed = scrubUrl(
      `https://app.agent-native.com/auth#return=${nestedUrl}`,
    );

    expect(scrubbed).toContain("return=%3Credacted%3E");
    expect(scrubbed).not.toContain("secret");
  });

  it("preserves a nested hash parameter when its query has no sensitive keys", () => {
    const url = "https://app.agent-native.com/auth#return=/inbox?tab=1";

    expect(scrubUrl(url)).toBe(url);
  });

  it("normalizes configured sensitive parameter aliases", () => {
    const url = "https://app.agent-native.com/sign-in?accessToken=secret";

    expect(scrubUrl(url, ["access_token"])).toBe(
      "https://app.agent-native.com/sign-in?accessToken=%3Credacted%3E",
    );
  });

  it.each([
    "https://app.agent-native.com/auth#/verify&tab=1?step=2",
    "https://app.agent-native.com/auth#/verify&tab=1",
    "https://app.agent-native.com/auth#verify&tab=1",
    "https://app.agent-native.com/auth#return=/inbox&tab=1?step=2",
  ])("preserves non-sensitive hash route prefix parameters", (url) => {
    expect(scrubUrl(url)).toBe(url);
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
