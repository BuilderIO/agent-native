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

function Shell({ children }: { children: ReactNode }) {
  const { host, panelHost: element } = useAgentPanelHost();
  panelHost = element;
  return (
    <AgentPanelHostProvider value={host}>{children}</AgentPanelHostProvider>
  );
}

function Page({ id, enabled = true }: { id: string; enabled?: boolean }) {
  const slot = useRef<HTMLDivElement>(null);
  const shown = useAgentPanelSlot(slot, enabled);
  return <div ref={slot} data-slot={id} data-shown={String(shown)} />;
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

  beforeEach(() => {
    panelHost = undefined;
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
