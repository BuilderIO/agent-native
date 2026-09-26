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
 * The React auth document loads one client bundle that imports the same
 * journey module. The document checks below ensure the shipped shell carries
 * that bundle and serialized props instead of embedding a second runtime.
 *
 * Browser-driven coverage (real dev server, real form, real hydration) for the
 * root deploy, the `/chatapp` base-path deploy, and a genuinely cross-origin
 * iframe lives in `scripts/qa-sign-in-matrix-smoke.ts` (`pnpm qa:sign-in`).
 * The surfaces here that a headless browser cannot reproduce - a separate
 * Electron cookie jar, a custom-scheme deep link, an opaque-origin MCP frame —
 * are asserted against the shipped code rather than mimed.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  isAgentNativeDesktop,
  isElectron,
  normalizeOAuthReturnPath,
} from "../client/auth/AuthPage.js";
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

function documentRuntime(
  basePath: string,
  opts: Parameters<typeof getOnboardingHtml>[0] = {},
): JourneyRuntime {
  const html = getOnboardingHtml(opts);
  expect(html).toContain('id="agent-native-auth-root"');
  expect(html).toContain('id="agent-native-auth-data"');
  expect(html).toContain("assets/auth-client.js");
  return {
    normalizeAppPath: (raw) => normalizeAppPath(raw, basePath),
    encodeContinuation: (p) => encodeContinuation(p, basePath),
    decodeContinuation: (t) => decodeContinuation(t, basePath),
    signInJourney: (input) => signInJourney({ ...input, basePath }),
  };
}

interface Surface {
  id: number;
  name: string;
  basePath: string;
  protectedPath: string;
  siblingPath: string;
  driver: "browser" | "request";
}

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
    name: "Agent-Native Desktop (agentnative:// deep-link completion)",
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
    const home = basePath ? `${basePath}/home` : "/home";
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
          expect(journey.encodeContinuation(bad)).toBe("");
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
        const once = journey.encodeContinuation(protectedPath);
        expect(journey.decodeContinuation(once)).toBe(protectedPath);
        expect(
          journey.decodeContinuation(journey.encodeContinuation(once)),
        ).toBe(null);
      },
    );

    it("the React auth document is wired to the shared journey contract", () => {
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
      const returned = appendSessionToOAuthReturnUrl(
        "http://127.0.0.1:8080/decks/42?edit=1#slide-3",
        "tok",
      );
      const parsed = new URL(returned);
      expect(parsed.origin).toBe("http://127.0.0.1:8080");
      expect(parsed.pathname).toBe("/decks/42");
      expect(parsed.searchParams.get("edit")).toBe("1");
      expect(parsed.searchParams.get("_session")).toBe("tok");
      expect(parsed.hash).toBe("#slide-3");
    });

    it("surface 4: workspace return normalization never yields an auth entry path", () => {
      expect(normalizeOAuthReturnPath("/dispatch/apps")).toBe("/dispatch/apps");
      expect(normalizeOAuthReturnPath("/dispatch/dispatch")).toBe("/dispatch");
      expect(normalizeOAuthReturnPath("/dispatch/mail/inbox")).toBe(
        "/mail/inbox",
      );
      for (const ret of ["/dispatch/apps", "/dispatch/mail/inbox", "/x?y=1"]) {
        expect(normalizeAppPath(normalizeOAuthReturnPath(ret))).not.toBeNull();
      }
    });

    it("surface 5/6: desktop detection does not change where the visitor lands", () => {
      const genericElectron = "Mozilla/5.0 Electron/32.0 BuilderDesktop";
      expect(isElectron(genericElectron)).toBe(true);
      expect(isAgentNativeDesktop(genericElectron)).toBe(false);
      expect(
        isAgentNativeDesktop(
          "Mozilla/5.0 Electron/32.0 agentnativedesktop/1.2",
        ),
      ).toBe(true);
      const at = "/agent?tab=context";
      expect(
        signInJourney({ at, continuation: encodeContinuation(at) }).resumeHref,
      ).toBe(at);
    });

    it("surface 7: the mobile web _session fallback preserves the return route", () => {
      const returned = appendSessionToOAuthReturnUrl(
        "http://127.0.0.1:8080/recordings/abc?x=1",
        "tok",
      );
      const parsed = new URL(returned);
      expect(parsed.pathname).toBe("/recordings/abc");
      expect(parsed.searchParams.get("x")).toBe("1");
      expect(parsed.searchParams.get("_session")).toBe("tok");
      expect(appendSessionToOAuthReturnUrl("/recordings/abc?x=1", "tok")).toBe(
        "/recordings/abc?x=1",
      );
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
      expect(first).not.toMatch(/set-cookie/i);
      expect(first).not.toMatch(/an_session/);
    });
  });

  describe("base path reaches the login document", () => {
    it("bakes the configured base path in, rather than sniffing it", () => {
      vi.stubEnv("APP_BASE_PATH", "/myapp");
      try {
        const html = getOnboardingHtml();
        expect(html).toContain('src="/myapp/assets/auth-client.js"');
      } finally {
        vi.unstubAllEnvs();
      }
      expect(getOnboardingHtml()).toContain('src="/assets/auth-client.js"');
    });
  });

  describe("one login document, one validator", () => {
    it("the Google-only document is the same maintained document", () => {
      const googleOnly = getOnboardingHtml({ googleOnly: true });
      expect(googleOnly).toContain('id="agent-native-auth-root"');
      expect(googleOnly).toContain('id="agent-native-auth-data"');
      expect(googleOnly).toContain("assets/auth-client.js");
      const data = googleOnly.match(
        /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
      );
      expect(data).toBeTruthy();
      expect(JSON.parse(data?.[1] ?? "{}").googleOnly).toBe(true);
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

  describe("the browser-driven half is real and runs", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../..");
    const read = (rel: string) =>
      fs.readFileSync(path.join(repoRoot, rel), "utf8");

    it("no row claims browser coverage the smoke does not boot", () => {
      const claimed = SURFACES.filter((s) => s.driver === "browser").map(
        (s) => s.id,
      );
      expect(claimed).toEqual([...BROWSER_DRIVEN_SURFACES]);
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
