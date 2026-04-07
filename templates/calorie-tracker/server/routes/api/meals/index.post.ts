import { defineEventHandler, readBody, createError } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";
import { sql } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.date || typeof body.date !== "string") {
    throw createError({ statusCode: 400, statusMessage: "date is required and must be a string (YYYY-MM-DD format)" });
  }

  try {
    // Parse the date string to ensure it's valid
    const dateStr = body.date.split("T")[0]; // Handle ISO date strings
    const dateObj = new Date(dateStr);
    
    if (isNaN(dateObj.getTime())) {
      throw new Error("Invalid date format. Use YYYY-MM-DD");
    }

    // Use raw SQL to avoid Drizzle's $defaultFn issues with created_at
    const result = await db().execute(
      sql`INSERT INTO meals (name, calories, protein, carbs, fat, date, image_url, notes, created_at)
          VALUES (${body.name}, ${parseInt(body.calories) || 0}, ${body.protein ? parseInt(body.protein) : null}, ${body.carbs ? parseInt(body.carbs) : null}, ${body.fat ? parseInt(body.fat) : null}, ${dateStr}, ${body.image_url || body.imageUrl || null}, ${body.notes || null}, CURRENT_TIMESTAMP)
          RETURNING *`
    );

    return result;
  } catch (error: any) {
    console.error("Error inserting meal:", error);
    // Re-throw if it's already an HTTPError
    if (error.statusCode) throw error;
    throw createError({ statusCode: 500, statusMessage: `Failed to insert meal: ${error?.message || String(error)}` });
  }
});
