import { Router } from "express";
import { getSupabase } from "../supabaseClient";
import { mealSchema } from "../../shared/api";
import { z } from "zod";
import type { Request } from "express";

const router = Router();

// Middleware to get user from token
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

router.get("/meals", async (req, res) => {
  const date = req.query.date as string;
  if (!date) {
    return res.status(400).json({ error: "Date parameter is required" });
  }

  try {
    const user = await getAuthUser(req);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("meals")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", date)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error("Error fetching meals:", error);
    res.status(401).json({ error: "Unauthorized" });
  }
});

router.post("/meals", async (req, res) => {
  try {
    const user = await getAuthUser(req);
    const mealData = mealSchema.parse(req.body);
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("meals")
      .insert([
        {
          user_id: user.id,
          name: mealData.name,
          calories: mealData.calories,
          protein:
            mealData.protein && mealData.protein > 0 ? mealData.protein : null,
          carbs: mealData.carbs && mealData.carbs > 0 ? mealData.carbs : null,
          fat: mealData.fat && mealData.fat > 0 ? mealData.fat : null,
          date: mealData.date.split("T")[0], // Ensure date is YYYY-MM-DD format
          image_url: mealData.imageUrl,
          notes: mealData.notes,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    // Transform the response to match our Meal type
    const response = {
      id: data.id,
      name: data.name,
      calories: data.calories,
      protein: data.protein,
      carbs: data.carbs,
      fat: data.fat,
      date: data.date,
      imageUrl: data.image_url,
      notes: data.notes,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Meal validation error:", error.errors);
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
      console.error("Error creating meal:", error);
      res.status(500).json({ error: "Failed to create meal" });
    }
  }
});

router.put("/meals/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  try {
    const user = await getAuthUser(req);
    const mealData = mealSchema.parse(req.body);
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("meals")
      .update({
        name: mealData.name,
        calories: mealData.calories,
        protein:
          mealData.protein && mealData.protein > 0 ? mealData.protein : null,
        carbs: mealData.carbs && mealData.carbs > 0 ? mealData.carbs : null,
        fat: mealData.fat && mealData.fat > 0 ? mealData.fat : null,
        date: mealData.date.split("T")[0],
        image_url: mealData.imageUrl,
        notes: mealData.notes,
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) throw error;

    const response = {
      id: data.id,
      name: data.name,
      calories: data.calories,
      protein: data.protein,
      carbs: data.carbs,
      fat: data.fat,
      date: data.date,
      imageUrl: data.image_url,
      notes: data.notes,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      console.error("Error updating meal:", error);
      res.status(500).json({ error: "Failed to update meal" });
    }
  }
});

router.delete("/meals/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  try {
    const user = await getAuthUser(req);
    const supabase = getSupabase();
    const { error } = await supabase
      .from("meals")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      console.error("Error deleting meal:", error);
      res.status(500).json({ error: "Failed to delete meal" });
    }
  }
});

router.get("/meals/history", async (req, res) => {
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  if (!startDate || !endDate) {
    return res
      .status(400)
      .json({ error: "startDate and endDate parameters are required" });
  }

  try {
    const user = await getAuthUser(req);
    const supabase = getSupabase();

    // Fetch meals
    const { data: mealsData, error: mealsError } = await supabase
      .from("meals")
      .select("date, calories")
      .eq("user_id", user.id)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true });

    if (mealsError) throw mealsError;

    // Fetch exercises
    const { data: exercisesData, error: exercisesError } = await supabase
      .from("exercises")
      .select("date, calories_burned")
      .eq("user_id", user.id)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true });

    if (exercisesError) throw exercisesError;

    // Group by date
    const dataByDate = new Map<string, { meals: number; burned: number }>();

    (mealsData || []).forEach((meal) => {
      const existing = dataByDate.get(meal.date) || { meals: 0, burned: 0 };
      dataByDate.set(meal.date, {
        ...existing,
        meals: existing.meals + meal.calories,
      });
    });

    (exercisesData || []).forEach((exercise) => {
      const existing = dataByDate.get(exercise.date) || { meals: 0, burned: 0 };
      dataByDate.set(exercise.date, {
        ...existing,
        burned: existing.burned + exercise.calories_burned,
      });
    });

    // Format response
    const result = Array.from(dataByDate.entries())
      .map(([date, { meals, burned }]) => ({
        date,
        totalCalories: meals,
        burnedCalories: burned,
        netCalories: meals - burned,
        displayDate: new Date(date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      console.error("Error fetching meal history:", error);
      res.status(500).json({ error: "Failed to fetch meal history" });
    }
  }
});

export default router;
