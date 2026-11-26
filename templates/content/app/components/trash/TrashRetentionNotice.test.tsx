import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrashRetentionNotice } from "./TrashRetentionNotice";

const retention = vi.hoisted(() => ({
  data: undefined as
    | {
        retentionDays: number;
        startedAt: string | null;
        deletionsBeginAt: string | null;
      }
    | undefined,
  calls: [] as unknown[][],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (...args: unknown[]) => {
    retention.calls.push(args);
    return { data: retention.data };
  },
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    `${key} ${JSON.stringify(options)}`,
  useFormatters: () => ({
    formatDate: (date: Date) => date.toISOString().slice(0, 10),
  }),
}));

describe("TrashRetentionNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-10T12:00:00.000Z"));
    retention.calls = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("states the 30-day rule while the start date is unknown", () => {
    retention.data = undefined;
    const html = renderToStaticMarkup(<TrashRetentionNotice />);

    expect(retention.calls[0]?.[0]).toBe("get-content-trash-retention");
    expect(html).toContain("trashRetention.autoDelete {&quot;days&quot;:30}");
    expect(html).toContain("text-muted-foreground");
  });

  it("names the date deletions begin while it is still ahead", () => {
    retention.data = {
      retentionDays: 30,
      startedAt: "2026-11-26T00:01:00.000Z",
      deletionsBeginAt: "2026-12-26T00:01:00.000Z",
    };
    const html = renderToStaticMarkup(<TrashRetentionNotice />);

    expect(html).toContain(
      "trashRetention.autoDeleteStarting {&quot;days&quot;:30,&quot;date&quot;:&quot;2026-12-26&quot;}",
    );
  });

  it("drops the date once deletions have begun", () => {
    retention.data = {
      retentionDays: 30,
      startedAt: "2026-10-01T00:00:00.000Z",
      deletionsBeginAt: "2026-10-31T00:00:00.000Z",
    };
    const html = renderToStaticMarkup(<TrashRetentionNotice />);

    expect(html).toContain("trashRetention.autoDelete {&quot;days&quot;:30}");
    expect(html).not.toContain("autoDeleteStarting");
  });
});
