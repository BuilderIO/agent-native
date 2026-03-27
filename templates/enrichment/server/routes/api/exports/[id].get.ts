import fs from "fs/promises";
import { createError, defineEventHandler, setResponseHeaders } from "h3";
import path from "path";

export default defineEventHandler(async (event) => {
  const id = event.context.params?.id;
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: "Export id is required",
    });
  }

  const filePath = path.join(process.cwd(), "data", "exports", `${id}.csv`);

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      throw createError({
        statusCode: 404,
        statusMessage: "Export not found",
      });
    }
    throw err;
  }

  setResponseHeaders(event, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${id}.csv"`,
  });

  return content;
});
