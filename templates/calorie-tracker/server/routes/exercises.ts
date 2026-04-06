import { Router } from "express";
import { getSupabase } from "../supabaseClient";
import type { Request } from "express";
import { z } from "zod";

const exerciseSchema = z.object({
  name: z.string().min(1),
  calories_burned: z.number().min(0),
  duration_minutes: z.number().min(1).optional().nullable(),
  date: z.string(),
});

const router = Router();

async function getAuthUser(req: Request) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    throw new Error("No authorization token");
  }

  const supabase = getSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error("Unauthorized");
  }

  return user;
}

router.get("/exercises", async (req, res) => {
  const date = req.query.date as string;
  if (!date) {
    return res.status(400).json({ error: "Date parameter is required" });
  }

  try {
    const user = await getAuthUser(req);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("exercises")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", date)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error("Error fetching exercises:", error);
    res.status(401).json({ error: "Unauthorized" });
  }
});

router.post("/exercises", async (req, res) => {
  try {
    const user = await getAuthUser(req);
    const data = exerciseSchema.parse(req.body);
    const supabase = getSupabase();

    const { data: exercise, error } = await supabase
      .from("exercises")
      .insert([
        {
          user_id: user.id,
          name: data.name,
          calories_burned: data.calories_burned,
          duration_minutes: data.duration_minutes,
          date: data.date.split("T")[0],
        },
      ])
      .select()
      .single();

    if (error) throw error;
    res.json(exercise);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Exercise validation error:", error.errors);
      res.status(400).json({
        error:
          "Validation failed: " +
          error.errors
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join(", "),
      });
    } else if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      console.error("Error creating exercise:", error);
      res.status(500).json({ error: "Failed to create exercise" });
    }
  }
});

router.put("/exercises/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  try {
    const user = await getAuthUser(req);
    const data = exerciseSchema.parse(req.body);
    const supabase = getSupabase();

    const { data: exercise, error } = await supabase
      .from("exercises")
      .update({
        name: data.name,
        calories_burned: data.calories_burned,
        duration_minutes: data.duration_minutes,
        date: data.date.split("T")[0],
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) throw error;
    res.json(exercise);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      console.error("Error updating exercise:", error);
      res.status(500).json({ error: "Failed to update exercise" });
    }
  }
});

router.delete("/exercises/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  try {
    const user = await getAuthUser(req);
    const supabase = getSupabase();
    const { error } = await supabase
      .from("exercises")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      console.error("Error deleting exercise:", error);
      res.status(500).json({ error: "Failed to delete exercise" });
    }
  }
});

export default router;
