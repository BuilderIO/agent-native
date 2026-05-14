import fs from "fs/promises";
import path from "path";
import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description:
    "Read the optional migration seed written by `agent-native migrate`.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const seedPath = path.resolve(
      process.cwd(),
      "data",
      "migration-source.json",
    );
    try {
      const seed = JSON.parse(await fs.readFile(seedPath, "utf-8"));
      return { seed, path: seedPath };
    } catch {
      return { seed: null, path: seedPath };
    }
  },
});
