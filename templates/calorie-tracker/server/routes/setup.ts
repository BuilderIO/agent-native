import { Router } from "express";
import { getSupabase } from "../supabaseClient";

const router = Router();

// One-time setup endpoint to create the weights table
router.post("/setup-weights-table", async (req, res) => {
  try {
    const supabase = getSupabase();

    // Create the weights table using raw SQL via RPC
    // Note: This requires the database to allow this operation
    const { error } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS weights (
          id SERIAL PRIMARY KEY,
          user_id UUID REFERENCES auth.users(id),
          weight DECIMAL(5,1) NOT NULL,
          date DATE NOT NULL,
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        ALTER TABLE weights ENABLE ROW LEVEL SECURITY;
        
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE tablename = 'weights' AND policyname = 'Users can manage their own weights'
          ) THEN
            CREATE POLICY "Users can manage their own weights" ON weights
              FOR ALL USING (auth.uid() = user_id);
          END IF;
        END $$;
      `,
    });

    if (error) {
      // If RPC doesn't exist, provide manual instructions
      console.error("Setup error:", error);
      return res.status(400).json({
        error: "Could not auto-create table",
        message: "Please run the SQL manually in Supabase SQL Editor",
        sql: `
CREATE TABLE IF NOT EXISTS weights (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  weight DECIMAL(5,1) NOT NULL,
  date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own weights" ON weights
  FOR ALL USING (auth.uid() = user_id);
        `.trim(),
      });
    }

    res.json({ success: true, message: "Weights table created successfully" });
  } catch (error) {
    console.error("Setup error:", error);
    res.status(500).json({ error: "Setup failed", details: String(error) });
  }
});

export default router;
