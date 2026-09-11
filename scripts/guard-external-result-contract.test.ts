import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findExternalResultContractViolations } from "./guard-external-result-contract.mjs";

describe("external result contract guard", () => {
  it("flags wait-language in an external action's description", () => {
    const source = `
      export default defineAction({
        description:
          "Ask a question, then wait for the user to answer before continuing.",
        run: async () => ({}),
      });
    `;
    const lines = source.split("\n");
    const descLine =
      lines.findIndex((l) => l.includes("wait for the user")) + 1;

    const violations = findExternalResultContractViolations(
      "templates/tasks/actions/ask-question.ts",
      source,
      new Set([descLine]),
    );

    assert.deepEqual(
      violations.map((v) => v.kind),
      ["wait-language"],
    );
  });

  it("flags a create-* action with no link and no url/urlPath", () => {
    const source = `
      export default defineAction({
        description: "Create a task.",
        run: async () => ({ id: "1" }),
      });
    `;

    const violations = findExternalResultContractViolations(
      "templates/tasks/actions/create-task.ts",
      source,
      new Set([2]),
    );

    assert.deepEqual(
      violations.map((v) => v.kind),
      ["missing-deep-link"],
    );
  });

  it("does not flag an existing create-* action when only an unrelated line was added", () => {
    const source = `
      // updated comment, unrelated to the result contract
      export default defineAction({
        description: "Create a task.",
        run: async () => ({ id: "1" }),
      });
    `;
    // Only the comment (line 2) was added; \`defineAction(\` is on line 3,
    // which was NOT added — this file already existed before this branch.
    const violations = findExternalResultContractViolations(
      "templates/tasks/actions/create-task.ts",
      source,
      new Set([2]),
    );

    assert.deepEqual(violations, []);
  });

  it("allows a create-* action with a link builder, an in-app-only action, and the opt-out pragma", () => {
    const withLink = `
      export default defineAction({
        description: "Create a task.",
        run: async () => ({ id: "1" }),
        link: ({ result }) => ({ url: "/tasks/" + result.id }),
      });
    `;
    assert.deepEqual(
      findExternalResultContractViolations(
        "templates/tasks/actions/create-task.ts",
        withLink,
        new Set([2]),
      ),
      [],
    );

    const inAppOnly = `
      export default defineAction({
        agentTool: false,
        description: "Wait for the user to answer, then create a task.",
        run: async () => ({ id: "1" }),
      });
    `;
    assert.deepEqual(
      findExternalResultContractViolations(
        "templates/tasks/actions/create-task.ts",
        inAppOnly,
        new Set([3]),
      ),
      [],
    );

    const optedOut = `
      // guard:allow-result-contract — legacy in-app flow, migration tracked separately
      export default defineAction({
        description: "Wait for the user to answer before continuing.",
        run: async () => ({ id: "1" }),
      });
    `;
    assert.deepEqual(
      findExternalResultContractViolations(
        "templates/tasks/actions/create-task.ts",
        optedOut,
        new Set([4]),
      ),
      [],
    );
  });

  it("ignores the match when it falls outside the added lines", () => {
    const source = `
      export default defineAction({
        description:
          "Ask a question, then wait for the user to answer before continuing.",
        run: async () => ({}),
      });
    `;

    const violations = findExternalResultContractViolations(
      "templates/tasks/actions/ask-question.ts",
      source,
      new Set([5]),
    );

    assert.deepEqual(violations, []);
  });
});
