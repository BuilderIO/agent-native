import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { embeddedWheelBridgeScript } from "../../../../.generated/bridge/embedded-wheel.generated";

function editingSafetyBridgeScript(
  enabled = true,
  spaceKeyForwardingEnabled = false,
): string {
  return embeddedWheelBridgeScript
    .replace("__EMBEDDED_WHEEL_FORWARDING_ENABLED__", "false")
    .replace(
      "__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__",
      String(spaceKeyForwardingEnabled),
    )
    .replace("__EDITING_SAFETY_ENABLED__", String(enabled))
    .replace("__INTERACTION_MODE__", "false");
}

describe("editing safety bridge", () => {
  it("drops a removed loop's positional rule so a new entrance in its slot plays", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<iframe id="preview"></iframe>`);
      const iframe = page.frames()[1];
      if (!iframe) throw new Error("Preview iframe did not load");
      await iframe.setContent(`<!doctype html><html><head><style>
        .spin { animation: spin 1s linear infinite; }
        .fade-up { opacity: 0; animation: fade-up 0.5s ease forwards; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fade-up { to { opacity: 1; } }
      </style></head><body><div class="spin" id="loop">Loop</div></body></html>`);
      await iframe.addScriptTag({ content: editingSafetyBridgeScript(true) });

      await expect
        .poll(() =>
          iframe
            .locator("#loop")
            .evaluate((element) => getComputedStyle(element).animationName),
        )
        .toBe("none");

      await iframe.evaluate(() => {
        const entrance = document.createElement("div");
        entrance.className = "fade-up";
        entrance.id = "entrance";
        entrance.textContent = "Entrance";
        document.getElementById("loop")!.replaceWith(entrance);
      });

      await expect
        .poll(
          () =>
            iframe
              .locator("#entrance")
              .evaluate((element) => getComputedStyle(element).opacity),
          { timeout: 5_000 },
        )
        .toBe("1");
    } finally {
      await browser.close();
    }
  });

  it("freezes a hover-started ::after loop on a host whose own loop is already frozen", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><head><style>
        #host { width: 120px; height: 40px; animation: spin 1s linear infinite; }
        #host::after { content: "Badge"; display: inline-block; }
        #host:hover::after { animation: pulse 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { to { opacity: 0.2; } }
      </style></head><body><div id="host">Host</div></body></html>`);
      await page.addScriptTag({ content: editingSafetyBridgeScript(true) });

      await expect
        .poll(() =>
          page
            .locator("#host")
            .evaluate((element) => getComputedStyle(element).animationName),
        )
        .toBe("none");

      await page.locator("#host").hover();

      await expect
        .poll(() =>
          page
            .locator("#host")
            .evaluate(
              (element) => getComputedStyle(element, "::after").animationName,
            ),
        )
        .toBe("none");
    } finally {
      await browser.close();
    }
  });

  it.each([true, false])(
    "plays authored entrance animations to completion with editing safety %s",
    async (enabled) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(`<iframe id="preview"></iframe>`);
        const iframe = page.frames()[1];
        if (!iframe) throw new Error("Preview iframe did not load");
        await iframe.setContent(`<!doctype html><html><head><style>
          .fade-up, #hero::before, #hero::after {
            opacity: 0;
            transform: translateY(20px);
            animation: fade-up 1s ease forwards;
          }
          #hero::before, #hero::after { content: "Entrance"; }
          @keyframes fade-up { to { opacity: 1; transform: none; } }
        </style></head><body><h1 class="fade-up" id="hero">Hero</h1></body></html>`);
        await iframe.addScriptTag({
          content: editingSafetyBridgeScript(enabled),
        });

        await expect
          .poll(
            () =>
              iframe.locator("#hero").evaluate((element) =>
                [null, "::before", "::after"].map((pseudo) => {
                  const style = getComputedStyle(element, pseudo);
                  return { opacity: style.opacity, transform: style.transform };
                }),
              ),
            { timeout: 5_000 },
          )
          .toEqual([
            { opacity: "1", transform: "matrix(1, 0, 0, 1, 0, 0)" },
            { opacity: "1", transform: "matrix(1, 0, 0, 1, 0, 0)" },
            { opacity: "1", transform: "matrix(1, 0, 0, 1, 0, 0)" },
          ]);
      } finally {
        await browser.close();
      }
    },
  );

  it("keeps managed timelines editable while finite authored entrances play", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<iframe id="preview"></iframe>`);
      const iframe = page.frames()[1];
      if (!iframe) throw new Error("Preview iframe did not load");
      await iframe.setContent(`<!doctype html><html><head><style>
        #managed { width: 100px; height: 100px; }
        #mixed, #conditional { opacity: 0; animation: entrance .1s linear forwards; }
        #mixed { animation: pulse 5s linear infinite, entrance .1s linear forwards; }
        #loop { animation-name: pulse; animation-duration: 5s; }
        .endless { animation-iteration-count: infinite; animation-play-state: paused; }
        .loop { animation: pulse 5s linear infinite; }
        .entrance { animation: entrance .1s linear forwards; }
        @keyframes entrance { to { opacity: 1; } }
        @keyframes pulse { from { opacity: .5; } to { opacity: 1; } }
        @keyframes timeline { from { width: 200px; } to { width: 300px; } }
      </style><style data-agent-native-motion>
        @supports (display: grid) { #managed { animation: timeline 5s linear both; } }
        @media (max-width: 0px) { #conditional { animation: timeline 5s linear both; } }
      </style></head><body>
        <div id="managed"></div><div id="mixed">Entrance</div>
        <div id="conditional">Conditional entrance</div><div id="loop" class="endless">Loop</div>
        <div id="cascade" class="loop entrance">Cascade entrance</div>
      </body></html>`);
      await iframe.addScriptTag({ content: editingSafetyBridgeScript() });

      await expect
        .poll(() =>
          iframe.locator("#managed").evaluate((element) => {
            const style = getComputedStyle(element);
            return [style.animationName, style.width];
          }),
        )
        .toEqual(["none", "100px"]);
      await iframe.locator("#managed").evaluate((element) => {
        (element as HTMLElement).style.width = "61px";
      });
      expect(
        await iframe
          .locator("#managed")
          .evaluate((element) => getComputedStyle(element).width),
      ).toBe("61px");
      await expect
        .poll(() =>
          iframe.locator("#mixed").evaluate((element) => {
            const style = getComputedStyle(element);
            return [
              style.animationName,
              style.animationDuration,
              style.opacity,
            ];
          }),
        )
        .toEqual(["none, entrance", "0s, 0.1s", "1"]);
      expect(
        await iframe
          .locator("#loop")
          .evaluate((element) => getComputedStyle(element).animationDuration),
      ).toBe("0s");
      await expect
        .poll(() =>
          iframe
            .locator("#conditional")
            .evaluate((element) => getComputedStyle(element).opacity),
        )
        .toBe("1");
      await expect
        .poll(() =>
          iframe.locator("#cascade").evaluate((element) => {
            const style = getComputedStyle(element);
            return [style.animationName, style.opacity];
          }),
        )
        .toEqual(["entrance", "1"]);

      await iframe.evaluate(() => {
        const style = document.querySelector("style[data-agent-native-motion]");
        if (!style) throw new Error("Managed timeline style is missing");
        style.textContent +=
          "#managed { animation: timeline 10s linear both; }";
      });
      await expect
        .poll(() =>
          iframe
            .locator("#managed")
            .evaluate((element) => getComputedStyle(element).width),
        )
        .toBe("61px");
      await page.evaluate(() => {
        document
          .querySelector<HTMLIFrameElement>("#preview")
          ?.contentWindow?.postMessage(
            {
              type: "embedded-canvas-gesture-mode",
              editingSafetyEnabled: false,
            },
            "*",
          );
      });
      await expect
        .poll(() =>
          iframe
            .locator("#managed")
            .evaluate((element) => getComputedStyle(element).animationName),
        )
        .toBe("timeline");
      expect(
        await iframe
          .locator("#loop")
          .evaluate((element) => getComputedStyle(element).animationDuration),
      ).toBe("5s");
    } finally {
      await browser.close();
    }
  });

  it(
    "captures Space-drag in the iframe without forwarding host hotkeys unless enabled",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(`<iframe id="preview" style="width:640px;height:480px;border:0"></iframe>
          <script>
            window.__bridgeMessages = [];
            window.addEventListener('message', event => window.__bridgeMessages.push(event.data));
          </script>`);
        const iframe = page.frames()[1];
        await iframe.setContent(
          `<button id="target" style="margin:80px;width:180px;height:80px">Drag</button>`,
        );
        await iframe.evaluate(() => {
          (window as any).__appPointerDowns = 0;
          (window as any).__appClicks = 0;
          document
            .querySelector("#target")
            ?.addEventListener(
              "pointerdown",
              () => (window as any).__appPointerDowns++,
            );
          document
            .querySelector("#target")
            ?.addEventListener("click", () => (window as any).__appClicks++);
        });
        await iframe.addScriptTag({ content: editingSafetyBridgeScript() });

        await iframe.evaluate(() => window.focus());
        const box = await page
          .frameLocator("#preview")
          .locator("#target")
          .boundingBox();
        expect(box).not.toBeNull();
        const x = box!.x + box!.width / 2;
        const y = box!.y + box!.height / 2;

        await page.mouse.move(x, y);
        await page.keyboard.down("Space");
        await page.mouse.down();
        await page.mouse.move(x + 48, y + 24, { steps: 3 });
        await page.mouse.up();
        await page.keyboard.up("Space");
        await page.waitForTimeout(50);

        const editModeMessages = await page.evaluate(
          () => (window as any).__bridgeMessages,
        );
        const appInteractions = await iframe.evaluate(() => ({
          pointerDowns: (window as any).__appPointerDowns,
          clicks: (window as any).__appClicks,
        }));
        expect(
          editModeMessages
            .filter((message: any) => message.type === "embedded-canvas-pan")
            .map((message: any) => message.phase),
        ).toEqual(["start", "move", "move", "move", "end"]);
        expect(
          editModeMessages.some(
            (message: any) => message.type === "design-hotkey",
          ),
        ).toBe(false);
        expect(appInteractions.pointerDowns).toBe(0);
        expect(appInteractions.clicks).toBe(0);

        await iframe.evaluate(() => {
          (window as any).__spaceForwardingModeReceived = false;
          window.addEventListener("message", (event) => {
            if (
              event.data?.type === "embedded-canvas-gesture-mode" &&
              event.data.spaceKeyForwardingEnabled === true
            ) {
              (window as any).__spaceForwardingModeReceived = true;
            }
          });
        });
        await page.evaluate(() => {
          document
            .querySelector<HTMLIFrameElement>("#preview")
            ?.contentWindow?.postMessage(
              {
                type: "embedded-canvas-gesture-mode",
                wheelEnabled: false,
                spaceKeyForwardingEnabled: true,
              },
              "*",
            );
        });
        await iframe.waitForFunction(
          () => (window as any).__spaceForwardingModeReceived === true,
        );
        await page.keyboard.down("Space");
        await page.mouse.down();
        await page.mouse.move(x + 72, y + 24, { steps: 2 });
        await page.mouse.up();
        await page.keyboard.up("Space");
        await page.waitForFunction(() =>
          (window as any).__bridgeMessages.some(
            (message: any) => message.type === "design-hotkey-up",
          ),
        );
        const forwarded = await page.evaluate(() =>
          (window as any).__bridgeMessages
            .filter((message: any) =>
              ["design-hotkey", "design-hotkey-up"].includes(message.type),
            )
            .map((message: any) => message.type),
        );
        expect(forwarded).toEqual(["design-hotkey", "design-hotkey-up"]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "lets Space held in one live frame pan a different live frame",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: 900, height: 500 },
        });
        await page.setContent(`<style>
          html,body,#canvas{margin:0;width:100%;height:100%}#canvas{position:relative}
          iframe{position:absolute;width:360px;height:300px;border:0}
          #keyboard{left:20px;top:20px}#pointer{left:430px;top:20px}
        </style><div id="canvas"><iframe id="keyboard" name="keyboard"></iframe><iframe id="pointer" name="pointer"></iframe></div>
        <script>
          window.__bridgeMessages=[];
          window.addEventListener('message',event=>{
            const message=event.data;
            const frames=[...document.querySelectorAll('iframe')];
            const source=event.source===frames[1].contentWindow?'pointer':'keyboard';
            window.__bridgeMessages.push({message,source});
            if(message?.type==='design-hotkey'&&message.code==='Space'){
              frames.forEach(frame=>frame.contentWindow.postMessage({type:'embedded-canvas-pan-mode',leftButtonEnabled:true},'*'));
            }
            if(message?.type==='design-hotkey-up'&&message.code==='Space'){
              frames.forEach(frame=>frame.contentWindow.postMessage({type:'embedded-canvas-pan-mode',leftButtonEnabled:false},'*'));
            }
          });
        </script>`);

        for (const id of ["keyboard", "pointer"]) {
          const frame = page
            .frames()
            .find((candidate) => candidate.name() === id);
          expect(frame).toBeDefined();
          await frame!.setContent(
            `<div id="target" style="margin:70px;width:180px;height:90px;background:#ddd">${id}</div><script>window.__appPointerDowns=0;document.querySelector('#target').addEventListener('pointerdown',()=>window.__appPointerDowns++);</script>`,
          );
          await frame!.addScriptTag({
            content: editingSafetyBridgeScript(true, true),
          });
        }

        const keyboardTarget = page
          .frameLocator("#keyboard")
          .locator("#target");
        const pointerTarget = page.frameLocator("#pointer").locator("#target");
        const keyboardBox = await keyboardTarget.boundingBox();
        const pointerBox = await pointerTarget.boundingBox();
        expect(keyboardBox).not.toBeNull();
        expect(pointerBox).not.toBeNull();

        await page.mouse.click(
          keyboardBox!.x + keyboardBox!.width / 2,
          keyboardBox!.y + keyboardBox!.height / 2,
        );
        expect(
          await page.evaluate(
            () => (document.activeElement as HTMLIFrameElement | null)?.id,
          ),
        ).toBe("keyboard");
        await page.keyboard.down("Space");
        await page.waitForFunction(() =>
          (window as any).__bridgeMessages.some(
            ({ message }: any) =>
              message.type === "design-hotkey" && message.code === "Space",
          ),
        );

        const x = pointerBox!.x + pointerBox!.width / 2;
        const y = pointerBox!.y + pointerBox!.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 56, y + 32, { steps: 4 });
        await page.mouse.up();
        await page.keyboard.up("Space");

        const pointerMessages = await page.evaluate(() =>
          (window as any).__bridgeMessages
            .filter(
              ({ message, source }: any) =>
                source === "pointer" && message.type === "embedded-canvas-pan",
            )
            .map(({ message }: any) => message),
        );
        expect(pointerMessages.map((message: any) => message.phase)).toEqual([
          "start",
          "move",
          "move",
          "move",
          "move",
          "end",
        ]);
        expect(
          pointerMessages.some(
            (message: any) => message.movementX > 0 && message.movementY > 0,
          ),
        ).toBe(true);
        expect(
          await page
            .frames()[2]
            .evaluate(() => (window as any).__appPointerDowns),
        ).toBe(0);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "releases Space-pan ownership when switching into Interact",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(
          `<button id="target" style="margin:80px;width:180px;height:80px">App action</button>
          <script>
            window.__bridgeMessages = [];
            window.addEventListener('message', event => window.__bridgeMessages.push(event.data));
            window.__appPointerDowns = 0;
            window.__appClicks = 0;
            document.querySelector('#target').addEventListener('pointerdown', () => window.__appPointerDowns++);
            document.querySelector('#target').addEventListener('click', () => window.__appClicks++);
          </script>`,
        );
        await page.addScriptTag({
          content: editingSafetyBridgeScript(true, true),
        });
        await page.evaluate(() => {
          const chromeHost = document.createElement("div");
          chromeHost.setAttribute("data-agent-native-editor-chrome-host", "");
          document.body.append(chromeHost);
        });

        const box = await page.locator("#target").boundingBox();
        expect(box).not.toBeNull();
        const x = box!.x + box!.width / 2;
        const y = box!.y + box!.height / 2;
        await page.mouse.move(x, y);
        await page.keyboard.down("Space");
        await page.mouse.down();
        await page.mouse.move(x + 24, y + 8);
        await page.evaluate(() => {
          window.postMessage(
            {
              type: "embedded-canvas-gesture-mode",
              wheelEnabled: false,
              spaceKeyForwardingEnabled: true,
              editingSafetyEnabled: false,
            },
            "*",
          );
        });
        await page.waitForFunction(() =>
          (window as any).__bridgeMessages.some(
            (message: any) =>
              message.type === "embedded-canvas-pan" &&
              message.phase === "cancel",
          ),
        );
        await page.mouse.up();
        await page.evaluate(() => {
          (window as any).__appPointerDowns = 0;
          (window as any).__appClicks = 0;
        });
        await page.mouse.click(x, y);
        await page.keyboard.up("Space");

        const result = await page.evaluate(() => ({
          panPhases: (window as any).__bridgeMessages
            .filter((message: any) => message.type === "embedded-canvas-pan")
            .map((message: any) => message.phase),
          pointerDowns: (window as any).__appPointerDowns,
          clicks: (window as any).__appClicks,
        }));
        expect(result.panPhases).toEqual(["start", "move", "cancel"]);
        expect(
          await page.evaluate(() =>
            (window as any).__bridgeMessages
              .filter((message: any) =>
                ["design-hotkey", "design-hotkey-up"].includes(message.type),
              )
              .map((message: any) => message.type),
          ),
        ).toEqual(["design-hotkey", "design-hotkey-up"]);
        expect(result.pointerDowns).toBe(1);
        expect(result.clicks).toBe(1);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "preserves authored animations, blocks link/form navigation, and reports full reloads",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      const pageErrors: string[] = [];
      try {
        const page = await browser.newPage();
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.setContent(`<!doctype html><html><head><style>
          @keyframes drift { to { opacity: 0.8 } }
          html, body { animation: drift 3s linear forwards; transition: opacity 1s }
          #animated { animation: drift 3s linear forwards; transition: opacity 1s }
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
          const authored = await page.locator(selector).evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              animationName: style.animationName,
              transitionDuration: style.transitionDuration,
            };
          });
          expect(authored.animationName).toBe("drift");
          expect(authored.transitionDuration).toBe("0s");
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

  it(
    "keeps authored animations while toggling transition suppression between Interact and Design",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(`<!doctype html><html><head><style>
          @keyframes drift { to { transform: translateX(20px) } }
          #animated { animation: drift 3s linear forwards; transition: opacity 1s }
        </style></head><body><div id="animated">Animated</div></body></html>`);
        await page.addScriptTag({ content: editingSafetyBridgeScript(false) });

        const live = await page.locator("#animated").evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            animationName: style.animationName,
            transitionDuration: style.transitionDuration,
            safetyStylePresent: Boolean(
              document.querySelector(
                "style[data-agent-native-editing-safety-style]",
              ),
            ),
          };
        });
        expect(live).toEqual({
          animationName: "drift",
          transitionDuration: "1s",
          safetyStylePresent: false,
        });

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "embedded-canvas-gesture-mode",
              editingSafetyEnabled: true,
            },
            "*",
          );
        });
        await expect
          .poll(() =>
            page.locator("#animated").evaluate((element) => {
              const style = getComputedStyle(element);
              return {
                animationName: style.animationName,
                transitionDuration: style.transitionDuration,
                safetyStylePresent: Boolean(
                  document.querySelector(
                    "style[data-agent-native-editing-safety-style]",
                  ),
                ),
              };
            }),
          )
          .toEqual({
            animationName: "drift",
            transitionDuration: "0s",
            safetyStylePresent: true,
          });

        await page.evaluate(() => {
          window.postMessage(
            {
              type: "embedded-canvas-gesture-mode",
              editingSafetyEnabled: false,
            },
            "*",
          );
        });
        await expect
          .poll(() =>
            page.locator("#animated").evaluate((element) => {
              const style = getComputedStyle(element);
              return {
                animationName: style.animationName,
                transitionDuration: style.transitionDuration,
                safetyStylePresent: Boolean(
                  document.querySelector(
                    "style[data-agent-native-editing-safety-style]",
                  ),
                ),
              };
            }),
          )
          .toEqual(live);
      } finally {
        await browser.close();
      }
    },
  );
});
