// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

describe("macOS window controls with the Settings overlay", () => {
  afterEach(() => {
    document.body.className = "";
    document.body.innerHTML = "";
  });

  it("matches controls when Settings is inside the shell", () => {
    document.body.classList.add("platform-darwin");
    document.body.innerHTML = `
      <div class="shell">
        <div class="collapsed-mac-window-controls"></div>
        <div class="settings-overlay"></div>
      </div>
      `;
    const controls = document.querySelector(".collapsed-mac-window-controls");

    expect(
      controls?.matches(
        ".platform-darwin .shell:has(.settings-overlay) .collapsed-mac-window-controls",
      ),
    ).toBe(true);
  });
});
