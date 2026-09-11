import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Clips bug-report entry points", () => {
  it("opens the shared dialog without navigating away from the app shell", () => {
    const rootSource = readFileSync(
      new URL("./root.tsx", import.meta.url),
      "utf8",
    );
    const dialogSource = readFileSync(
      new URL("./components/bug-report/bug-report-dialog.tsx", import.meta.url),
      "utf8",
    );
    const feedbackSource = readFileSync(
      new URL(
        "./components/library/sidebar-feedback-button.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(rootSource).toContain("<BugReportDialog />");
    expect(dialogSource).toContain("OPEN_BUG_REPORT_EVENT");
    expect(dialogSource).toContain("<DialogContent");
    expect(feedbackSource).toContain("openBugReportDialog");
    expect(feedbackSource).not.toContain('to="/bug-report"');
  });
});
