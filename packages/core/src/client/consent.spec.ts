import { afterEach, describe, expect, it, vi } from "vitest";

const consentStateKey = Symbol.for("agent-native.client.consent");

function installBrowser({
  timeZone = "America/Los_Angeles",
  region = "unknown",
}: { timeZone?: string; region?: string } = {}) {
  const realOptions = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...realOptions,
    timeZone,
  });
  const cookies = new Map<string, string>();
  const session = new Map<string, string>();
  const windowMock: Record<string, unknown> = {
    location: { hostname: "clips.agent-native.com" },
    sessionStorage: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => session.set(key, value),
    },
  };
  vi.stubGlobal("window", windowMock);
  vi.stubGlobal("document", {
    get cookie() {
      return [...cookies.values()].map((c) => c.split(";", 1)[0]).join("; ");
    },
    set cookie(value: string) {
      cookies.set(value.slice(0, value.indexOf("=")), value);
    },
  });
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ region })));
  vi.stubGlobal("fetch", fetchMock);
  return { windowMock, fetchMock, session };
}

async function freshConsent() {
  vi.resetModules();
  return import("./consent.js");
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("client consent", () => {
  afterEach(() => {
    delete (globalThis as any)[consentStateKey];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("runs at once outside the consent region, with no banner", async () => {
    installBrowser({ region: "none" });
    const { whenConsentAllows, resolveConsentRegion, shouldShowConsentBanner } =
      await freshConsent();
    const run = vi.fn();

    whenConsentAllows("performance", run);
    expect(await resolveConsentRegion()).toBe("none");

    expect(run).toHaveBeenCalledTimes(1);
    expect(shouldShowConsentBanner()).toBe(false);
  });

  it("trusts the server's country over a time zone outside the region", async () => {
    const { session } = installBrowser({ region: "consent" });
    const consent = await freshConsent();
    const run = vi.fn();

    consent.whenConsentAllows("performance", run);
    expect(await consent.resolveConsentRegion()).toBe("consent");

    expect(run).not.toHaveBeenCalled();
    expect(consent.shouldShowConsentBanner()).toBe(true);
    expect(session.get("an_consent_region")).toBe("consent");
  });

  it("falls back to the time zone when the server can't tell", async () => {
    installBrowser({ timeZone: "Europe/Paris" });
    const { resolveConsentRegion } = await freshConsent();
    expect(await resolveConsentRegion()).toBe("consent");
  });

  it("runs accepted categories, and revokes them on a later reject", async () => {
    installBrowser({ region: "consent" });
    const consent = await freshConsent();
    const performance = vi.fn();
    const targeting = vi.fn();
    const revoke = vi.fn();
    consent.whenConsentAllows("performance", performance);
    consent.whenConsentAllows("targeting", targeting, { revoke });
    await consent.resolveConsentRegion();

    consent.setConsentChoice({ performance: true, targeting: false });
    expect(performance).toHaveBeenCalledTimes(1);
    expect(targeting).not.toHaveBeenCalled();
    expect(consent.shouldShowConsentBanner()).toBe(false);
    expect(consent.getConsentChoice()).toEqual({
      performance: true,
      targeting: false,
    });

    consent.setConsentChoice({ performance: true, targeting: true });
    expect(targeting).toHaveBeenCalledTimes(1);
    revoke.mockClear();
    consent.setConsentChoice({ performance: true, targeting: false });
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("asks the server to keep the choice for a year", async () => {
    const { fetchMock } = installBrowser({ region: "consent" });
    const consent = await freshConsent();

    consent.setConsentChoice({ performance: false, targeting: true });

    const call = (
      fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    ).find(([url]) => String(url).includes("/_agent-native/auth/consent"));
    expect(call?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
    });
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ choice: "1.p0.t1" });
  });

  it("runs scripts the page queued before the module loaded", async () => {
    const { windowMock } = installBrowser({ region: "none" });
    const queued = vi.fn();
    windowMock.__AN_CONSENT_QUEUE__ = [["performance", queued]];
    await freshConsent();
    await tick();

    expect(queued).toHaveBeenCalledTimes(1);
    const later = vi.fn();
    (windowMock.__AN_CONSENT_QUEUE__ as { push: Function }).push([
      "targeting",
      later,
    ]);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("reopens the banner from the settings link", async () => {
    installBrowser({ region: "none" });
    const consent = await freshConsent();
    const listener = vi.fn();
    consent.subscribeConsent(listener);

    consent.openConsentSettings();

    expect(consent.shouldShowConsentBanner()).toBe(true);
    expect(listener).toHaveBeenCalled();
  });
});
