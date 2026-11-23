import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { i18nCatalog } from "@/i18n";

import { ProjectHeader as View } from "./ProjectHeader";

function ProjectHeader(props: ComponentProps<typeof View>) {
  return (
    <MemoryRouter>
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <View {...props} />
      </AgentNativeI18nProvider>
    </MemoryRouter>
  );
}

const base = {
  title: "Weekly revenue",
  canRename: false,
  onRename: async () => {},
};

describe("ProjectHeader header actions", () => {
  it("does not render actions this build cannot run", () => {
    const html = renderToStaticMarkup(
      <ProjectHeader {...base} canRename={true} />,
    );
    expect(html).not.toContain(">Share<");
    expect(html).not.toContain("Publish app");
    expect(html).not.toContain("Comments");
  });

  it("renders each action once a handler is supplied", () => {
    const html = renderToStaticMarkup(
      <ProjectHeader
        {...base}
        onShare={() => {}}
        onPublish={() => {}}
        onOpenComments={() => {}}
      />,
    );
    expect(html).toContain("Share");
    expect(html).toContain("Publish app");
    expect(html).toContain('aria-label="Comments"');
  });
});
