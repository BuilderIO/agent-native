import { describe, expect, it } from "vitest";

import {
  DEFAULT_SLASH_COMMANDS,
  filterSlashCommandItems,
} from "./SlashCommandMenu.js";

describe("filterSlashCommandItems", () => {
  it("hides commands whose editor extensions are disabled", () => {
    const commands = filterSlashCommandItems(DEFAULT_SLASH_COMMANDS, {
      codeBlock: false,
      tables: false,
      tasks: false,
    });

    expect(commands.map((command) => command.title)).not.toEqual(
      expect.arrayContaining(["Code block", "Table", "To-do list"]),
    );
  });

  it("keeps commands enabled when their feature is unspecified", () => {
    const commands = filterSlashCommandItems(DEFAULT_SLASH_COMMANDS, {
      tasks: false,
    });

    expect(commands.map((command) => command.title)).toEqual(
      expect.arrayContaining(["Code block", "Table"]),
    );
    expect(commands.map((command) => command.title)).not.toContain(
      "To-do list",
    );
  });
});
