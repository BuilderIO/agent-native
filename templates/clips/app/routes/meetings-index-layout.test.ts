import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./_app.meetings._index.tsx", import.meta.url),
  "utf8",
);

describe("Meetings route layout", () => {
  it("uses the shared page toolbar for search and calendar controls", () => {
    const headerStart = source.indexOf("function MeetingsHeader");
    const headerEnd = source.indexOf("export default function", headerStart);
    const header = source.slice(headerStart, headerEnd);

    expect(header).toContain("<PageHeader>");
    expect(header).toContain('type="search"');
    expect(header).toContain("<Kbd");
    expect(header).toContain("<CalendarAccountMenu");
    expect(header).not.toContain("<PageHeaderPrimaryAction");
    expect(header).not.toContain('<NavLink to="/record"');
  });

  it("fills the app content pane and keeps tabs aligned to the content edge", () => {
    expect(source).toContain(
      'className="flex min-h-0 flex-1 flex-col overflow-y-auto"',
    );
    expect(source).toContain('variant="line"');
    expect(source).toContain('className="mb-4 h-9 w-fit"');
    expect(source).not.toContain("max-w-3xl");
    expect(source).not.toContain("grid w-full max-w-xs grid-cols-2");
  });
});
