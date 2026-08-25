import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MicOffConfirmation } from "./MicOffConfirmation";

describe("MicOffConfirmation", () => {
  it("only exposes Back in the muted info state", () => {
    const html = renderToStaticMarkup(<MicOffConfirmation onBack={vi.fn()} />);

    expect(html).toContain("Back");
    expect(html).toContain("Your mic is muted");
    expect(html).toContain("change your microphone setting");
    expect(html).not.toContain("Unmute");
    expect(html).not.toContain("Continue");
  });
});
