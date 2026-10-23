import { parseJobResource } from "@agent-native/core/jobs/frontmatter";
import { describe, expect, it } from "vitest";

import { readFrontmatterValue } from "./factory-automation-config.js";
import {
  normalizeFactoryAutomationFrontmatter,
  readAutomationDisplayName,
  resolveAutomationDisplayName,
  setAutomationFrontmatterField,
} from "./factory-scope.js";

const ordinaryValues = [
  {
    value: 'He said "hello"',
    line: 'model: He said "hello"',
    readback: 'He said "hello',
  },
  { value: '"hello"', line: 'model: "hello"', readback: "hello" },
  { value: "'hello'", line: "model: 'hello'", readback: "hello" },
  {
    value: "C:\\folder\\thing",
    line: "model: C:\\folder\\thing",
    readback: "C:\\folder\\thing",
  },
  {
    value: '"hello\\nworld"',
    line: 'model: "hello\\nworld"',
    readback: "hello\\nworld",
  },
  { value: "part: value", line: "model: part: value", readback: "part: value" },
  {
    value: "value # comment",
    line: "model: value # comment",
    readback: "value # comment",
  },
  { value: "   value", line: "model: value", readback: "value" },
  { value: "value   ", line: "model: value", readback: "value" },
  { value: "  value  ", line: "model: value", readback: "value" },
  { value: "naïve 雪 🙂", line: "model: naïve 雪 🙂", readback: "naïve 雪 🙂" },
];

describe("factory automation display names", () => {
  it.each(
    ordinaryValues.flatMap((value) =>
      ["absent", "existing", "existing-last"].map((state) => ({
        ...value,
        state,
      })),
    ),
  )(
    "preserves ordinary settings bytes for $state/$value",
    ({ value, line, readback, state }) => {
      const content =
        state === "absent"
          ? "---\nenabled: false\n---\nBody\n"
          : state === "existing"
            ? "---\nmodel: old\nenabled: false\n---\nBody\n"
            : "---\nenabled: false\nmodel: old\n---\nBody\n";
      const expected =
        state === "existing"
          ? `---\n${line}\nenabled: false\n---\nBody\n`
          : `---\nenabled: false\n${line}\n${state === "existing-last" ? "\n" : ""}---\nBody\n`;
      const updated = setAutomationFrontmatterField(content, "model", value);
      expect(updated).toBe(expected);
      expect(readFrontmatterValue(updated, "model")).toBe(readback);
    },
  );

  it.each([
    "---\r\nmodel: original\r\n---\r\nBody\r\n",
    "Body only",
    "---\nenabled: false\nBody",
  ])("keeps unsupported generic header input unchanged for %j", (content) => {
    expect(setAutomationFrontmatterField(content, "model", "selected")).toBe(
      content,
    );
    expect(setAutomationFrontmatterField(content, "mcpManaged", "true")).toBe(
      content,
    );
  });

  it.each(["\n", "\r\n"])(
    "keeps one normalized selected setting with line ending %j",
    (lineEnding) => {
      const content = [
        "---",
        " model : old",
        "customFactory: retained",
        "model: newer",
        "enabled: false",
        "---",
        "Body",
        "",
      ].join(lineEnding);
      const normalized = normalizeFactoryAutomationFrontmatter(content);
      const updated = setAutomationFrontmatterField(
        normalized,
        "model",
        "selected",
      );
      expect(parseJobResource(updated).meta).toMatchObject({
        model: "selected",
        enabled: false,
      });
      expect(
        updated
          .split(/\r?\n---/)[0]
          .split(/\r?\n/)
          .filter((line) => line.split(":")[0].trim() === "model"),
      ).toEqual(["model: selected"]);
      expect(updated.endsWith(`${lineEnding}Body${lineEnding}`)).toBe(true);
      expect(
        parseJobResource(setAutomationFrontmatterField(normalized, "model", ""))
          .meta.model,
      ).toBeUndefined();
      expect(updated).toContain("customFactory: retained");
    },
  );

  it("falls back to the automation name when displayName is absent", () => {
    expect(
      resolveAutomationDisplayName(
        "factories/acme/factory-slack-feedback",
        "---\nenabled: true\n---\n",
      ),
    ).toBe("factories/acme/factory-slack-feedback");
  });

  it("reads and writes displayName frontmatter", () => {
    const content = "---\nenabled: true\n---\nBody";
    const updated = setAutomationFrontmatterField(
      content,
      "displayName",
      "My Slack triage",
    );
    expect(readAutomationDisplayName(updated)).toBe("My Slack triage");
    expect(
      resolveAutomationDisplayName(
        "factories/acme/factory-github-issues",
        updated,
      ),
    ).toBe("My Slack triage");
  });
});
