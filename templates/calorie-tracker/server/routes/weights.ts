import { Router } from "express";
import { getSupabase } from "../supabaseClient";
import { weightSchema } from "../../shared/api";
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

// Get weight for a specific date
router.get("/weights", async (req, res) => {
  const date = req.query.date as string;
  if (!date) {
    return res.status(400).json({ error: "Date parameter is required" });
  }

  try {
    const user = await getAuthUser(req);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("weights")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", date)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Transform response
    const response = (data || []).map((w) => ({
      id: w.id,
      weight: w.weight,
      date: w.date,
      notes: w.notes,
    }));

    res.json(response);
  } catch (error) {
    console.error("Error fetching weights:", error);
    res.status(401).json({ error: "Unauthorized" });
  }
});

// Create a new weight entry
router.post("/weights", async (req, res) => {
  try {
    const user = await getAuthUser(req);
    const weightData = weightSchema.parse(req.body);
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("weights")
      .insert([
        {
          user_id: user.id,
          weight: weightData.weight,
          date: weightData.date.split("T")[0], // Ensure date is YYYY-MM-DD format
          notes: weightData.notes || null,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    const response = {
      id: data.id,
      weight: data.weight,
      date: data.date,
      notes: data.notes,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Weight validation error:", error.errors);
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
      console.error("Error creating weight:", error);
      res.status(500).json({ error: "Failed to create weight entry" });
    }
  }
});

// Update a weight entry
router.put("/weights/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  try {
    const user = await getAuthUser(req);
    const weightData = weightSchema.parse(req.body);
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("weights")
      .update({
        weight: weightData.weight,
        date: weightData.date.split("T")[0],
        notes: weightData.notes || null,
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) throw error;

    const response = {
      id: data.id,
      weight: data.weight,
      date: data.date,
      notes: data.notes,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      console.error("Error updating weight:", error);
      res.status(500).json({ error: "Failed to update weight entry" });
    }
  }
});

// Delete a weight entry
router.delete("/weights/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  try {
    const user = await getAuthUser(req);
    const supabase = getSupabase();
    const { error } = await supabase
      .from("weights")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      console.error("Error deleting weight:", error);
      res.status(500).json({ error: "Failed to delete weight entry" });
    }
  }
});

// Get weight history for charting
router.get("/weights/history", async (req, res) => {
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

    // Fetch all weight entries in the date range (one per day, most recent if multiple)
    const { data, error } = await supabase
      .from("weights")
      .select("date, weight, created_at")
      .eq("user_id", user.id)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Group by date and take the most recent entry per date
    const weightByDate = new Map<string, number>();
    (data || []).forEach((entry) => {
      if (!weightByDate.has(entry.date)) {
        weightByDate.set(entry.date, entry.weight);
      }
    });

    // Convert to array and calculate moving average for trend
    const entries = Array.from(weightByDate.entries())
      .map(([date, weight]) => ({ date, weight }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate 7-day exponential moving average for trend smoothing
    const result = entries.map((entry, index) => {
      // Calculate weighted moving average using last 7 entries
      let trendWeight = entry.weight;
      if (entries.length >= 3) {
        const windowSize = Math.min(7, index + 1);
        const windowEntries = entries.slice(
          Math.max(0, index - windowSize + 1),
          index + 1,
        );

        // Exponential moving average - more recent values have higher weight
        let weightSum = 0;
        let divisor = 0;
        windowEntries.forEach((e, i) => {
          const weight = i + 1; // Linear weighting: 1, 2, 3, ...
          weightSum += e.weight * weight;
          divisor += weight;
        });
        trendWeight = weightSum / divisor;
      }

      return {
        date: entry.date,
        weight: entry.weight,
        trendWeight: Math.round(trendWeight * 10) / 10, // Smoothed trend line
        displayDate: new Date(entry.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      };
    });

    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      console.error("Error fetching weight history:", error);
      res.status(500).json({ error: "Failed to fetch weight history" });
    }
  }
});

export default router;
