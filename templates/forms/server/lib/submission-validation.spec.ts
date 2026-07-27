/**
 * Dependency-free regression coverage for public form submission validation.
 *
 * Forms does not currently wire Vitest into package scripts, so run with:
 *   node_modules/.bin/tsx templates/forms/server/lib/submission-validation.spec.ts
 */

import { isConditionalFieldVisible } from "../../shared/conditional.js";
import type { FormField } from "../../shared/types.js";
import {
  isEmptySubmissionValue,
  validateSubmissionField,
} from "./submission-validation.js";
import { assertValidFields } from "./validate-fields.js";

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  FAIL ${name}: ${msg}`);
  }
}

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function field(overrides: Partial<FormField>): FormField {
  return {
    id: "field",
    type: "text",
    label: "Field",
    required: false,
    ...overrides,
  };
}

console.log("submission validation");

check("treats false as empty for required checkboxes", () => {
  assert(isEmptySubmissionValue(false), "false should be empty");
  assert(!isEmptySubmissionValue(true), "true should not be empty");
});

check("rejects malformed email values", () => {
  const err = validateSubmissionField(field({ type: "email" }), "not-email");
  assert(err === "Field must be a valid email address", `got ${err}`);
});

check("accepts valid email values", () => {
  assert(
    validateSubmissionField(field({ type: "email" }), "person@example.com") ===
      null,
    "valid email rejected",
  );
});

check("rejects non-text scalars for optional text fields", () => {
  const err = validateSubmissionField(field({ type: "text" }), false);
  assert(err === "Field must be text", `got ${err}`);
});

check("rejects select values outside configured options", () => {
  const err = validateSubmissionField(
    field({ type: "select", options: ["Sales", "Support"] }),
    "Billing",
  );
  assert(err === "Field must match one of the available options", `got ${err}`);
});

check(
  "accepts legacy object-shaped option values rendered by the public form",
  () => {
    const err = validateSubmissionField(
      field({
        type: "select",
        options: [{ label: "Sales", value: "sales" } as any],
      }),
      "Sales",
    );
    assert(err === null, `got ${err}`);
  },
);

check("rejects multiselect values outside configured options", () => {
  const err = validateSubmissionField(
    field({ type: "multiselect", options: ["A", "B"] }),
    ["A", "C"],
  );
  assert(err === "Field contains an unavailable option", `got ${err}`);
});

check("rejects numeric values outside min/max", () => {
  const err = validateSubmissionField(
    field({ type: "number", validation: { min: 3, max: 5 } }),
    "8",
  );
  assert(err === "Field must be at most 5", `got ${err}`);
});

check(
  "rejects invalid dates instead of accepting normalized Date.parse output",
  () => {
    const err = validateSubmissionField(field({ type: "date" }), "2026-02-30");
    assert(err === "Field must be a valid date", `got ${err}`);
  },
);

check("applies custom string patterns server-side", () => {
  const err = validateSubmissionField(
    field({ validation: { pattern: "^INV-[0-9]+$" } }),
    "oops",
  );
  assert(err === "Field is invalid", `got ${err}`);
});

check("rejects invalid regex patterns at save time", () => {
  let threw = false;
  try {
    assertValidFields([field({ id: "invoice", validation: { pattern: "[" } })]);
  } catch {
    threw = true;
  }
  assert(threw, "invalid regex pattern was accepted");
});

check("evaluates conditional visibility for scalar and list answers", () => {
  const conditional = field({
    id: "physical_details",
    conditional: {
      fieldId: "event_type",
      operator: "equals",
      value: "Physical",
    },
  });
  assert(
    isConditionalFieldVisible(conditional, { event_type: "Physical" }),
    "matching scalar condition should show the field",
  );
  assert(
    !isConditionalFieldVisible(conditional, { event_type: "Virtual" }),
    "non-matching scalar condition should hide the field",
  );
  assert(
    isConditionalFieldVisible(
      {
        ...conditional,
        conditional: {
          fieldId: "topics",
          operator: "contains",
          value: "Security",
        },
      },
      { topics: ["Product", "Security"] },
    ),
    "list condition should match a selected option",
  );
});

check("validates conditional references and operators at save time", () => {
  assertValidFields([
    field({ id: "event_type", type: "radio", options: ["Virtual"] }),
    field({
      id: "virtual_details",
      conditional: {
        fieldId: "event_type",
        operator: "equals",
        value: "Virtual",
      },
    }),
  ]);

  for (const fields of [
    [
      field({ id: "event_type" }),
      field({
        id: "details",
        conditional: {
          fieldId: "missing",
          operator: "equals",
          value: "yes",
        },
      }),
    ],
    [
      field({ id: "event_type" }),
      field({
        id: "details",
        conditional: {
          fieldId: "event_type",
          operator: "when",
          value: "yes",
        } as any,
      }),
    ],
    [
      field({
        id: "event_type",
        conditional: {
          fieldId: "event_type",
          operator: "equals",
          value: "yes",
        },
      }),
    ],
  ]) {
    let threw = false;
    try {
      assertValidFields(fields);
    } catch {
      threw = true;
    }
    assert(threw, "invalid conditional rule was accepted");
  }
});

const total = passed + failures.length;
console.log("");
if (failures.length === 0) {
  console.log(`PASS  ${passed}/${total} assertions passed`);
  process.exit(0);
} else {
  console.log(`FAIL  ${failures.length}/${total} assertions failed`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
