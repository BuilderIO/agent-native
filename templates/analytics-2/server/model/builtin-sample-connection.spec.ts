import { describe, expect, it } from "vitest";

import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";
import {
  builtinSampleConnection,
  dataConnectionOutput,
  isBuiltinSampleConnection,
} from "./data-connections.js";

/**
 * The bundled sample source is the only data a brand-new workspace has, so the
 * query cell's picker has to offer it (sprint-analytics-2#492). These rules hold
 * without a database: the entry is a well-formed connection, it is the sample
 * source, and the runner recognises exactly that id.
 */
describe("built-in sample data as a selectable connection", () => {
  it("is a well-formed connection entry the picker can render", () => {
    const parsed = dataConnectionOutput.parse(builtinSampleConnection());
    expect(parsed.id).toBe(SAMPLE_DATA_SOURCE_ID);
    expect(parsed.name).toBe("[Demo] Public Data");
    expect(parsed.canQuery).toBe("read");
    expect(parsed.canView).toBe("read");
    expect(parsed.isDraft).toBe(false);
  });

  it("is read-only and shared, never a per-person warehouse", () => {
    const entry = builtinSampleConnection();
    expect(entry.type).toBe("sample");
    expect(entry.shared).toBe(true);
    expect(entry.isDefault).toBe(false);
    expect(entry.description).toContain("No warehouse needed");
  });

  it("is the id the query runner answers from sample data", () => {
    expect(isBuiltinSampleConnection(SAMPLE_DATA_SOURCE_ID)).toBe(true);
    // A real warehouse id is never mistaken for the sample source.
    expect(isBuiltinSampleConnection("conn_1234")).toBe(false);
    expect(isBuiltinSampleConnection(null)).toBe(false);
    expect(isBuiltinSampleConnection(undefined)).toBe(false);
  });
});
