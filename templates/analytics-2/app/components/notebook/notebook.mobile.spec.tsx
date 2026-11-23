// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import notebookStyles from "./notebook.css?inline";
import dataBrowserDialogStyles from "./ProjectDataBrowserDialog.css?inline";

type Happy = { happyDOM: { setViewport(viewport: { width: number }): void } };
const happy = () => (window as unknown as Happy).happyDOM;

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  happy().setViewport({ width: 1280 });
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: 0,
    configurable: true,
  });
});

function setTouch(enabled: boolean) {
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: enabled ? 1 : 0,
    configurable: true,
  });
}

function mountCell() {
  const style = document.createElement("style");
  style.textContent = notebookStyles;
  document.head.append(style);
  document.body.innerHTML = `<div class="nb-cell-slot"><div class="nb-cell"><div class="nb-cell-frame"></div><div class="nb-cell-actions"></div></div><div class="nb-insert"><button class="nb-insert-button"></button></div></div>`;
  const get = (selector: string) =>
    document.querySelector(selector) as HTMLElement;
  return {
    cell: get(".nb-cell"),
    actions: get(".nb-cell-actions"),
    insert: get(".nb-insert-button"),
  };
}

it("gives the notebook cell the full phone width and keeps its actions reachable", () => {
  happy().setViewport({ width: 390 });
  const { cell, actions } = mountCell();
  const columns =
    getComputedStyle(cell).gridTemplateColumns.split(/\s+(?![^(]*\))/);
  expect(columns).toHaveLength(2);
  expect(getComputedStyle(actions).gridArea.replace(/\s/g, "")).toBe("2/2");
  expect(getComputedStyle(actions).opacity).toBe("1");
});

it("keeps the three-column cell with hover-revealed actions on desktop", () => {
  happy().setViewport({ width: 1280 });
  const { cell, actions } = mountCell();
  expect(getComputedStyle(cell).gridTemplateColumns).toContain(
    "minmax(0, 1fr)",
  );
  expect(getComputedStyle(actions).opacity).toBe("0");
});

it("sizes notebook header, rail, and add-bar tap targets to at least 44px on coarse pointers", () => {
  happy().setViewport({ width: 390 });
  setTouch(true);
  const style = document.createElement("style");
  style.textContent = notebookStyles;
  document.head.append(style);
  document.body.innerHTML = `
    <header class="nb-header">
      <div class="nb-header-left">
        <a class="nb-brand-mark"></a>
        <button class="nb-project-title">Revenue</button>
      </div>
    </header>
    <div class="nb-tool-rail">
      <button class="nb-tool-rail-button"></button>
    </div>
    <button class="nb-side-panel-close"></button>
    <button class="nb-add-button">SQL</button>
    <div class="nb-app-grid-controls"><button></button></div>
  `;

  for (const selector of [
    ".nb-brand-mark",
    ".nb-tool-rail-button",
    ".nb-side-panel-close",
    ".nb-app-grid-controls button",
  ]) {
    const el = document.querySelector<HTMLElement>(selector)!;
    expect(getComputedStyle(el).minWidth).toBe("44px");
    expect(getComputedStyle(el).minHeight).toBe("44px");
  }
  for (const selector of [".nb-project-title", ".nb-add-button"]) {
    const el = document.querySelector<HTMLElement>(selector)!;
    expect(getComputedStyle(el).minHeight).toBe("44px");
  }
});

it("preserves compact desktop dimensions for header brand and tool rail buttons", () => {
  happy().setViewport({ width: 1280 });
  setTouch(false);
  const style = document.createElement("style");
  style.textContent = notebookStyles;
  document.head.append(style);
  document.body.innerHTML = `
    <a class="nb-brand-mark"></a>
    <button class="nb-tool-rail-button"></button>
  `;
  expect(
    getComputedStyle(document.querySelector(".nb-brand-mark")!).width,
  ).toBe("24px");
  expect(
    getComputedStyle(document.querySelector(".nb-tool-rail-button")!).width,
  ).toBe("28px");
});

it("keeps the add-bar split trigger beside the Text button on coarse touch", () => {
  happy().setViewport({ width: 390 });
  setTouch(true);
  const style = document.createElement("style");
  style.textContent = notebookStyles;
  document.head.append(style);
  document.body.innerHTML = `
    <div class="nb-add-split">
      <button type="button" class="nb-add-button">Text</button>
      <button type="button" class="nb-icon-button nb-add-split-trigger" aria-label="Text cell options"></button>
    </div>
  `;
  const split = document.querySelector<HTMLElement>(".nb-add-split")!;
  const trigger = document.querySelector<HTMLElement>(".nb-add-split-trigger")!;

  expect(getComputedStyle(split).display).toBe("inline-flex");
  expect(getComputedStyle(trigger).position).toBe("static");
});

it("keeps the add-bar split trigger overlaid on desktop fine pointers", () => {
  happy().setViewport({ width: 1280 });
  setTouch(false);
  const style = document.createElement("style");
  style.textContent = notebookStyles;
  document.head.append(style);
  document.body.innerHTML = `
    <div class="nb-add-split">
      <button type="button" class="nb-add-button">Text</button>
      <button type="button" class="nb-icon-button nb-add-split-trigger" aria-label="Text cell options"></button>
    </div>
  `;
  const trigger = document.querySelector<HTMLElement>(".nb-add-split-trigger")!;

  expect(getComputedStyle(trigger).position).toBe("absolute");
});

it("reserves 44px for the between-cell insert strip on coarse touch", () => {
  happy().setViewport({ width: 390 });
  setTouch(true);
  const style = document.createElement("style");
  style.textContent = notebookStyles;
  document.head.append(style);
  document.body.innerHTML = `
    <div class="nb-cell-slot">
      <div class="nb-cell"></div>
      <div class="nb-insert"><button class="nb-insert-button"></button></div>
    </div>
  `;
  const slot = document.querySelector<HTMLElement>(".nb-cell-slot")!;
  const insert = document.querySelector<HTMLElement>(".nb-insert")!;

  expect(getComputedStyle(slot).paddingBottom).toBe("44px");
  expect(getComputedStyle(insert).height).toBe("44px");
});

it("keeps the 24px between-cell insert strip on desktop fine pointers", () => {
  happy().setViewport({ width: 1280 });
  setTouch(false);
  const style = document.createElement("style");
  style.textContent = notebookStyles;
  document.head.append(style);
  document.body.innerHTML = `
    <div class="nb-cell-slot">
      <div class="nb-cell"></div>
      <div class="nb-insert"><button class="nb-insert-button"></button></div>
    </div>
  `;
  const slot = document.querySelector<HTMLElement>(".nb-cell-slot")!;
  const insert = document.querySelector<HTMLElement>(".nb-insert")!;

  expect(getComputedStyle(slot).paddingBottom).toBe("24px");
  expect(getComputedStyle(insert).height).toBe("24px");
});

it("allows data browser row labels to shrink and stacks the data browser dialog on phone width", () => {
  happy().setViewport({ width: 390 });
  const style = document.createElement("style");
  style.textContent = `${notebookStyles}\n${dataBrowserDialogStyles}`;
  document.head.append(style);
  document.body.innerHTML = `
    <div class="nb-data-browser-row">
      <button type="button" class="nb-outline-item">
        <span class="nb-outline-name">very_long_table_name</span>
      </button>
      <button type="button" class="nb-button">Import</button>
      <button type="button" class="nb-button">Query</button>
    </div>
    <div class="nb-data-browser-dialog">
      <div class="nb-data-browser-body">
        <div class="nb-data-browser-tree"></div>
        <div class="nb-data-browser-detail"></div>
      </div>
    </div>
  `;
  const item = document.querySelector<HTMLElement>(
    ".nb-data-browser-row .nb-outline-item",
  )!;
  const body = document.querySelector<HTMLElement>(".nb-data-browser-body")!;
  const tree = document.querySelector<HTMLElement>(".nb-data-browser-tree")!;

  expect(getComputedStyle(item).minWidth).toMatch(/^0(px)?$/);
  expect(getComputedStyle(item).width).toBe("auto");
  expect(getComputedStyle(body).flexDirection).toBe("column");
  expect(getComputedStyle(tree).width).toBe("100%");
});

it("keeps the desktop side-by-side data browser dialog layout", () => {
  happy().setViewport({ width: 1280 });
  const style = document.createElement("style");
  style.textContent = dataBrowserDialogStyles;
  document.head.append(style);
  document.body.innerHTML = `
    <div class="nb-data-browser-dialog">
      <div class="nb-data-browser-body">
        <div class="nb-data-browser-tree"></div>
        <div class="nb-data-browser-detail"></div>
      </div>
    </div>
  `;
  const body = document.querySelector<HTMLElement>(".nb-data-browser-body")!;
  const tree = document.querySelector<HTMLElement>(".nb-data-browser-tree")!;

  expect(getComputedStyle(body).flexDirection).not.toBe("column");
  expect(getComputedStyle(tree).width).toBe("300px");
});

it("hides the agent pane in app view at phone width while showing it in agent view", () => {
  happy().setViewport({ width: 390 });
  const style = document.createElement("style");
  style.textContent = notebookStyles;
  document.head.append(style);
  document.body.innerHTML = `
    <div class="nb-root" data-notebook-view="app">
      <div class="nb-main-card"></div>
      <aside class="nb-agent-pane"></aside>
    </div>
  `;
  const root = document.querySelector<HTMLElement>(".nb-root")!;
  const agentPane = document.querySelector<HTMLElement>(".nb-agent-pane")!;
  expect(getComputedStyle(agentPane).display).toBe("none");

  root.dataset.notebookView = "agent";
  expect(getComputedStyle(agentPane).display).not.toBe("none");
  expect(getComputedStyle(agentPane).width).toBe("100%");
});

function mountHeader() {
  const style = document.createElement("style");
  style.textContent = notebookStyles;
  document.head.append(style);
  document.body.innerHTML = `
    <header class="nb-header">
      <div class="nb-header-left"><button class="nb-project-title">Revenue</button></div>
      <div class="nb-header-center"><nav class="nb-view-tabs" aria-label="Project views"></nav></div>
      <div class="nb-header-right"><button>Publish app</button></div>
    </header>
  `;
  const style_ = (selector: string) =>
    getComputedStyle(document.querySelector<HTMLElement>(selector)!);
  return {
    header: style_(".nb-header"),
    left: style_(".nb-header-left"),
    center: style_(".nb-header-center"),
    right: style_(".nb-header-right"),
  };
}

const cols = (value: string) => value.split(/\s+(?![^(]*\))/);

it("M5-MOBILE-W1: stacks the project view tabs on their own row below the header actions on phones", () => {
  happy().setViewport({ width: 390 });
  const { header, left, center, right } = mountHeader();
  expect(cols(header.gridTemplateColumns)).toHaveLength(2);
  expect(cols(header.gridTemplateRows)).toHaveLength(2);
  expect(left.gridRow).toBe("1");
  expect(right.gridRow).toBe("1");
  expect(center.gridRow).toBe("2");
  expect(center.gridColumn.replace(/\s/g, "")).toBe("1/-1");
});

it("M5-MOBILE-W1: keeps the single-row three-column header on desktop", () => {
  happy().setViewport({ width: 1280 });
  const { header, center } = mountHeader();
  expect(cols(header.gridTemplateColumns)).toHaveLength(3);
  expect(center.gridRow).not.toBe("2");
});
