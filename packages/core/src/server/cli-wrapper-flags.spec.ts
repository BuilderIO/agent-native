import { describe, expect, it } from "vitest";

import { cliWrapperFlagsFromSource } from "./cli-wrapper-flags.js";

describe("cliWrapperFlagsFromSource", () => {
  const source = (flags: string) =>
    [
      "export default defineAction({",
      '  description: "Send",',
      flags,
      "  run: async () => ({}),",
      "});",
    ].join("\n");
  const hidden = { needsApproval: true, persistInBrowser: false };

  it("keeps the approval gate however an unimportable action declares it", () => {
    for (const flags of [
      "  needsApproval: true,",
      "  needsApproval: (input) => input.to !== 'me',",
      "  needsApproval(input) { return input.to !== 'me'; },",
      "  needsApproval,",
      "  needsApproval: false || shouldAsk(input),",
      "  needsApproval: false /* note */ || shouldAsk(input),",
      "  needsApproval: false\n    || shouldAsk(input),",
      "  needsApproval: false, // reads only\n  needsApproval: true,",
    ]) {
      expect(cliWrapperFlagsFromSource(source(flags)), flags).toEqual({
        needsApproval: true,
      });
    }
  });

  it("leaves an action ungated when it says no approval is needed", () => {
    for (const flags of [
      "  needsApproval: false,",
      "  needsApproval: false, // reads only",
      "  needsApproval: false as const,",
      "",
      "  run: async (input) => ({ ...input, sent: true }),",
      '  /* "quoted" ...not a spread */\n  needsApproval: false,',
    ]) {
      expect(cliWrapperFlagsFromSource(source(flags)), flags).toEqual({});
    }
  });

  it("gates options it can't see and keeps their results out of the browser", () => {
    for (const [label, src] of [
      ["spread", source("  ...approvalFlags,")],
      [
        "a spread can override an explicit opt-out",
        source("  needsApproval: false,\n  ...approvalFlags,"),
      ],
      [
        "a regex before a spread",
        source("  pattern: /}/,\n  ...approvalFlags,"),
      ],
      ["options by name", "export default defineAction(sendOptions);"],
      [
        "a commented example before the real call",
        "// defineAction({})\nexport default defineAction(sendOptions);",
      ],
      [
        "type arguments",
        "export default defineAction<SendInput>(sendOptions);",
      ],
      [
        "options built by another helper",
        "export default createSendAction({ needsApproval: false });",
      ],
      ["a re-exported action", 'export { default } from "./send-base.js";'],
      ["a source it can't parse", source("  needsApproval: false,,")],
    ] as const) {
      expect(cliWrapperFlagsFromSource(src), label).toEqual(hidden);
    }
  });

  it("reads an opt-out set after a spread, as JavaScript would", () => {
    expect(
      cliWrapperFlagsFromSource(
        source("  ...approvalFlags,\n  needsApproval: false,"),
      ),
    ).toEqual({ persistInBrowser: false });
  });

  it("follows a renamed defineAction import and a default export by name", () => {
    expect(
      cliWrapperFlagsFromSource(
        [
          'import { defineAction as action } from "@agent-native/core";',
          "const send = action({",
          "  needsApproval: true,",
          "  run: async () => ({}),",
          "});",
          "export default send;",
        ].join("\n"),
      ),
    ).toEqual({ needsApproval: true });
  });

  it("leaves modules that define no action alone", () => {
    for (const src of [
      "#!/usr/bin/env node\nconsole.log('cli script');\n",
      "export function getPanelOrder(config) {\n  return [];\n}\n",
      "export default async function main(args) {\n  console.log(args);\n}\n",
    ]) {
      expect(cliWrapperFlagsFromSource(src), src).toEqual({});
    }
  });

  it("keeps an unimportable action's results out of the browser when it asks", () => {
    for (const flags of [
      "  persistInBrowser: false,",
      "  persistInBrowser: isPrivate,",
      "  persistInBrowser,",
    ]) {
      expect(cliWrapperFlagsFromSource(source(flags)), flags).toEqual({
        persistInBrowser: false,
      });
    }
    expect(
      cliWrapperFlagsFromSource(source("  persistInBrowser: true,")),
    ).toEqual({});
  });

  it("reads the HTTP route and agent opt-out", () => {
    expect(
      cliWrapperFlagsFromSource(
        source(
          [
            "  agentTool: false,",
            '  http: { method: "GET", path: "/report" },',
          ].join("\n"),
        ),
      ),
    ).toEqual({ agentTool: false, http: { method: "GET", path: "/report" } });
    expect(cliWrapperFlagsFromSource(source("  http: false,"))).toEqual({
      http: false,
    });
  });
});
