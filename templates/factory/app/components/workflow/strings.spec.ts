import { describe, expect, it } from "vitest";

import enUS from "@/i18n/en-US";
import { createEnglishTranslator } from "@/lib/__tests__/en-translator";
import {
  probeCanvasStrings,
  probeItemsStrings,
  probeWorkflowStrings,
} from "@/lib/__tests__/strings-probes";

import { createWorkflowCanvasStrings } from "../workflow-canvas/strings";
import { createItemsStrings } from "./items-strings";
import { createWorkflowStrings } from "./workflow-strings";

const NAMESPACES = [
  "workflows",
  "items",
  "journey",
  "activity",
  "audit",
  "workflowCanvas",
] as const;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function catalogKeys(): Set<string> {
  const keys = new Set<string>();
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      keys.add(path.replace(PLURAL_SUFFIX, ""));
    } else if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  };
  for (const namespace of NAMESPACES) {
    walk((enUS as Record<string, unknown>)[namespace], namespace);
  }
  return keys;
}

describe("workflow strings", () => {
  // Every string the three strings objects can produce, with a translator that
  // throws on a key en-US lacks, and every key en-US holds under these
  // namespaces read at least once: a key nothing reads is a string nobody sees.
  it("read exactly the keys the en-US catalog holds", () => {
    const requested = new Set<string>();
    const t = createEnglishTranslator(requested);
    probeWorkflowStrings(createWorkflowStrings(t));
    probeItemsStrings(createItemsStrings(t));
    probeCanvasStrings(createWorkflowCanvasStrings(t));
    const held = catalogKeys();
    expect([...requested].filter((key) => !held.has(key))).toEqual([]);
    expect([...held].filter((key) => !requested.has(key))).toEqual([]);
  });

  it("builds nothing until a group is read", () => {
    const requested = new Set<string>();
    const strings = createItemsStrings(createEnglishTranslator(requested));
    expect(requested.size).toBe(0);
    expect(strings.time.today).toBe("Today");
    expect([...requested]).toEqual([
      "items.time.today",
      "items.time.yesterday",
    ]);
  });

  it("picks the plural form the count calls for", () => {
    const s = createWorkflowStrings(createEnglishTranslator());
    expect(s.toolbar.problems(1)).toBe("1 problem");
    expect(s.toolbar.problems(3)).toBe("3 problems");
    expect(s.list.everyHours(1)).toBe("Every hour");
    expect(s.list.everyHours(6)).toBe("Every 6 hours");
  });

  it("says one minute and one hour in the singular", () => {
    const s = createWorkflowCanvasStrings(createEnglishTranslator());
    expect(s.summary.everyMinutes(1)).toBe("Every 1 minute");
    expect(s.summary.waitTime(1, "hours")).toBe("1 hour");
    expect(s.summary.waitTime(2, "days")).toBe("2 days");
  });

  it("keeps an unrecognised problem code unworded", () => {
    const s = createWorkflowCanvasStrings(createEnglishTranslator());
    const issue = { code: "not_a_code" } as never;
    expect(s.issue.sentence(issue)).toBeUndefined();
  });

  it("shows the literal braces of an unclosed path hole", () => {
    const s = createWorkflowCanvasStrings(createEnglishTranslator());
    expect(s.inspector.problem.unclosed_hole).toBe("A {{ has no closing }}.");
  });
});
