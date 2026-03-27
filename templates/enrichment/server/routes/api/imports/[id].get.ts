import fs from "fs/promises";
import path from "path";
import { createError, defineEventHandler } from "h3";
import type { ImportRecord } from "../../../../shared/types.js";

const IMPORTS_DIR = path.join(process.cwd(), "data", "imports");

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id;
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: "Import id is required",
    });
  }

  const filePath = path.join(IMPORTS_DIR, `${id}.json`);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as ImportRecord;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      throw createError({
        statusCode: 404,
        statusMessage: "Import not found",
      });
    }
    throw err;
  }
});
