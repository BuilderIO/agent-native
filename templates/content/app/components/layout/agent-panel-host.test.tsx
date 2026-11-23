// @vitest-environment happy-dom

import { act, type ReactNode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AgentPanelHostProvider,
  useAgentPanelHost,
  useAgentPanelSlot,
  useHoldAgentPanel,
} from "./agent-panel-host";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let panelHost: HTMLElement | null | undefined;
let panelHeadHost: HTMLElement | null | undefined;

function Shell({ children }: { children: ReactNode }) {
  const {
    host,
    panelHost: element,
    panelHeadHost: headElement,
  } = useAgentPanelHost();
  panelHost = element;
  panelHeadHost = headElement;
  return (
    <AgentPanelHostProvider value={host}>{children}</AgentPanelHostProvider>
  );
}

function Page({
  id,
  enabled = true,
  head = false,
}: {
  id: string;
  enabled?: boolean;
  head?: boolean;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const headSlot = useRef<HTMLDivElement>(null);
  const shown = useAgentPanelSlot(slot, enabled, head ? headSlot : undefined);
  return (
    <>
      {head ? <div ref={headSlot} data-head-slot={id} /> : null}
      <div ref={slot} data-slot={id} data-shown={String(shown)} />
    </>
  );
}

function Skeleton() {
  useHoldAgentPanel();
  return null;
}

describe("the agent's panel host", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (children: ReactNode) =>
    act(() => root.render(<Shell>{children}</Shell>));

  const slot = (id: string) =>
    container.querySelector<HTMLElement>(`[data-slot="${id}"]`);
  const headSlot = (id: string) =>
    container.querySelector<HTMLElement>(`[data-head-slot="${id}"]`);

  beforeEach(() => {
    panelHost = undefined;
    panelHeadHost = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("leaves the chat to the shell's sidebar while no page holds it", () => {
    render(null);
    expect(panelHost).toBeUndefined();
    expect(panelHeadHost).toBeUndefined();
  });

  it("puts the chat in a page's slot", () => {
    render(<Page id="one" />);
    expect(panelHost).toBeInstanceOf(HTMLElement);
    expect(panelHost?.parentElement).toBe(slot("one"));
    expect(slot("one")?.dataset.shown).toBe("true");
  });

  it("moves the same element between pages, so the chat does not reload", () => {
    render(<Page key="one" id="one" />);
    const element = panelHost;

    render(<Page key="two" id="two" />);
    expect(panelHost).toBe(element);
    expect(element?.parentElement).toBe(slot("two"));
  });

  it("puts the chat's tools in the head of a page's panel", () => {
    render(<Page id="one" head />);
    expect(panelHeadHost).toBeInstanceOf(HTMLElement);
    expect(panelHeadHost).not.toBe(panelHost);
    expect(panelHeadHost?.parentElement).toBe(headSlot("one"));
    expect(panelHost?.parentElement).toBe(slot("one"));
  });

  it("moves the same tools between pages along with the chat", () => {
    render(<Page key="one" id="one" head />);
    const element = panelHeadHost;

    render(<Page key="two" id="two" head />);
    expect(panelHeadHost).toBe(element);
    expect(element?.parentElement).toBe(headSlot("two"));
  });

  it("leaves the tools out of a page whose panel has no head for them", () => {
    render(<Page key="one" id="one" head />);
    const element = panelHeadHost;

    render(<Page key="two" id="two" />);
    expect(panelHost?.parentElement).toBe(slot("two"));
    expect(element?.parentElement).toBeNull();
  });

  it("holds the chat through a loading page", () => {
    render(<Page key="one" id="one" />);
    const element = panelHost;

    render(<Skeleton key="loading" />);
    expect(panelHost).toBe(element);
    expect(element?.parentElement).toBeNull();

    render(<Page key="two" id="two" />);
    expect(element?.parentElement).toBe(slot("two"));
  });

  it("gives the chat back to the shell when the last page leaves", () => {
    render(<Page id="one" />);
    render(null);
    expect(panelHost).toBeUndefined();
  });

  it("has nothing to hold on a page that keeps no agent", () => {
    render(<Page id="preview" enabled={false} />);
    expect(panelHost).toBeUndefined();
    expect(slot("preview")?.dataset.shown).toBe("false");
  });

  it("says there is no chat outside the app shell", () => {
    act(() => root.render(<Page id="alone" />));
    expect(slot("alone")?.dataset.shown).toBe("false");
  });
});
