import { describe, expect, it } from "vitest";

import { cliWrapperFlagsFromSource } from "./cli-wrapper-flags.js";

describe("cliWrapperFlagsFromSource", () => {
  const imported = 'import { defineAction } from "@agent-native/core/action";';
  const source = (flags: string) =>
    [
      imported,
      "export default defineAction({",
      '  description: "Send",',
      flags,
      "  run: async () => ({}),",
      "});",
    ].join("\n");
  const hidden = {
    needsApproval: true,
    persistInBrowser: false,
    uiOnly: true,
    toolCallable: false,
  };

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
      [
        "options by name",
        `${imported}\nexport default defineAction(sendOptions);`,
      ],
      [
        "a commented example before the real call",
        `${imported}\n// defineAction({})\nexport default defineAction(sendOptions);`,
      ],
      [
        "type arguments",
        `${imported}\nexport default defineAction<SendInput>(sendOptions);`,
      ],
      [
        "options built by another helper",
        "export default createSendAction({ needsApproval: false });",
      ],
      [
        "a defineAction the module never imports",
        "export default defineAction({ needsApproval: false });",
      ],
      [
        "a local defineAction",
        "function defineAction(options) {\n  return { ...options, needsApproval: true };\n}\nexport default defineAction({ needsApproval: false });",
      ],
      [
        "a defineAction from another module",
        'import { defineAction } from "./send-helpers.js";\nexport default defineAction({ needsApproval: false });',
      ],
      [
        "a defineAction on an object that isn't the framework",
        'import * as helpers from "./send-helpers.js";\nexport default helpers.defineAction({ needsApproval: false });',
      ],
      ["a re-exported action", 'export { default } from "./send-base.js";'],
      [
        "a defineAction call that isn't the export",
        `${imported}\nconst helper = defineAction({ needsApproval: false });\nexport default createSendAction(helper);`,
      ],
      [
        "a defineAction call beside a re-export",
        `${imported}\ndefineAction({ needsApproval: false });\nexport { default } from "./send-base.js";`,
      ],
      [
        "an action wrapped by another helper",
        `${imported}\nexport default withLogging(defineAction({ needsApproval: false }));`,
      ],
      [
        "a default object that isn't an action",
        "export default { needsApproval: false, persistInBrowser: true };",
      ],
      [
        "TypeScript's export assignment",
        'export = {\n  tool: { description: "Send" },\n  needsApproval: false,\n  run: async () => ({}),\n};',
      ],
      [
        "a binding reassigned before the export",
        `${imported}\nlet send = defineAction({ needsApproval: false });\nsend = defineAction({ needsApproval: true });\nexport default send;`,
      ],
      [
        "a binding changed after it's declared",
        `${imported}\nconst send = defineAction({ needsApproval: false });\nsend.needsApproval = true;\nexport default send;`,
      ],
      [
        "a binding declared twice",
        `${imported}\nvar send = defineAction({ needsApproval: false });\nvar send = defineAction({ needsApproval: true });\nexport default send;`,
      ],
      [
        "a default function reassigned to an action",
        `${imported}\nfunction send() {}\nsend = defineAction({ needsApproval: true });\nexport default send;`,
      ],
      [
        "named tool and run beside a default action",
        `${imported}\nexport const tool = { description: "Send" };\nexport async function run() {}\nexport default defineAction({ needsApproval: false });`,
      ],
      ["a whole file re-exported", 'export * from "./send-base.js";'],
      [
        "CommonJS exports",
        'exports.tool = { description: "Send" };\nexports.run = async () => ({});\nexports.needsApproval = false;',
      ],
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
    ).toEqual({ persistInBrowser: false, uiOnly: true, toolCallable: false });
  });

  it("reads a plain action object with its own tool and run", () => {
    const read = (flags: string) =>
      cliWrapperFlagsFromSource(
        [
          "export default {",
          '  tool: { description: "Send" },',
          flags,
          "  run: async () => ({}),",
          "};",
        ].join("\n"),
      );
    expect(read("  needsApproval: false,")).toEqual({});
    expect(read("  needsApproval: true,")).toEqual({ needsApproval: true });
  });

  it("reads flags exported by name beside tool and run", () => {
    const read = (flags: string) =>
      cliWrapperFlagsFromSource(
        [
          'export const tool = { description: "Send" };',
          flags,
          "export async function run() {",
          "  return {};",
          "}",
        ].join("\n"),
      );
    expect(read("")).toEqual({});
    expect(read("export const needsApproval = false;")).toEqual({});
    expect(read("export const uiOnly = false;")).toEqual({});
    expect(read("export const needsApproval = true;")).toEqual({
      needsApproval: true,
    });
    for (const flags of [
      "export let needsApproval = false;",
      "export function needsApproval() {\n  return false;\n}",
      'export { approval as needsApproval } from "./flags.js";',
    ]) {
      expect(read(flags), flags).toEqual({ needsApproval: true });
    }
    expect(read('export * from "./flags.js";')).toEqual(hidden);
  });

  it("keeps UI-only and tool-call limits unless a literal lifts them", () => {
    for (const [flags, want] of [
      ["  uiOnly: true,", { uiOnly: true }],
      ["  uiOnly: isUiOnly,", { uiOnly: true }],
      ["  uiOnly: false,", {}],
      ["  toolCallable: false,", { toolCallable: false }],
      ["  toolCallable: allowTools,", { toolCallable: false }],
      ["  toolCallable: true,", {}],
    ] as const) {
      expect(cliWrapperFlagsFromSource(source(flags)), flags).toEqual(want);
    }
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

  it("reads defineAction from either framework entry point", () => {
    for (const src of [
      'import { defineAction } from "@agent-native/core";\nexport default defineAction({ needsApproval: false });',
      'import * as core from "@agent-native/core/action";\nexport default core.defineAction({ needsApproval: false });',
    ]) {
      expect(cliWrapperFlagsFromSource(src), src).toEqual({});
    }
  });

  it("leaves modules that define no action alone", () => {
    for (const src of [
      "#!/usr/bin/env node\nconsole.log('cli script');\n",
      "export function getPanelOrder(config) {\n  return [];\n}\n",
      "export default async function main(args) {\n  console.log(args);\n}\n",
      "async function main(args) {\n  console.log(args);\n}\nrunCli(main);\nexport default main;\n",
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
