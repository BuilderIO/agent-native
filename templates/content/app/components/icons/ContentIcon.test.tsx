import { serializeIconValue } from "@agent-native/core/icons";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContentIcon } from "./ContentIcon";

describe("Content image icons", () => {
  it("renders an uploaded image after saving and reloading its icon value", () => {
    const stored = serializeIconValue({
      version: 1,
      kind: "image",
      authority: "url",
      assetId: "https://cdn.example.com/logo.png",
      alt: "Workspace logo",
    });

    const markup = renderToStaticMarkup(
      <ContentIcon value={stored} size={48} />,
    );

    expect(markup).toContain('src="https://cdn.example.com/logo.png"');
    expect(markup).toContain('alt="Workspace logo"');
    expect(markup).toContain("width:48px;height:48px");
  });

  it("renders imported Notion image icons with the same renderer", () => {
    const markup = renderToStaticMarkup(
      <ContentIcon
        value={{
          version: 1,
          kind: "image",
          authority: "notion",
          assetId: "https://cdn.example.com/imported-logo.png",
        }}
      />,
    );

    expect(markup).toContain('src="https://cdn.example.com/imported-logo.png"');
  });
});
