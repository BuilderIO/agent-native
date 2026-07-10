import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { embeddedWheelBridgeScript } from "../../../../.generated/bridge/embedded-wheel.generated";

function editingSafetyBridgeScript(): string {
  return embeddedWheelBridgeScript
    .replace("__EMBEDDED_WHEEL_FORWARDING_ENABLED__", "false")
    .replace("__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__", "false")
    .replace("__EDITING_SAFETY_ENABLED__", "true");
}

describe("editing safety bridge", () => {
  it(
    "freezes authored motion, blocks link/form navigation, and reports full reloads",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      const pageErrors: string[] = [];
      try {
        const page = await browser.newPage();
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(`<!doctype html><html><head><style>
          @keyframes drift { to { transform: translateX(20px) } }
          html, body { animation: drift 3s linear infinite; transition: opacity 1s }
          #animated { animation: drift 3s linear infinite; transition: opacity 1s }
        </style></head><body>
          <a id="link" href="/escaped">Navigate</a>
          <form id="form" action="/submitted" method="post"><button>Submit</button></form>
          <div id="animated">Animated</div>
          <script>
            window.__linkClicks = 0;
            window.__formSubmits = 0;
            document.querySelector('#link').addEventListener('click', () => window.__linkClicks++);
            document.querySelector('#form').addEventListener('submit', () => window.__formSubmits++);
            window.addEventListener('message', event => {
              if (event.data && event.data.type === 'agent-native:runtime-reloading') {
                window.__reloadReports = (window.__reloadReports || 0) + 1;
              }
            });
          </script>
        </body></html>`);
        await page.addScriptTag({ content: editingSafetyBridgeScript() });

        for (const selector of ["html", "body", "#animated"]) {
          const frozen = await page.locator(selector).evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              animationName: style.animationName,
              transitionDuration: style.transitionDuration,
            };
          });
          expect(frozen.animationName).toBe("none");
          expect(frozen.transitionDuration).toBe("0s");
        }

        const originalUrl = page.url();
        await page.locator("#link").click();
        await page.locator("#form button").click();
        await page.waitForTimeout(25);
        expect(page.url()).toBe(originalUrl);
        expect(
          await page.evaluate(() => ({
            linkClicks: (window as any).__linkClicks,
            formSubmits: (window as any).__formSubmits,
          })),
        ).toEqual({ linkClicks: 0, formSubmits: 0 });

        await page.evaluate(() => {
          window.dispatchEvent(new Event("pagehide"));
        });
        await page.waitForFunction(() => (window as any).__reloadReports === 1);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );
});
