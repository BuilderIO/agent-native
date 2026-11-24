import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { EditPanel } from "./EditPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

it("fits the inspector inside bordered floating rails without changing docked or mobile widths", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const { editorWidth, requestedWidth, floating, mobile, expected } of [
      {
        editorWidth: 250,
        requestedWidth: 280,
        floating: true,
        mobile: false,
        expected: 224,
      },
      {
        editorWidth: 400,
        requestedWidth: 400,
        floating: true,
        mobile: false,
        expected: 374,
      },
      {
        editorWidth: 900,
        requestedWidth: 280,
        floating: true,
        mobile: false,
        expected: 278,
      },
      {
        editorWidth: 900,
        requestedWidth: 280,
        floating: false,
        mobile: false,
        expected: 280,
      },
      {
        editorWidth: 900,
        requestedWidth: 400,
        floating: false,
        mobile: false,
        expected: 400,
      },
      {
        editorWidth: 360,
        requestedWidth: 320,
        floating: false,
        mobile: true,
        expected: 360,
      },
    ]) {
      const inspector = renderToStaticMarkup(
        <EditPanel
          selectedElement={null}
          selectedScreenGeometry={{
            id: "screen-1",
            title: "Screen",
            x: 0,
            y: 0,
            width: 800,
            height: 600,
          }}
          viewMode="overview"
          mode="edit"
          onStyleChange={vi.fn()}
          width={requestedWidth}
        />,
      );
      await page.setContent(`
        <style>
          * { box-sizing: border-box; }
          .editor { width: ${editorWidth}px; }
          .rail { width: ${mobile ? editorWidth : requestedWidth}px; ${floating ? "max-width: calc(100% - 24px); border: 1px solid;" : ""} }
          .mobile .design-sidebar { width: 100% !important; }
        </style>
        <div class="editor"><div class="rail ${mobile ? "mobile" : ""}"><div>${inspector}</div></div></div>
      `);
      const size = await page.locator(".design-sidebar").evaluate((element) => {
        if (!element.parentElement) throw new Error("Inspector has no parent");
        return {
          width: element.getBoundingClientRect().width,
          parentWidth: element.parentElement.getBoundingClientRect().width,
        };
      });
      expect(size).toEqual({ width: expected, parentWidth: expected });
    }
  } finally {
    await browser.close();
  }
});
