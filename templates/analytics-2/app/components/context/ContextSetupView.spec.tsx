import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const contextSetup = {
  progressPercent: 50,
  completedSteps: ["connect", "endorse"] as const,
};

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (action: string) => ({
    data: action === "get-workspace-context-setup" ? contextSetup : undefined,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("react-router", () => ({
  useLocation: () => ({ hash: "" }),
  Link: ({
    to,
    className,
    children,
  }: {
    to: string;
    className?: string;
    children: unknown;
  }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));

const { ContextSetupView, contextSetupSectionId } =
  await import("./ContextSetupView");

const ORDER = [
  ["connect", "Connect"],
  ["endorse", "Endorse"],
  ["improve", "Improve"],
  ["reference", "Reference"],
  ["extend", "Extend"],
  ["govern", "Govern"],
] as const;

describe("Context Studio setup sections", () => {
  const html = renderToStaticMarkup(<ContextSetupView />);

  it("opens with the source's headline and introduction, not the rail label", () => {
    expect(html).toMatch(
      /<h1 class="context-studio-title">context\.setup\.heading<\/h1><p class="context-studio-description">context\.setup\.intro<\/p>/,
    );
    expect(html).not.toContain(">context.rail.setup<");
  });

  it("renders the source's six steps in the source's order", () => {
    const positions = ORDER.map(([, action]) =>
      html.indexOf(`>${action}</span>`),
    );
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("gives every section the anchor id the Home stepper links to", () => {
    for (const [step] of ORDER) {
      expect(html).toContain(`id="${contextSetupSectionId(step)}"`);
    }
    expect(contextSetupSectionId("connect")).toBe("context-setup-connect");
  });

  it("reads completion from the workspace instead of assuming it", () => {
    expect(html).toContain("2 of 6 complete");
    // The two the workspace reports are done; the rest are not claimed.
    expect((html.match(/>Done</g) ?? []).length).toBe(2);
    expect((html.match(/>Not started</g) ?? []).length).toBe(4);
  });

  it("offers an action on every section whose surface this app serves", () => {
    const linkFor = (action: string) =>
      new RegExp(
        `<a href="([^"]+)" class="context-setup-link">${action} →</a>`,
      ).exec(html)?.[1];
    expect(linkFor("Connect")).toBe("/home/data");
    expect(linkFor("Endorse")).toBe("/home/data");
    expect(linkFor("Extend")).toBe("/context-studio/connections");
  });

  it("never links a section to a surface this app does not serve", () => {
    expect((html.match(/context-setup-link/g) ?? []).length).toBe(3);
  });
});

describe("Context Studio setup copy", () => {
  it("reads the headline and introduction from the catalog", async () => {
    const { default: messages } = await import("../../i18n/en-US");
    expect(messages).toMatchObject({
      context: {
        setup: {
          heading: "Building context",
          intro: expect.stringContaining(
            "learns from your data, and structuring context in your workspace",
          ),
        },
      },
    });
  });
});
