/**
 * Cross-surface sign-in matrix — the request-level half.
 *
 * The reason the login reports never stopped is that every fix was verified on
 * exactly one surface. This file is the table that makes that impossible: one
 * row per surface the framework actually ships, each asserting the same four
 * invariants, plus the surface-specific completion helper that decides where
 * that surface lands.
 *
 * The four invariants, per surface:
 *   A. an anonymous visitor to a protected route gets a sign-in href under
 *      this app's base path carrying an opaque continuation for THAT route;
 *   B. arriving at sign-in with that continuation resumes the exact route —
 *      never the app root;
 *   C. an already-signed-in visitor at an auth entry path gets
 *      `signInHref: null` and a resume target that is not an auth entry path,
 *      so there is nothing to loop on;
 *   D. a forged continuation cannot nest, cannot leave the origin, and cannot
 *      escape the base path into a sibling app on the same host.
 *
 * Every row is ALSO evaluated against the runtime extracted from the real
 * rendered login document, and the two answers must be identical. That
 * equality check is the drift detector: the original bug was a second login
 * document whose completion disagreed with the module, and no test compared
 * them.
 *
 * Browser-driven coverage (real dev server, real form, real hydration) for the
 * root deploy, the `/chatapp` base-path deploy, and a genuinely cross-origin
 * iframe lives in `scripts/qa-sign-in-matrix-smoke.ts` (`pnpm qa:sign-in`).
 * The surfaces here that a headless browser cannot reproduce — a separate
 * Electron cookie jar, a custom-scheme deep link, an opaque-origin MCP frame —
 * are asserted against the shipped code rather than mimed.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  decodeContinuation,
  encodeContinuation,
  normalizeAppPath,
  signInJourney,
  SIGN_IN_ENTRY_PATH,
  SIGN_IN_LEGACY_ENTRY_PATH,
} from "../shared/sign-in-journey.js";
import { safeReturnPath } from "./auth.js";
import { normalizeEmbedTargetPath } from "./embed-session.js";
import { appendSessionToOAuthReturnUrl } from "./oauth-return-url.js";
import { getOnboardingHtml } from "./onboarding-html.js";

interface JourneyRuntime {
  normalizeAppPath: (raw: string | null | undefined) => string | null;
  encodeContinuation: (path: string | null | undefined) => string;
  decodeContinuation: (token: string | null | undefined) => string | null;
  signInJourney: (input: {
    at: string;
    continuation?: string | null;
    legacyReturn?: string | null;
  }) => { signInHref: string | null; resumeHref: string };
}

/**
 * The journey runtime as the browser really receives it: sliced out of the
 * rendered login document, not imported from the module under test.
 */
function documentRuntime(
  basePath: string,
  opts: Parameters<typeof getOnboardingHtml>[0] = {},
): JourneyRuntime {
  const html = getOnboardingHtml(opts);
  const start = html.indexOf("var __anCreateSignInJourney =");
  const end = html.indexOf("var __anJourney = __anCreateSignInJourney");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return new Function(
    `${html.slice(start, end)} return __anCreateSignInJourney(${JSON.stringify(basePath)});`,
  )() as JourneyRuntime;
}

/** Slice one named `function name(...) {...}` out of the rendered document. */
function documentFunction<T>(name: string, extra = ""): T {
  const html = getOnboardingHtml();
  const start = html.indexOf(`function ${name}(`);
  expect(start, `${name} must exist in the login document`).toBeGreaterThan(-1);
  let depth = 0;
  let i = html.indexOf("{", start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  expect(i, `${name} must have a balanced body`).toBeLessThan(html.length);
  const source = html.slice(start, i + 1);
  expect(open).toBeGreaterThan(start);
  return new Function(`${extra}\n${source}\nreturn ${name};`)() as T;
}

interface Surface {
  id: number;
  name: string;
  basePath: string;
  /** The route the visitor asked for, base path included. */
  protectedPath: string;
  /** A same-origin path that belongs to a DIFFERENT app on this host. */
  siblingPath: string;
  /**
   * How this row's real end-to-end behaviour is covered ON TOP of the four
   * invariants below, which every row asserts against the shipped runtime.
   *
   * `"browser"` means `pnpm qa:sign-in` boots this deploy and drives the real
   * login document. Claim it only for a deploy that smoke actually starts —
   * a row that says "browser" and is not in `BROWSER_DRIVEN_SURFACES` is a
   * coverage claim nobody honours, which is the failure this file exists to
   * make impossible.
   */
  driver: "browser" | "request";
}

/**
 * The surfaces `scripts/qa-sign-in-matrix-smoke.ts` really boots: the root
 * deploy, the `/chatapp` deploy, and the root deploy inside a cross-origin
 * iframe. Kept here so a row cannot quietly promote itself to "browser".
 */
const BROWSER_DRIVEN_SURFACES = new Set([1, 2, 3]);

const SURFACES: Surface[] = [
  {
    id: 1,
    name: "top-level app at root base path (control)",
    basePath: "",
    protectedPath: "/inbox?filter=unread#thread-9",
    siblingPath: "/sign-in",
    driver: "browser",
  },
  {
    id: 2,
    name: "non-root base path, multi-app workspace host",
    basePath: "/mail",
    protectedPath: "/mail/inbox?filter=unread#thread-9",
    siblingPath: "/calendar/admin",
    driver: "browser",
  },
  {
    id: 3,
    name: "Builder iframe embed (third-party frame, popup + session bridge)",
    basePath: "",
    protectedPath: "/decks/42?edit=1",
    siblingPath: "/login",
    // Browser-driven for WHERE THE FRAME LANDS only. Whether a partitioned
    // third-party cookie is delivered is a different, still-open problem; the
    // smoke cannot prove it and does not claim to.
    driver: "browser",
  },
  {
    id: 4,
    name: "Builder preview, top level (redirect mode)",
    basePath: "",
    protectedPath: "/dispatch/apps",
    siblingPath: "/signup",
    driver: "request",
  },
  {
    id: 5,
    name: "Builder desktop proxy (Electron, cross-origin _session bridge)",
    basePath: "",
    protectedPath: "/library/folder/7",
    siblingPath: "/login",
    driver: "request",
  },
  {
    id: 6,
    name: "Agent Native Desktop (agentnative:// deep-link completion)",
    basePath: "",
    protectedPath: "/agent?tab=context",
    siblingPath: "/signup",
    driver: "request",
  },
  {
    id: 7,
    name: "mobile WebView (deep link with web _session fallback)",
    basePath: "",
    protectedPath: "/recordings/abc",
    siblingPath: "/login",
    driver: "request",
  },
  {
    id: 8,
    name: "MCP App embed / opaque-origin iframe (token in URL, no cookie)",
    basePath: "",
    protectedPath: "/embed/deck-1",
    siblingPath: "/login",
    driver: "request",
  },
  {
    id: 9,
    name: "public share link -> sign-in -> back to the share",
    basePath: "/clips",
    protectedPath: "/clips/share/xY7?t=32",
    siblingPath: "/mail/inbox",
    driver: "request",
  },
  {
    id: 10,
    name: "/_agent-native/open deep link (login form at the deep-link URL)",
    basePath: "",
    protectedPath: "/_agent-native/open?action=create-todo&title=Ship%20it",
    siblingPath: "/login",
    driver: "request",
  },
  {
    id: 11,
    name: "MCP OAuth authorize + agent-native connect",
    basePath: "",
    protectedPath:
      "/_agent-native/mcp/authorize?client_id=cli&state=abc123&code_challenge=xyz&code_challenge_method=S256",
    siblingPath: "/login",
    driver: "request",
  },
  {
    id: 12,
    name: "identity-SSO hub hop (Dispatch, deepest return nesting)",
    basePath: "/dispatch",
    protectedPath: "/dispatch/sso/authorize?app=mail&state=hop",
    siblingPath: "/mail/_agent-native/sso/callback",
    driver: "request",
  },
  {
    id: 13,
    name: "local dev, loopback, fresh DB (auto dev session 302)",
    basePath: "",
    protectedPath: "/database?table=todos",
    siblingPath: "/login",
    // Request-level, deliberately: the smoke sets
    // AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1, because otherwise the loopback
    // auto-session signs its "anonymous" visitor in before the gate runs and
    // every browser assertion silently tests nothing. So this row is NOT
    // browser-driven, and saying otherwise would be the exact overclaim that
    // let five previous fixes ship as "verified".
    driver: "request",
  },
  {
    id: 14,
    name: "CDN-cached SSR shell (one public document for every visitor)",
    basePath: "",
    protectedPath: "/dashboard",
    siblingPath: "/login",
    driver: "request",
  },
  {
    id: 15,
    name: "workspace-wide cookie domain (sibling apps share an_session)",
    basePath: "/mail",
    protectedPath: "/mail/settings",
    siblingPath: "/calendar/settings",
    driver: "request",
  },
];

describe("sign-in matrix", () => {
  describe.each(SURFACES)("surface $id: $name", (surface) => {
    const { basePath, protectedPath, siblingPath } = surface;
    const home = basePath || "/";
    const runtimes: Array<[string, JourneyRuntime]> = [
      [
        "module",
        {
          normalizeAppPath: (raw) => normalizeAppPath(raw, basePath),
          encodeContinuation: (p) => encodeContinuation(p, basePath),
          decodeContinuation: (t) => decodeContinuation(t, basePath),
          signInJourney: (input) => signInJourney({ ...input, basePath }),
        },
      ],
      ["login document", documentRuntime(basePath)],
      [
        "google-only login document",
        documentRuntime(basePath, { googleOnly: true }),
      ],
    ];

    it.each(runtimes)(
      "A: anonymous visitor reaches sign-in with an opaque continuation (%s)",
      (_label, journey) => {
        const { signInHref } = journey.signInJourney({ at: protectedPath });
        expect(signInHref).toBe(
          `${basePath}${SIGN_IN_ENTRY_PATH}?c=${journey.encodeContinuation(protectedPath)}`,
        );
        const token = new URL(
          signInHref!,
          "http://an.invalid",
        ).searchParams.get("c")!;
        // Opacity is why nesting is structurally impossible rather than
        // guarded: nothing downstream can mistake this for a redirect target.
        expect(token).not.toMatch(/[/?:]|%2F/i);
        expect(journey.decodeContinuation(token)).toBe(protectedPath);
      },
    );

    it.each(runtimes)(
      "B: signing in resumes the exact route, not the app root (%s)",
      (_label, journey) => {
        const token = journey.encodeContinuation(protectedPath);
        expect(
          journey.signInJourney({
            at: `${basePath}${SIGN_IN_ENTRY_PATH}?c=${token}`,
            continuation: token,
          }).resumeHref,
        ).toBe(protectedPath);
        // The legacy grammar is consumed forever: generated apps in the wild
        // hand-write it and cannot be upgraded.
        expect(
          journey.signInJourney({
            at: `${basePath}${SIGN_IN_ENTRY_PATH}?return=${encodeURIComponent(protectedPath)}`,
            legacyReturn: protectedPath,
          }).resumeHref,
        ).toBe(protectedPath);
      },
    );

    it.each(runtimes)(
      "C: an already-signed-in visitor at an auth entry path cannot loop (%s)",
      (_label, journey) => {
        for (const entry of [
          `${basePath}/login`,
          `${basePath}/signup`,
          `${basePath}${SIGN_IN_ENTRY_PATH}`,
          `${basePath}${SIGN_IN_LEGACY_ENTRY_PATH}`,
        ]) {
          const result = journey.signInJourney({ at: entry });
          // Refusing to mint is what removes the "don't redirect to yourself"
          // check from every call site.
          expect(result.signInHref).toBeNull();
          expect(result.resumeHref).toBe(home);
          expect(journey.normalizeAppPath(entry)).toBeNull();
        }
      },
    );

    it.each(runtimes)(
      "D: a forged continuation cannot nest or escape (%s)",
      (_label, journey) => {
        const forged = [
          `${basePath}${SIGN_IN_ENTRY_PATH}`,
          `${basePath}${SIGN_IN_LEGACY_ENTRY_PATH}`,
          `${basePath}/login`,
          "https://evil.example/pwned",
          "//evil.example/pwned",
          "/\\evil.example/pwned",
          "/inbox\r\nLocation: https://evil.example",
          siblingPath,
        ];
        for (const bad of forged) {
          // Nothing can even mint a token for these.
          expect(journey.encodeContinuation(bad)).toBe("");
          // …and a hand-written one is re-validated on the way out.
          const handRolled = Buffer.from(
            encodeURIComponent(bad),
            "utf8",
          ).toString("base64url");
          expect(journey.decodeContinuation(handRolled)).toBeNull();
          expect(
            journey.signInJourney({
              at: `${basePath}${SIGN_IN_ENTRY_PATH}?c=${handRolled}`,
              continuation: handRolled,
            }).resumeHref,
          ).toBe(home);
        }
        // Decoding never yields another token, so the grammar is not
        // recursive: one hop is all there is.
        const once = journey.encodeContinuation(protectedPath);
        expect(journey.decodeContinuation(once)).toBe(protectedPath);
        expect(
          journey.decodeContinuation(journey.encodeContinuation(once)),
        ).toBe(null);
      },
    );

    it("the login document and the module agree on every case", () => {
      const [, moduleJourney] = runtimes[0];
      const cases = [
        protectedPath,
        `${basePath}/login`,
        `${basePath}${SIGN_IN_ENTRY_PATH}`,
        siblingPath,
        "https://evil.example/pwned",
        "//evil.example",
        home,
      ];
      for (const [label, journey] of runtimes.slice(1)) {
        for (const at of cases) {
          expect(
            journey.signInJourney({ at }),
            `${label} disagrees with the module at ${at}`,
          ).toEqual(moduleJourney.signInJourney({ at }));
        }
      }
    });
  });

  describe("surface-specific completion", () => {
    it("surface 3/5: the _session bridge keeps the route it was given", () => {
      const bridge = documentFunction<(ret: string, token: string) => string>(
        "__anSessionBridgeUrl",
        "var window = { location: { origin: 'https://app.example', pathname: '/', search: '' } };",
      );
      expect(bridge("/decks/42?edit=1#slide-3", "tok")).toBe(
        "/decks/42?edit=1&_session=tok#slide-3",
      );
    });

    it("surface 4: workspace return normalization never yields an auth entry path", () => {
      const normalizeWorkspace = documentFunction<(ret: string) => string>(
        "__anNormalizeWorkspaceReturnPath",
        "var window = { location: { origin: 'https://preview.example' } };",
      );
      // The hardcoded Dispatch route table is workspace routing, not return
      // validation — it must leave real app routes alone…
      expect(normalizeWorkspace("/dispatch/apps")).toBe("/dispatch/apps");
      expect(normalizeWorkspace("/dispatch/dispatch")).toBe("/dispatch");
      expect(normalizeWorkspace("/dispatch/mail/inbox")).toBe("/mail/inbox");
      // …and whatever it produces must still be a legal resume target.
      for (const ret of ["/dispatch/apps", "/dispatch/mail/inbox", "/x?y=1"]) {
        expect(normalizeAppPath(normalizeWorkspace(ret))).not.toBeNull();
      }
    });

    it("surface 5/6: desktop detection does not change where the visitor lands", () => {
      const isBuilderDesktop = documentFunction<() => boolean>(
        "__anIsBuilderDesktop",
        "var navigator = { userAgent: 'Mozilla/5.0 Electron/32.0 BuilderDesktop' };",
      );
      const isAgentNativeDesktop = documentFunction<() => boolean>(
        "__anIsAgentNativeDesktop",
        "var navigator = { userAgent: 'Mozilla/5.0 Electron/32.0 AgentNativeDesktop/1.2' };",
      );
      expect(isBuilderDesktop()).toBe(true);
      expect(isAgentNativeDesktop()).toBe(true);
      // Both desktop surfaces complete sign-in outside the web cookie jar, but
      // the continuation they carry is the same one every other surface uses.
      // Agent Native Desktop reloads in place, so its resume is the route it
      // started on rather than the app root.
      const at = "/agent?tab=context";
      expect(
        signInJourney({ at, continuation: encodeContinuation(at) }).resumeHref,
      ).toBe(at);
    });

    it("surface 7: the mobile web _session fallback preserves the return route", () => {
      // The allowed cross-origin case: the workspace gateway loopback.
      const returned = appendSessionToOAuthReturnUrl(
        "http://127.0.0.1:8080/recordings/abc?x=1",
        "tok",
      );
      const parsed = new URL(returned);
      expect(parsed.pathname).toBe("/recordings/abc");
      expect(parsed.searchParams.get("x")).toBe("1");
      expect(parsed.searchParams.get("_session")).toBe("tok");
      // Same-origin returns stay relative and keep their route; the WebView
      // already holds the cookie there, so no bridge token is appended.
      expect(appendSessionToOAuthReturnUrl("/recordings/abc?x=1", "tok")).toBe(
        "/recordings/abc?x=1",
      );
      // Foreign origins are not returnable at all.
      expect(
        appendSessionToOAuthReturnUrl("https://evil.example/pwned", "tok"),
      ).toBe("/");
    });

    it("surface 8: an embed ticket can never target a login form", () => {
      expect(normalizeEmbedTargetPath("/embed/deck-1")).toBe("/embed/deck-1");
      for (const bad of [
        "/login",
        "/signup",
        SIGN_IN_ENTRY_PATH,
        SIGN_IN_LEGACY_ENTRY_PATH,
        "//evil.example",
        "/\\evil.example",
        "https://evil.example/x",
      ]) {
        expect(
          normalizeEmbedTargetPath(bad, "https://app.example"),
          `embed target ${bad} must fail closed`,
        ).toBeNull();
      }
    });

    it("surface 9: a share link the visitor could reach anonymously is a valid resume target", () => {
      // The bug this replaces collapsed anything unrecognised to "/", which
      // dumped share-link visitors on an app home they had no access to.
      const share = "/clips/share/xY7?t=32";
      expect(normalizeAppPath(share, "/clips")).toBe(share);
      expect(
        signInJourney({
          at: `/clips${SIGN_IN_ENTRY_PATH}`,
          continuation: encodeContinuation(share, "/clips"),
          basePath: "/clips",
        }).resumeHref,
      ).toBe(share);
    });

    it("surface 10/11: deep-link and MCP authorize params survive the round trip", () => {
      for (const target of [
        "/_agent-native/open?action=create-todo&title=Ship%20it",
        "/_agent-native/mcp/authorize?client_id=cli&state=abc123&code_challenge=xyz&code_challenge_method=S256",
      ]) {
        const { signInHref, resumeHref } = signInJourney({ at: target });
        expect(signInHref).not.toBeNull();
        const token = new URL(
          signInHref!,
          "http://an.invalid",
        ).searchParams.get("c")!;
        expect(decodeContinuation(token)).toBe(target);
        expect(resumeHref).toBe(target);
      }
    });

    it("surface 12: safeReturnPath still accepts every legacy provider return it used to", () => {
      // Eight provider-OAuth call sites still use this; it is now a one-line
      // delegate, so the back-compat proof is that its answers did not move.
      expect(safeReturnPath("/dispatch/sso/authorize?app=mail")).toBe(
        "/dispatch/sso/authorize?app=mail",
      );
      expect(safeReturnPath("/mail/_agent-native/sso/callback")).toBe(
        "/mail/_agent-native/sso/callback",
      );
      for (const bad of [
        "https://evil.example",
        "//evil.example",
        "/\\evil.example",
        SIGN_IN_ENTRY_PATH,
        SIGN_IN_LEGACY_ENTRY_PATH,
        "/login",
        null,
        undefined,
        "",
      ]) {
        expect(safeReturnPath(bad), `safeReturnPath(${bad})`).toBe("/");
      }
    });

    it("surface 14: the login document is one impersonal shell for every visitor", () => {
      const first = getOnboardingHtml();
      const second = getOnboardingHtml();
      expect(second).toBe(first);
      // Nothing session-shaped may be baked into a hard-cached public document.
      expect(first).not.toMatch(/set-cookie/i);
      expect(first).not.toMatch(/an_session/);
    });
  });

  describe("base path reaches the login document", () => {
    it("bakes the configured base path in, rather than sniffing it", () => {
      // `__anBasePath()`'s marker fallback only fires for URLs containing
      // `/_agent-native`, so on `/myapp/login` it returns "". The configured
      // value is therefore the only thing that makes surface 2 work, and a
      // change that stops baking it reopens the infinite bounce.
      vi.stubEnv("APP_BASE_PATH", "/myapp");
      try {
        const html = getOnboardingHtml();
        expect(html).toContain('var configured = "/myapp";');
        expect(html).toContain(
          "var __anJourney = __anCreateSignInJourney(__anBasePath());",
        );
      } finally {
        vi.unstubAllEnvs();
      }
      expect(getOnboardingHtml()).toContain('var configured = "";');
    });
  });

  describe("one login document, one validator", () => {
    it("the Google-only document is the same maintained document", () => {
      const googleOnly = getOnboardingHtml({ googleOnly: true });
      expect(googleOnly).toContain("var __anCreateSignInJourney =");
      expect(googleOnly).toContain(
        "var __anJourney = __anCreateSignInJourney(__anBasePath());",
      );
      // The deleted second login page completed with
      // `window.location.href = ret || '/'` where `ret` was the sign-in page.
      expect(googleOnly).not.toContain("window.location.href = ret");
    });

    it("no login document carries a return-path validator of its own", () => {
      for (const html of [
        getOnboardingHtml(),
        getOnboardingHtml({ googleOnly: true }),
      ]) {
        for (const gone of [
          "function __anNormalizeReturnPath",
          "function __anIsAuthEntryPath",
          "function __anGetSignedInReturnPath",
          "function __anCurrentReturnPath",
          "function __anGetReturnPath",
          "function __anHasControlCharacter",
        ]) {
          expect(html, `${gone} must not come back`).not.toContain(gone);
        }
      }
    });
  });

  /**
   * A matrix nobody runs stops nothing, and the browser half is the part that
   * gets dropped first when a pipeline is slow. These two assertions are the
   * only things standing between "we have cross-surface coverage" and a claim.
   */
  describe("the browser-driven half is real and runs", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../..");
    const read = (rel: string) =>
      fs.readFileSync(path.join(repoRoot, rel), "utf8");

    it("no row claims browser coverage the smoke does not boot", () => {
      const claimed = SURFACES.filter((s) => s.driver === "browser").map(
        (s) => s.id,
      );
      expect(claimed).toEqual([...BROWSER_DRIVEN_SURFACES]);
      // …and the smoke really starts both deploys those rows describe.
      const smoke = read("scripts/qa-sign-in-matrix-smoke.ts");
      expect(smoke).toContain('for (const basePath of ["", "/chatapp"])');
      expect(smoke).toContain("runIframeSuite");
    });

    it("stays wired into a CI job, not just into package.json", () => {
      expect(JSON.parse(read("package.json")).scripts["qa:sign-in"]).toBe(
        "tsx scripts/qa-sign-in-matrix-smoke.ts",
      );
      const workflows = fs
        .readdirSync(path.join(repoRoot, ".github/workflows"))
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
        .map((f) => read(`.github/workflows/${f}`));
      expect(
        workflows.some((w) => w.includes("pnpm qa:sign-in")),
        "some workflow must run `pnpm qa:sign-in`",
      ).toBe(true);
    });
  });
});
