import { test, expect, type Page } from "@playwright/test";

/*
 * SECURITY (XSS) + ROBUSTNESS — adversarial e2e.
 *
 * The Agent-Native Plans renderer has ONE live HTML sink that is NOT
 * iframe-sandboxed: a wireframe block's `data.html` is injected with
 * `dangerouslySetInnerHTML` (app/components/plan/wireframe/Wireframe.tsx:248).
 * The only thing guarding it is the schema regex `unsafeCustomHtmlPattern`
 * (shared/plan-content.ts), which matches the *literal* token `javascript:`
 * and inline `on*=` handlers. The wireframe path does NOT run the runtime
 * `sanitizeCustomHtml` pass that custom-html blocks get.
 *
 * So:
 *  - `<img src=x onerror=alert(1)>`        → schema REJECTS (on*= matches)
 *  - `<a href="javascript:alert(1)">`      → schema REJECTS (literal token)
 *  - `<a href="java\tscript:alert(1)">`    → schema ACCEPTS (tab breaks the
 *                                            literal match) but browsers strip
 *                                            the tab before navigating → LIVE
 *                                            stored XSS in a shared plan.
 *  - `<a href="&#106;avascript:...">`      → schema ACCEPTS (entity-encoded) →
 *                                            decodes to javascript: in the DOM.
 *
 * These specs are written as assertions of CORRECT behavior: a dialog firing,
 * a window flag flipping, or a live executable `javascript:` href surviving
 * into the DOM is the bug — the assertion fails and pins it. Once the renderer
 * sanitizes (or sandboxes) the wireframe html, these become the regression net.
 */

type XssProbe = {
  dialogs: string[];
  pageErrors: string[];
};

/**
 * Wire up the three independent script-execution detectors before any
 * navigation:
 *  1. page.on('dialog') — alert/confirm/prompt from any executed script.
 *  2. page.on('pageerror') — uncaught errors (also catches a render crash).
 *  3. a window flag set via an exposed binding — the payloads call
 *     window.__xssHit() where we can, and we also expose it as a global the
 *     injected html could reach. Dialogs are auto-dismissed so a fired alert
 *     never wedges the run.
 */
async function installXssProbe(page: Page): Promise<XssProbe> {
  const probe: XssProbe = { dialogs: [], pageErrors: [] };
  page.on("dialog", (dialog) => {
    probe.dialogs.push(`${dialog.type()}:${dialog.message()}`);
    void dialog.dismiss().catch(() => {});
  });
  page.on("pageerror", (error) => {
    probe.pageErrors.push(String(error?.message ?? error));
  });
  // A global flag any executed payload can flip. Set BEFORE document scripts so
  // an inline <script> or javascript: handler that runs would be observable.
  await page.addInitScript(() => {
    (window as unknown as { __xssHit?: boolean }).__xssHit = false;
    (window as unknown as { __xss?: () => void }).__xss = () => {
      (window as unknown as { __xssHit?: boolean }).__xssHit = true;
    };
  });
  return probe;
}

async function readXssHit(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Boolean((window as unknown as { __xssHit?: boolean }).__xssHit),
  );
}

async function createPlan(
  page: Page,
  content: unknown,
  title: string,
): Promise<{ id: string | undefined; ok: boolean; status: number }> {
  const res = await page.request.post(
    "/_agent-native/actions/create-visual-plan",
    { data: { title, brief: "xss probe brief", content } },
  );
  const status = res.status();
  const json = await res.json().catch(() => ({}) as Record<string, unknown>);
  const id =
    (json as { planId?: string }).planId ??
    (json as { plan?: { id?: string } }).plan?.id;
  return { id, ok: res.ok(), status };
}

function wireframePlan(html: string, title: string) {
  return {
    version: 2,
    title,
    brief: "xss probe",
    blocks: [
      {
        id: "wf-xss-1",
        type: "wireframe",
        title: "Mockup",
        data: { surface: "desktop", html },
      },
    ],
  };
}

function customHtmlPlan(html: string, title: string) {
  return {
    version: 2,
    title,
    brief: "xss probe",
    blocks: [
      {
        id: "ch-xss-1",
        type: "custom-html",
        title: "Embed",
        data: { html },
      },
    ],
  };
}

/* The obfuscated payloads under test. `mark` is a substring that, if it ever
 * appears verbatim in a navigable href/src in the live DOM, proves the
 * dangerous scheme survived storage. */
const OBFUSCATED = {
  tabHref: `<a id="xss-tab" href="java\tscript:window.__xss?.();alert(document.domain)">tab</a>`,
  newlineHref: `<a id="xss-nl" href="java\nscript:window.__xss?.();alert(1)">nl</a>`,
  entityHref: `<a id="xss-ent" href="&#106;avascript:window.__xss?.();alert(1)">ent</a>`,
};

const FORBIDDEN = {
  scriptTag: `<div><script>window.__xss&&window.__xss();</script></div>`,
  imgOnerror: `<img src=x onerror="window.__xss&&window.__xss()">`,
  literalHref: `<a id="xss-lit" href="javascript:window.__xss&&window.__xss()">lit</a>`,
};

/* ------------------------------------------------------------------------- */
/* 1. STORED XSS via wireframe html — the live dangerouslySetInnerHTML sink. */
/* ------------------------------------------------------------------------- */

test.describe("stored XSS via wireframe html (dangerouslySetInnerHTML, no iframe)", () => {
  test("obvious vectors (script tag, img onerror, literal javascript:) never execute as a viewer", async ({
    page,
  }) => {
    const probe = await installXssProbe(page);
    // Each of these SHOULD be rejected by the schema. If the create succeeds we
    // still open it and assert nothing executes.
    for (const [name, html] of Object.entries(FORBIDDEN)) {
      const title = `wf-forbidden-${name}-${Date.now()}`;
      const created = await createPlan(page, wireframePlan(html, title), title);
      if (!created.id) {
        // Rejected at the action boundary — the correct outcome.
        expect(created.ok, `payload ${name} should be rejected`).toBe(false);
        continue;
      }
      await page.goto(`/plans/${created.id}`);
      await expect(page.locator(".plans-workspace")).toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(800);
      expect(
        await readXssHit(page),
        `payload ${name} flipped the xss flag (script executed)`,
      ).toBe(false);
    }
    expect(probe.dialogs, "no alert/confirm/prompt should fire").toEqual([]);
  });

  test("tab-obfuscated javascript: href is neutralized in the stored/rendered plan", async ({
    page,
  }) => {
    const probe = await installXssProbe(page);
    const title = `wf-tab-${Date.now()}`;
    const created = await createPlan(
      page,
      wireframePlan(OBFUSCATED.tabHref, title),
      title,
    );
    // KNOWN BUG: the schema currently ACCEPTS the tab-obfuscated href because it
    // only matches the literal token `javascript:`. Correct behavior is to
    // reject it OR strip the scheme before storing.
    if (!created.id) {
      expect(created.ok).toBe(false);
      return;
    }
    await page.goto(`/plans/${created.id}`);
    await expect(page.locator(".plans-workspace")).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(800);

    // The anchor must NOT carry an executable javascript: scheme. Browsers
    // strip tabs/newlines from the scheme before navigating, so we collapse
    // whitespace + lowercase the resolved href and assert it is not a js: url.
    const hrefInfo = await page.evaluate(() => {
      const a = document.querySelector<HTMLAnchorElement>("#xss-tab");
      return {
        present: Boolean(a),
        // getAttribute = raw stored value; .href = browser-resolved navigable.
        rawAttr: a?.getAttribute("href") ?? null,
        resolved: a ? a.href : null,
      };
    });

    if (hrefInfo.present) {
      const rawCollapsed = (hrefInfo.rawAttr ?? "")
        .replace(/[\t\n\r]/g, "")
        .toLowerCase();
      const resolvedLower = (hrefInfo.resolved ?? "").toLowerCase();
      // This assertion FAILS today and pins the stored-XSS: the raw href still
      // collapses to `javascript:...` and the browser resolves it to a js: URL.
      expect(
        rawCollapsed.includes("javascript:") ||
          resolvedLower.startsWith("javascript:"),
        `stored wireframe html still contains an executable javascript: href (raw=${hrefInfo.rawAttr})`,
      ).toBe(false);
    }

    // Clicking the link must not fire an alert or flip the flag.
    const link = page.locator("#xss-tab");
    if (await link.count()) {
      await link
        .first()
        .click({ timeout: 5_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    }
    expect(await readXssHit(page), "javascript: href executed on click").toBe(
      false,
    );
    expect(probe.dialogs, "no dialog should fire from the wireframe").toEqual(
      [],
    );
  });

  test("newline- and entity-obfuscated javascript: hrefs are neutralized", async ({
    page,
  }) => {
    const probe = await installXssProbe(page);
    for (const [name, html, sel] of [
      ["newline", OBFUSCATED.newlineHref, "#xss-nl"],
      ["entity", OBFUSCATED.entityHref, "#xss-ent"],
    ] as const) {
      const title = `wf-${name}-${Date.now()}`;
      const created = await createPlan(page, wireframePlan(html, title), title);
      if (!created.id) {
        expect(created.ok, `${name} payload should be rejected`).toBe(false);
        continue;
      }
      await page.goto(`/plans/${created.id}`);
      await expect(page.locator(".plans-workspace")).toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(600);

      const resolved = await page.evaluate((selector) => {
        const a = document.querySelector<HTMLAnchorElement>(selector);
        return a ? a.href.toLowerCase() : null;
      }, sel);
      if (resolved) {
        expect(
          resolved.startsWith("javascript:"),
          `${name}-obfuscated href resolved to an executable javascript: URL`,
        ).toBe(false);
      }

      const link = page.locator(sel);
      if (await link.count()) {
        await link
          .first()
          .click({ timeout: 5_000 })
          .catch(() => {});
        await page.waitForTimeout(300);
      }
      expect(await readXssHit(page), `${name}-obfuscated href executed`).toBe(
        false,
      );
    }
    expect(probe.dialogs).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* 2. custom-html block — sandboxed iframe must neutralize the same payloads. */
/* ------------------------------------------------------------------------- */

test.describe("custom-html block (sandboxed iframe) neutralizes payloads", () => {
  test("obfuscated + obvious payloads in custom-html never reach the top document", async ({
    page,
  }) => {
    const probe = await installXssProbe(page);
    const payloads: Array<[string, string]> = [
      ["tab", OBFUSCATED.tabHref],
      ["entity", OBFUSCATED.entityHref],
      ["scriptTag", FORBIDDEN.scriptTag],
      ["imgOnerror", FORBIDDEN.imgOnerror],
    ];
    for (const [name, html] of payloads) {
      const title = `ch-${name}-${Date.now()}`;
      const created = await createPlan(
        page,
        customHtmlPlan(html, title),
        title,
      );
      if (!created.id) {
        // Some are rejected by the schema (script tag / on*=); that's fine.
        expect(created.ok).toBe(false);
        continue;
      }
      await page.goto(`/plans/${created.id}`);
      await expect(page.locator(".plans-workspace")).toBeVisible({
        timeout: 20_000,
      });
      // Let the iframe mount + (fail to) execute.
      await page.waitForTimeout(900);

      // The custom-html block renders in an <iframe sandbox="allow-same-origin">
      // (no allow-scripts), and the value is run through sanitizeCustomHtml.
      // Confirm the block is sandboxed without script permission — that is the
      // structural guarantee, regardless of payload.
      const frame = page.locator("iframe[sandbox]").first();
      if (await frame.count()) {
        const sandbox = await frame.getAttribute("sandbox");
        expect(
          (sandbox ?? "").includes("allow-scripts"),
          `custom-html iframe must NOT grant allow-scripts (got "${sandbox}")`,
        ).toBe(false);
      }

      expect(
        await readXssHit(page),
        `custom-html payload ${name} executed in the top document`,
      ).toBe(false);
    }
    expect(
      probe.dialogs,
      "no dialog should escape the custom-html iframe",
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* 3. DoS — deeply nested tabs (~400 levels) must degrade gracefully.        */
/* ------------------------------------------------------------------------- */

test.describe("DoS: deeply nested tabs", () => {
  function nestedTabs(depth: number): unknown {
    let inner: Record<string, unknown> = {
      id: "leaf",
      type: "rich-text",
      data: { markdown: "deep leaf" },
    };
    for (let i = depth; i > 0; i -= 1) {
      inner = {
        id: `tabs-${i}`,
        type: "tabs",
        data: { tabs: [{ id: `t-${i}`, label: `L${i}`, blocks: [inner] }] },
      };
    }
    return inner;
  }

  test("a ~400-level nested-tabs plan renders a graceful fallback, not a crashed page", async ({
    page,
  }) => {
    const probe = await installXssProbe(page);
    const title = `dos-tabs-${Date.now()}`;
    const content = {
      version: 2,
      title,
      brief: "deep nesting dos probe",
      blocks: [nestedTabs(400)],
    };
    const created = await createPlan(page, content, title);

    if (!created.id) {
      // Bounded at the action boundary (e.g. a max-depth refine) — the safest
      // outcome. Acceptable graceful handling.
      expect(created.ok).toBe(false);
      return;
    }

    await page
      .goto(`/plans/${created.id}`, { waitUntil: "domcontentloaded" })
      .catch(() => {});
    // Give the recursive render a chance to either paint or blow up.
    await page.waitForTimeout(4_000);

    // The render crash can destroy the execution context mid-evaluate; retry a
    // couple of times so we read real DOM state rather than an infra error.
    const readState = async () =>
      page.evaluate(() => {
        const workspace = document.querySelector(".plans-workspace");
        const renderer = document.querySelector(".plan-content-surface");
        const errorCard = Array.from(document.querySelectorAll("h2")).some(
          (h) => h.textContent?.includes("Plan did not load"),
        );
        const bodyTextLen = (document.body.innerText ?? "").trim().length;
        return {
          hasWorkspace: Boolean(workspace),
          hasRenderer: Boolean(renderer),
          errorCard,
          bodyTextLen,
        };
      });
    let state = {
      hasWorkspace: false,
      hasRenderer: false,
      errorCard: false,
      bodyTextLen: 0,
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        state = await readState();
        break;
      } catch {
        await page.waitForTimeout(1_000);
      }
    }

    // PRIMARY, deterministic signal: a "Maximum call stack size exceeded"
    // RangeError from the recursive PlanBlockView/TabsBlock render is a hard
    // crash, not graceful degradation. There is no tabs-depth cap in
    // planContentSchema (cf. WIREFRAME_MAX_DEPTH=8 for wireframe trees), so the
    // 400-deep plan is happily stored (create returns 200) and then overflows
    // the stack on render.
    const stackOverflow = probe.pageErrors.find((message) =>
      /maximum call stack|stack size exceeded|too much recursion/i.test(
        message,
      ),
    );
    expect(
      stackOverflow,
      `recursive tab render overflowed the stack (no depth cap on tabs): ${
        stackOverflow ?? ""
      }`,
    ).toBeUndefined();

    // The app shell must survive AND show either rendered content or the
    // graceful "Plan did not load" error — never a near-blank crashed page.
    expect(
      state.hasWorkspace,
      "the app shell did not mount (whole page crashed on the deep plan)",
    ).toBe(true);
    expect(
      state.hasRenderer || state.errorCard,
      "neither rendered content nor a graceful error fallback was shown",
    ).toBe(true);
  });
});
