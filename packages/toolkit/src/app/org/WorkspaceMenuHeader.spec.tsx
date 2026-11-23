// @vitest-environment happy-dom
// The reference leads its workspace menu with a card: the workspace name over the member count.
// Ours opened straight into menu rows. This pins the card, and it fails if the card is removed or if
// the member count stops rendering, which is the control the fixer receipt needs.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  WorkspaceMenuHeader,
  workspaceMembersLabel,
} from "./WorkspaceMenuHeader";

const membersLabel = (count: number) => `${count} members`;

let node: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(ui: React.ReactNode) {
  node = document.createElement("div");
  document.body.appendChild(node);
  root = createRoot(node);
  await act(async () => root!.render(ui));
  return node;
}

beforeEach(() => {
  node = null;
  root = null;
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  node?.remove();
});

describe("workspace menu header", () => {
  it("shows the workspace name over its member count", async () => {
    const el = await mount(
      <WorkspaceMenuHeader
        name="Builder"
        memberCount={88}
        membersLabel={membersLabel}
      />,
    );
    expect(
      el.querySelector("[data-workspace-menu-header-name]")?.textContent,
    ).toBe("Builder");
    const members = el.querySelector("[data-workspace-menu-header-members]");
    expect(members?.textContent).toBe("88 members");
    expect(members?.getAttribute("data-workspace-menu-header-members")).toBe(
      "88",
    );
  });

  it("carries no plan or upgrade text", async () => {
    const el = await mount(
      <WorkspaceMenuHeader
        name="Builder"
        memberCount={88}
        membersLabel={membersLabel}
      />,
    );
    expect(el.textContent ?? "").not.toMatch(
      /plus|business|pro\b|upgrade|free trial/i,
    );
  });

  it("shows the name alone while the count is still loading", async () => {
    const el = await mount(
      <WorkspaceMenuHeader
        name="Builder"
        memberCount={null}
        membersLabel={membersLabel}
      />,
    );
    expect(
      el.querySelector("[data-workspace-menu-header-name]"),
    ).not.toBeNull();
    expect(el.querySelector("[data-workspace-menu-header-members]")).toBeNull();
  });

  // The ticket: the menu showed the humanized key ("Members count") because the catalogue message
  // was an ICU plural and content-2's i18n has no plural helper. The label now picks a plain
  // singular/plural message. Mutant that fails this: calling
  // "agentChat.accountMenu.membersCount" again, or dropping the count argument.
  it("formats the member count from plain singular/plural messages", () => {
    const calls: Array<{ key: string; vars?: Record<string, unknown> }> = [];
    const t = (key: string, vars?: Record<string, unknown>) => {
      calls.push({ key, vars });
      const fill = String(vars?.count ?? "");
      return key === "agentChat.accountMenu.membersCountOne"
        ? `${fill} member`
        : `${fill} members`;
    };
    expect(workspaceMembersLabel(1, t)).toBe("1 member");
    expect(workspaceMembersLabel(88, t)).toBe("88 members");
    expect(calls.map((c) => c.key)).toEqual([
      "agentChat.accountMenu.membersCountOne",
      "agentChat.accountMenu.membersCountOther",
    ]);
    expect(calls.every((c) => c.vars?.count !== undefined)).toBe(true);
    expect(
      calls.some((c) => c.key === "agentChat.accountMenu.membersCount"),
    ).toBe(false);
  });

  it("never renders a humanized catalogue key", async () => {
    const t = (key: string, vars?: Record<string, unknown>) =>
      key === "agentChat.accountMenu.membersCountOne"
        ? `${vars?.count} member`
        : `${vars?.count} members`;
    const el = await mount(
      <WorkspaceMenuHeader
        name="Builder"
        memberCount={1}
        membersLabel={(count) => workspaceMembersLabel(count, t as never)}
      />,
    );
    expect(el.textContent ?? "").toContain("1 member");
    expect(el.textContent ?? "").not.toMatch(/Members count|membersCount/);
  });
});
