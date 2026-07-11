import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TweaksPanelContent } from "./TweaksPanel";

vi.mock("@agent-native/core/client", () => ({
  useT: () => (key: string) => key,
  VisualTweakControl: () => null,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | undefined>) =>
    values.filter(Boolean).join(" "),
}));

describe("TweaksPanelContent", () => {
  it("explains tweak scope progressively at the bottom of the existing surface", () => {
    const html = renderToStaticMarkup(
      <TweaksPanelContent tweaks={[]} values={{}} onChange={() => {}} />,
    );
    expect(html).toContain("data-tweaks-help");
    expect(html).toContain("designEditor.tweaksHelp");
    expect(html).toContain("designEditor.tweaksDocs");
    expect(html).toContain("/docs/template-design#tweaks");
  });
});
