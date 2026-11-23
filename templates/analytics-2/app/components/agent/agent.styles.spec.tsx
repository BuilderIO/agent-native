// @vitest-environment happy-dom
import { assert, expect, it } from "vitest";

import globalStyles from "../../global.css?raw";
import notebookStyles from "../notebook/notebook.css?raw";
import agentStyles from "./agent.css?raw";

it("report B-KEYSCREENS-S4-THREAD-TOKENS: applies original composer and bubble tokens to thread pages", () => {
  const host = document.createElement("div");
  host.className = "ws-agent ws-agent-thread";
  host.innerHTML = `
    <div class="agentkit-transcript">
      <div class="agentkit-message" data-role="user">
        <div class="agentkit-message-content">Hello</div>
      </div>
    </div>
    <form class="agent-composer-root">
      <button type="submit" class="agent-composer-send-button">Send</button>
    </form>
  `;
  const styles = document.createElement("style");
  styles.textContent = agentStyles;
  document.head.append(styles);
  document.body.append(host);
  try {
    const composer = host.querySelector<HTMLElement>(
      "form.agent-composer-root",
    );
    const send = host.querySelector<HTMLElement>(
      "button.agent-composer-send-button",
    );
    const bubble = host.querySelector<HTMLElement>(".agentkit-message-content");
    assert(composer && send && bubble);
    expect(getComputedStyle(composer).borderTopLeftRadius).toBe("8px");
    expect(getComputedStyle(composer).paddingTop).toBe("6px");
    expect(getComputedStyle(send).borderTopLeftRadius).toBe("3px");
    expect(getComputedStyle(bubble).borderTopLeftRadius).toBe("12px");
  } finally {
    host.remove();
    styles.remove();
  }
});

it("report B-KEYSCREENS-S4-THREAD-TYPOGRAPHY: matches original thread transcript background, paragraph spacing, inline code, and docs link tokens", () => {
  const host = document.createElement("div");
  host.innerHTML = `
    <div class="ws-agent ws-agent-thread">
      <div class="agentkit-transcript">
        <div class="agentkit-message" data-role="assistant">
          <div class="agentkit-message-content">
            <p>Created chart with <code>value</code> by <code>name</code>.</p>
          </div>
        </div>
      </div>
    </div>
    <aside class="nb-agent-pane">
      <a class="underline" href="#">Learn more</a>
    </aside>
  `;
  const styles = document.createElement("style");
  styles.textContent = `${globalStyles}\n${notebookStyles}\n${agentStyles}`;
  document.head.append(styles);
  document.body.append(host);
  try {
    const transcript = host.querySelector<HTMLElement>(".agentkit-transcript");
    const paragraph = host.querySelector<HTMLElement>(
      '.agentkit-message[data-role="assistant"] p',
    );
    const code = host.querySelector<HTMLElement>(
      '.agentkit-message[data-role="assistant"] code',
    );
    const docsLink = host.querySelector<HTMLElement>(
      ".nb-agent-pane a.underline",
    );
    assert(transcript && paragraph && code && docsLink);
    expect(getComputedStyle(transcript).backgroundColor).toBe("#ffffff");
    expect(getComputedStyle(paragraph).paddingTop).toBe("4px");
    expect(getComputedStyle(paragraph).paddingBottom).toBe("4px");
    expect(getComputedStyle(code).fontSize).toBe("14px");
    expect(getComputedStyle(code).paddingLeft).toBe("0px");
    expect(getComputedStyle(code).borderTopLeftRadius).toBe("0px");
    expect(getComputedStyle(code).backgroundColor).toBe("transparent");
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--notebook-agent-link")
        .trim(),
    ).toBe("219 56% 33%");
  } finally {
    host.remove();
    styles.remove();
  }
});

it("report B-KEYSCREENS-S3-AGENT-PANE: matches original notebook agent pane header, tip, composer wrapper, Ask trigger, and heading styles", () => {
  const host = document.createElement("div");
  host.innerHTML = `
    <aside class="nb-agent-pane">
      <div class="ws-agent-thread-picker">
        <button type="button" aria-haspopup="menu">New thread</button>
        <button type="button" class="ws-agent-thread-new">+</button>
      </div>
      <h2>What do you want to know?</h2>
      <div class="agentkit-host-composer">
        <div class="ws-agent-notebook-tip">
          <span>Get better answers in &lt; 5 minutes</span>
          <a href="#">Add context</a>
        </div>
        <form class="agent-composer-root">
          <button type="button" aria-haspopup="dialog">Ask</button>
        </form>
      </div>
    </aside>
  `;
  const styles = document.createElement("style");
  styles.textContent = `${globalStyles}\n${notebookStyles}\n${agentStyles}`;
  document.head.append(styles);
  document.body.append(host);
  try {
    const pickerBtn = host.querySelector<HTMLElement>(
      '.ws-agent-thread-picker button[aria-haspopup="menu"]',
    );
    const newBtn = host.querySelector<HTMLElement>(".ws-agent-thread-new");
    const heading = host.querySelector<HTMLElement>(".nb-agent-pane h2");
    const hostComposer = host.querySelector<HTMLElement>(
      ".agentkit-host-composer",
    );
    const tip = host.querySelector<HTMLElement>(".ws-agent-notebook-tip");
    const askBtn = host.querySelector<HTMLElement>(
      'form.agent-composer-root button[aria-haspopup="dialog"]',
    );
    assert(pickerBtn && newBtn && heading && hostComposer && tip && askBtn);
    expect(getComputedStyle(pickerBtn).fontSize).toBe("12px");
    expect(getComputedStyle(pickerBtn).fontWeight).toBe("400");
    expect(getComputedStyle(pickerBtn).paddingTop).toBe("4px");
    expect(getComputedStyle(newBtn).fontWeight).toBe("400");
    expect(getComputedStyle(newBtn).paddingTop).toBe("5px");
    expect(getComputedStyle(heading).fontWeight).toBe("400");
    expect(getComputedStyle(hostComposer).borderTopLeftRadius).toBe("11px");
    expect(getComputedStyle(hostComposer).borderBottomLeftRadius).toBe("8px");
    expect(getComputedStyle(tip).paddingBottom).toBe("0px");
    expect(getComputedStyle(tip).borderTopLeftRadius).toBe("8px");
    expect(getComputedStyle(askBtn).fontSize).toBe("12px");
    expect(getComputedStyle(askBtn).fontWeight).toBe("400");
    expect(getComputedStyle(askBtn).paddingTop).toBe("4px");
  } finally {
    host.remove();
    styles.remove();
  }
});
