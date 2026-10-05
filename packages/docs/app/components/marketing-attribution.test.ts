// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("passes ad click ids to the app URL", () => {
    const target = appendFirstTouchAttribution(
      "https://clips.agent-native.com",
      { gclid: "g-1", msclkid: "m-1", vector_source: "v-1" },
    );

    expect(Object.fromEntries(new URL(target).searchParams)).toEqual({
      gclid: "g-1",
      msclkid: "m-1",
      vector_source: "v-1",
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

  it("forwards a later visit with a source as last touch", () => {
    const firstTouch = {
      utm_source: "google",
      landing_path: "/",
      landing_referrer: "www.google.com",
      landed_at: "2026-09-20T00:00:00.000Z",
    };
    const target = appendSiteHandoff(
      "https://plan.agent-native.com/",
      firstTouch,
      "/apps/plan",
      {
        ref: "steve",
        utm_medium: "video",
        landing_referrer: "www.youtube.com",
        touched_at: "2026-10-01T00:00:00.000Z",
      },
    );

    expect(Object.fromEntries(new URL(target).searchParams)).toEqual({
      utm_source: "google",
      site_referrer: "www.google.com",
      site_landing_path: "/",
      last_ref: "steve",
      last_utm_medium: "video",
      last_referrer: "www.youtube.com",
      last_at: "2026-10-01T00:00:00.000Z",
    });

    const sameVisit = appendSiteHandoff(
      "https://plan.agent-native.com/",
      firstTouch,
      "/apps/plan",
      { utm_source: "google", touched_at: firstTouch.landed_at },
    );
    const sameParams = new URL(sameVisit).searchParams;
    expect(sameParams.has("last_utm_source")).toBe(false);
    // The app still learns when that visit was, to compare with its own.
    expect(sameParams.get("last_at")).toBe(firstTouch.landed_at);
  });

  it("forwards an ad click id from a later visit", () => {
    const target = appendSiteHandoff(
      "https://plan.agent-native.com/",
      { landing_path: "/", landed_at: "2026-09-20T00:00:00.000Z" },
      "/",
      {
        gclid: "g-2",
        utm_term: "agents",
        touched_at: "2026-10-01T00:00:00.000Z",
      },
    );

    const params = new URL(target).searchParams;
    expect(params.get("last_gclid")).toBe("g-2");
    expect(params.get("last_utm_term")).toBe("agents");
  });
});

describe("installAppLinkAttribution", () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    document.body.innerHTML = "";
    localStorage.clear();
    history.replaceState(null, "", "/");
    delete (document as { referrer?: string }).referrer;
  });

  /** Returns the href the browser would follow, read after every listener. */
  function click(link: HTMLAnchorElement, type = "click", button = 0) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button,
    });
    let followed = "";
    // jsdom cannot navigate; stop after every document listener has run.
    window.addEventListener(
      type,
      (e) => {
        followed = link.href;
        e.preventDefault();
      },
      { once: true },
    );
    link.dispatchEvent(event);
    return followed;
  }

  const nextTask = () => new Promise((resolve) => setTimeout(resolve));

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

    const followed = click(link, "auxclick", 1);

    expect(Object.fromEntries(new URL(followed).searchParams)).toEqual({
      utm_source: "youtube",
      site_referrer: "www.youtube.com",
      site_landing_path: "/",
    });
  });

  it("puts the clean link back once the click is followed", async () => {
    localStorage.setItem(
      "an_attribution",
      JSON.stringify({ ref: "alice", landing_path: "/" }),
    );
    uninstall = installAppLinkAttribution();
    const link = linkTo("https://clips.agent-native.com/");

    const followed = click(link);
    await nextTask();

    expect(new URL(followed).searchParams.get("ref")).toBe("alice");
    // Copying the link afterwards must not share this visitor's source.
    expect(link.href).toBe("https://clips.agent-native.com/");
  });

  it("ignores the right mouse button", async () => {
    localStorage.setItem(
      "an_attribution",
      JSON.stringify({ ref: "alice", landing_path: "/" }),
    );
    uninstall = installAppLinkAttribution();
    const link = linkTo("https://clips.agent-native.com/");

    const followed = click(link, "auxclick", 2);

    expect(followed).toBe("https://clips.agent-native.com/");
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

  it("decorates an href a click handler rebuilt", async () => {
    uninstall = installAppLinkAttribution();
    const link = linkTo("https://slides.agent-native.com/");
    link.addEventListener("click", () => {
      link.href = "https://slides.agent-native.com/?initialPrompt=deck";
    });

    const followed = click(link);
    await nextTask();

    const params = new URL(followed).searchParams;
    expect(params.get("initialPrompt")).toBe("deck");
    expect(params.get("site_landing_path")).toBe("/");
    // Only our own parameters come off; the handler's rebuild stays.
    expect(link.href).toBe(
      "https://slides.agent-native.com/?initialPrompt=deck",
    );
  });

  it("keeps the source when a React click handler rebuilds the link", () => {
    localStorage.setItem(
      "an_attribution",
      JSON.stringify({ utm_source: "youtube", landing_path: "/" }),
    );
    uninstall = installAppLinkAttribution();
    // hydrateRoot(document) delegates React's onClick to the document, after
    // this listener installed. SlidesTryNow rebuilds its href there.
    const reactRoot = (event: Event) => {
      const link = (event.target as Element).closest("a")!;
      link.href = "https://slides.agent-native.com/?initialPrompt=deck";
    };
    document.addEventListener("click", reactRoot);
    const link = linkTo("https://slides.agent-native.com/?initialPrompt=");

    try {
      const params = new URL(click(link)).searchParams;
      expect(params.get("initialPrompt")).toBe("deck");
      expect(params.get("utm_source")).toBe("youtube");
      expect(params.get("site_landing_path")).toBe("/");
    } finally {
      document.removeEventListener("click", reactRoot);
    }
  });

  it("forwards the current page's source before tracking starts", async () => {
    history.replaceState(null, "", "/templates/slides?utm_source=x&gclid=g-1");
    Object.defineProperty(document, "referrer", {
      value: "https://www.youtube.com/watch?v=abc",
      configurable: true,
    });
    // A fresh page load, where nothing has captured the first touch yet.
    vi.resetModules();
    const fresh = await import("./marketing-attribution");
    uninstall = fresh.installAppLinkAttribution();
    const link = linkTo("https://slides.agent-native.com/");

    const followed = click(link);

    expect(Object.fromEntries(new URL(followed).searchParams)).toEqual({
      utm_source: "x",
      gclid: "g-1",
      site_referrer: "www.youtube.com",
      site_landing_path: "/templates/slides",
      // This visit is also the last touch, so only its time goes along.
      last_at: expect.any(String),
    });
  });
});
