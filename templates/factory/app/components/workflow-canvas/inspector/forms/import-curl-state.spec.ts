import { describe, expect, it } from "vitest";

import {
  EMPTY_IMPORT,
  importReducer,
  type ImportAction,
  type ImportState,
} from "./import-curl-state";

const run = (actions: ImportAction[], from: ImportState = EMPTY_IMPORT) =>
  actions.reduce(importReducer, from);

describe("the Import cURL dialog's state", () => {
  it("holds what is pasted, and clears a refusal as soon as it is edited", () => {
    const refused = run([
      { type: "typed", command: "curl https://nowhere.example" },
      { type: "refused", error: "Not on a connected provider." },
    ]);
    expect(refused.command).toBe("curl https://nowhere.example");
    expect(refused.error).toBe("Not on a connected provider.");
    expect(
      importReducer(refused, { type: "typed", command: "curl x" }),
    ).toEqual({
      command: "curl x",
      error: null,
      left: null,
    });
  });

  it("keeps a command that could not be imported, so it can be fixed", () => {
    const refused = run([
      { type: "typed", command: "curl -X POST https://api.github.com/x" },
      { type: "refused", error: "Only reads." },
    ]);
    expect(refused.command).not.toBe("");
  });

  it("empties the paste box the moment a command has been imported", () => {
    const imported = run([
      {
        type: "typed",
        command: "curl -u me:secret https://api.github.com/user",
      },
      { type: "imported", left: ["Credentials: -u"] },
    ]);
    expect(imported).toEqual({
      command: "",
      error: null,
      left: ["Credentials: -u"],
    });
    expect(JSON.stringify(imported)).not.toContain("secret");
  });

  it("empties everything when the dialog closes, whether after an import, a refusal or a Cancel", () => {
    for (const actions of [
      [
        { type: "typed", command: "curl https://api.github.com/user" },
        { type: "imported", left: ["x"] },
      ],
      [
        { type: "typed", command: "curl nope" },
        { type: "refused", error: "No." },
      ],
      [{ type: "typed", command: "curl half-typed" }],
    ] satisfies ImportAction[][]) {
      expect(run([...actions, { type: "closed" }])).toEqual(EMPTY_IMPORT);
    }
  });
});
