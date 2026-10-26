// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  agentSelectNodeIdentity,
  findAgentSelectNode,
} from "./node-identity.js";

function container(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

function nth(root: Element, selector: string, index: number): Element {
  const element = Array.from(root.querySelectorAll(selector)).at(index);
  if (!element) throw new Error(`Missing ${selector} ${index}`);
  return element;
}

describe("agent select node identity", () => {
  it("finds the node again after the container re-renders", () => {
    const root = container("<h1>Title</h1><p>Body</p>");
    const identity = agentSelectNodeIdentity(nth(root, "p", 0), root);
    expect(identity.path).toBe("p:nth-child(2)");

    root.innerHTML = root.innerHTML;
    expect(findAgentSelectNode(root, identity)?.textContent).toBe("Body");
  });

  it("follows a node whose earlier sibling was removed", () => {
    const root = container("<p>First</p><p>Second</p>");
    const identity = agentSelectNodeIdentity(nth(root, "p", 1), root);

    nth(root, "p", 0).remove();
    expect(findAgentSelectNode(root, identity)?.textContent).toBe("Second");
  });

  it("keeps a node edited in place between unchanged neighbours", () => {
    const root = container("<p>Alpha</p><p>Bravo</p><p>Charlie</p>");
    const identity = agentSelectNodeIdentity(nth(root, "p", 1), root);

    nth(root, "p", 1).textContent = "Bravo edited";
    expect(findAgentSelectNode(root, identity)?.textContent).toBe(
      "Bravo edited",
    );
  });

  it("does not rebind to a neighbour that moved onto the path", () => {
    const root = container("<p>Alpha</p><p>Bravo</p><p>Charlie</p>");
    const identity = agentSelectNodeIdentity(nth(root, "p", 1), root);

    nth(root, "p", 1).textContent = "Bravo edited";
    nth(root, "p", 0).remove();
    root.insertAdjacentHTML("beforeend", "<p>Delta</p>");
    expect(findAgentSelectNode(root, identity)).toBeNull();
  });

  it("is gone when the node was deleted", () => {
    const root = container("<p>Only</p>");
    const identity = agentSelectNodeIdentity(nth(root, "p", 0), root);

    nth(root, "p", 0).remove();
    expect(findAgentSelectNode(root, identity)).toBeNull();
  });
});
