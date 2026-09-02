import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MicOffConfirmation } from "./MicOffConfirmation";

describe("MicOffConfirmation", () => {
  it("offers continuing without the microphone", () => {
    const html = renderToStaticMarkup(
      <MicOffConfirmation onBack={vi.fn()} onContinue={vi.fn()} />,
    );

    expect(html).toContain("Back");
    expect(html).toContain("Your mic is muted");
    expect(html).toContain("continue without it");
    expect(html).toContain("Continue");
    expect(html).not.toContain("Unmute");
  });
});
