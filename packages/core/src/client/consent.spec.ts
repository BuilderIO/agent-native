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
    await tick();

    const call = (
      fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    ).find(([url]) => String(url).includes("/_agent-native/auth/consent"));
    expect(call?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
    });
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ choice: "1.p0.t1" });
  });

  it("sends a later choice only after the earlier one is stored", async () => {
    const { fetchMock } = installBrowser({ region: "consent" });
    const consent = await freshConsent();
    const choiceBodies = () =>
      (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)
        .filter(([url]) => String(url).endsWith("/_agent-native/auth/consent"))
        .map(([, init]) => JSON.parse(String(init.body)).choice);
    let finishFirst!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (finishFirst = resolve)),
    );

    consent.setConsentChoice({ performance: true, targeting: true });
    await tick();
    consent.setConsentChoice({ performance: false, targeting: false });
    await tick();
    expect(choiceBodies()).toEqual(["1.p1.t1"]);

    finishFirst(new Response("{}"));
    await tick();
    expect(choiceBodies()).toEqual(["1.p1.t1", "1.p0.t0"]);
  });

  it("clears this page's copies when another app already stored a reject", async () => {
    const { session } = installBrowser();
    session.set("an_consent_region", "consent");
    document.cookie = "an_consent=1.p0.t0; path=/";
    const consent = await freshConsent();
    const run = vi.fn();
    const revoke = vi.fn();

    consent.whenConsentAllows("targeting", run, { optimistic: true, revoke });

    expect(run).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalled();
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

  it("tells Google's tags on the page about each choice", async () => {
    const { windowMock } = installBrowser({ region: "consent" });
    windowMock.__AN_CONSENT_LAYERS__ = ["dataLayer"];
    const consent = await freshConsent();
    const updates = () =>
      ((windowMock.dataLayer ?? []) as ArrayLike<unknown>[])
        .filter((entry) => entry[0] === "consent")
        .map((entry) => [entry[1], entry[2]]);

    await consent.resolveConsentRegion();
    consent.setConsentChoice({ performance: true, targeting: true });
    consent.setConsentChoice({ performance: false, targeting: false });

    const denied = {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    };
    expect(updates()).toEqual([
      ["update", denied],
      [
        "update",
        {
          analytics_storage: "granted",
          ad_storage: "granted",
          ad_user_data: "granted",
          ad_personalization: "granted",
        },
      ],
      ["update", denied],
    ]);
  });

  it("decides nothing on the time zone's guess alone", async () => {
    installBrowser({ region: "consent" });
    const consent = await freshConsent();

    expect(consent.consentAllowsNow("performance")).toBe(true);
    expect(consent.consentDecision("performance")).toBeNull();
    await consent.resolveConsentRegion();
    expect(consent.consentDecision("performance")).toBe(false);
  });

  it("applies a reject another tab stored when this one regains focus", async () => {
    const { windowMock } = installBrowser({ region: "none" });
    const listeners = new Map<string, () => void>();
    windowMock.addEventListener = (event: string, listener: () => void) =>
      listeners.set(event, listener);
    windowMock.removeEventListener = () => {};
    const consent = await freshConsent();
    const revoke = vi.fn();
    consent.whenConsentAllows("performance", () => {}, { revoke });
    await consent.resolveConsentRegion();
    expect(revoke).not.toHaveBeenCalled();

    // Another app on the site stores a reject.
    document.cookie = "an_consent=1.p0.t0; path=/";
    listeners.get("focus")!();

    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("holds a send until the region is known", async () => {
    const { windowMock } = installBrowser({ region: "consent" });
    windowMock.addEventListener = () => {};
    windowMock.removeEventListener = () => {};
    const consent = await freshConsent();
    const send = vi.fn();

    consent.whenConsentDecided(send);
    expect(send).not.toHaveBeenCalled();
    await consent.resolveConsentRegion();
    await tick();

    expect(send).toHaveBeenCalledWith(true);
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
