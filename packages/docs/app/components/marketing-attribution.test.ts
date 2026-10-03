// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  appendFirstTouchAttribution,
  appendSiteHandoff,
  installAppLinkAttribution,
  isFirstPartyAppHost,
} from "./marketing-attribution";

describe("appendFirstTouchAttribution", () => {
  it("passes first-touch referral fields to the app URL", () => {
    const target = appendFirstTouchAttribution(
      "https://clips.agent-native.com",
      {
        ref: "newsletter",
        via: "owner_42",
        utm_source: "email",
        utm_medium: "lifecycle",
        utm_campaign: "launch",
      },
    );

    const url = new URL(target);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ref: "newsletter",
      via: "owner_42",
      utm_source: "email",
      utm_medium: "lifecycle",
      utm_campaign: "launch",
    });
  });

  it("preserves explicit destination attribution values", () => {
    const target = appendFirstTouchAttribution(
      "https://clips.agent-native.com/?utm_source=destination",
      { utm_source: "first-touch", utm_campaign: "launch" },
    );

    const url = new URL(target);
    expect(url.searchParams.get("utm_source")).toBe("destination");
    expect(url.searchParams.get("utm_campaign")).toBe("launch");
  });

  it("leaves invalid URLs unchanged", () => {
    expect(
      appendFirstTouchAttribution("not a URL", { utm_source: "email" }),
    ).toBe("not a URL");
  });
});

describe("isFirstPartyAppHost", () => {
  it("matches app subdomains, including beta apps", () => {
    expect(isFirstPartyAppHost("design.agent-native.com")).toBe(true);
    expect(isFirstPartyAppHost("beta.slides.agent-native.com")).toBe(true);
    expect(isFirstPartyAppHost("Clips.Agent-Native.com.")).toBe(true);
  });

  it("skips the marketing site and other domains", () => {
    expect(isFirstPartyAppHost("agent-native.com")).toBe(false);
    expect(isFirstPartyAppHost("www.agent-native.com")).toBe(false);
    expect(isFirstPartyAppHost("beta.agent-native.com")).toBe(false);
    expect(isFirstPartyAppHost("builder.io")).toBe(false);
    expect(isFirstPartyAppHost("evil-agent-native.com")).toBe(false);
  });
});

describe("appendSiteHandoff", () => {
  it("forwards where the visitor reached the site from", () => {
    const target = appendSiteHandoff(
      "https://design.agent-native.com/",
      {
        ref: "alice",
        landing_path: "/apps/design",
        landing_referrer: "github.com",
      },
      "/apps",
    );

    expect(Object.fromEntries(new URL(target).searchParams)).toEqual({
      ref: "alice",
      site_referrer: "github.com",
      site_landing_path: "/apps/design",
    });
  });

  it("marks a sourceless visitor as coming through the site", () => {
    const target = appendSiteHandoff(
      "https://mail.agent-native.com/inbox",
      null,
      "/docs/template-mail",
    );

    expect(Object.fromEntries(new URL(target).searchParams)).toEqual({
      site_landing_path: "/docs/template-mail",
    });
  });

  it("keeps values already on the link", () => {
    const target = appendSiteHandoff(
      "https://mail.agent-native.com/?site_referrer=youtube.com",
      { landing_referrer: "github.com", landing_path: "/" },
      "/",
    );

    expect(new URL(target).searchParams.get("site_referrer")).toBe(
      "youtube.com",
    );
  });
});

describe("installAppLinkAttribution", () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  function click(link: HTMLAnchorElement, type = "click") {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    // jsdom cannot navigate; stop after every document listener has run.
    window.addEventListener(type, (e) => e.preventDefault(), { once: true });
    link.dispatchEvent(event);
  }

  function linkTo(href: string): HTMLAnchorElement {
    const link = document.createElement("a");
    link.href = href;
    document.body.append(link);
    return link;
  }

  it("decorates app links when they are followed", () => {
    localStorage.setItem(
      "an_attribution",
      JSON.stringify({
        utm_source: "youtube",
        landing_path: "/",
        landing_referrer: "www.youtube.com",
      }),
    );
    uninstall = installAppLinkAttribution();
    const link = linkTo("https://clips.agent-native.com/");

    click(link, "auxclick");

    expect(Object.fromEntries(new URL(link.href).searchParams)).toEqual({
      utm_source: "youtube",
      site_referrer: "www.youtube.com",
      site_landing_path: "/",
    });
  });

  it("leaves links to the site and other domains alone", () => {
    uninstall = installAppLinkAttribution();
    const docs = linkTo("https://www.agent-native.com/docs");
    const github = linkTo("https://github.com/BuilderIO/agent-native");

    click(docs);
    click(github);

    expect(docs.href).toBe("https://www.agent-native.com/docs");
    expect(github.href).toBe("https://github.com/BuilderIO/agent-native");
  });

  it("decorates an href a click handler rebuilt", () => {
    uninstall = installAppLinkAttribution();
    const link = linkTo("https://slides.agent-native.com/");
    link.addEventListener("click", () => {
      link.href = "https://slides.agent-native.com/?initialPrompt=deck";
    });

    click(link);

    const params = new URL(link.href).searchParams;
    expect(params.get("initialPrompt")).toBe("deck");
    expect(params.get("site_landing_path")).toBe("/");
  });
});
