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
    .replace("__EDITING_SAFETY_ENABLED__", String(enabled));
}

describe("editing safety bridge", () => {
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
        await page.waitForTimeout(0);
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

  it(
    "live-toggles authored animation and transitions between Interact and Design",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(`<!doctype html><html><head><style>
          @keyframes drift { to { transform: translateX(20px) } }
          #animated { animation: drift 3s linear infinite; transition: opacity 1s }
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
            animationName: "none",
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
