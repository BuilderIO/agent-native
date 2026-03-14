import { RequestHandler } from "express";
import fs from "fs/promises";
import path from "path";
const SKILLS_DIR = path.join(process.cwd(), ".builder/skills");
const RULES_DIR = path.join(process.cwd(), ".builder/rules");

// Auth removed — stub always returns a local user
async function getUserInfoFromToken(
  _req: any,
): Promise<{ uid: string; email: string } | null> {
  return { uid: "local", email: "local@localhost" };
}

interface SkillFile {
  id: string;
  name: string;
  path: string;
  category: string;
  description?: string;
}

/**
 * GET /api/ai-instructions/list
 *
 * List all SKILL.md and .mdc files (public endpoint)
 */
export const handleListInstructions: RequestHandler = async (req, res) => {
  try {
    const files: SkillFile[] = [];

    console.log("[ai-instructions] Listing instruction files...");

    // Read skills directory
    try {
      const skillDirs = await fs.readdir(SKILLS_DIR);

      for (const dir of skillDirs) {
        const skillPath = path.join(SKILLS_DIR, dir, "SKILL.md");
        try {
          const content = await fs.readFile(skillPath, "utf-8");

          // Extract frontmatter description
          const frontmatterMatch = content.match(/---\n([\s\S]*?)\n---/);
          let description = "";
          if (frontmatterMatch) {
            const descMatch = frontmatterMatch[1].match(
              /description:\s*>\s*([\s\S]*?)(?=\n\w+:|$)/,
            );
            if (descMatch) {
              description = descMatch[1].trim().replace(/\n\s*/g, " ");
            }
          }

          files.push({
            id: `skill-${dir}`,
            name: dir,
            path: `.builder/skills/${dir}/SKILL.md`,
            category: "skill",
            description,
          });
        } catch (err) {
          // Skip if SKILL.md doesn't exist
        }
      }
    } catch (err) {
      console.error("Error reading skills directory:", err);
    }

    // Read rules directory
    try {
      const ruleFiles = await fs.readdir(RULES_DIR);

      for (const file of ruleFiles) {
        if (file.endsWith(".mdc") || file.endsWith(".md")) {
          const rulePath = path.join(RULES_DIR, file);
          try {
            const content = await fs.readFile(rulePath, "utf-8");

            // Extract frontmatter description
            const frontmatterMatch = content.match(/---\n([\s\S]*?)\n---/);
            let description = "";
            if (frontmatterMatch) {
              const descMatch =
                frontmatterMatch[1].match(/description:\s*(.+)/);
              if (descMatch) {
                description = descMatch[1].trim();
              }
            }

            files.push({
              id: `rule-${file}`,
              name: file.replace(/\.(mdc|md)$/, ""),
              path: `.builder/rules/${file}`,
              category: "rule",
              description,
            });
          } catch (err) {
            console.error(`Error reading rule file ${file}:`, err);
          }
        }
      }
    } catch (err) {
      console.error("Error reading rules directory:", err);
    }

    res.json({ files });
  } catch (err: any) {
    console.error("List instructions error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/ai-instructions/get?path=.builder/skills/bigquery/SKILL.md
 *
 * Get content of a specific SKILL.md or .mdc file
 */
export const handleGetInstruction: RequestHandler = async (req, res) => {
  try {
    const { path: filePath } = req.query;

    if (!filePath || typeof filePath !== "string") {
      res.status(400).json({ error: "Missing path parameter" });
      return;
    }

    // Security: ensure path is within .builder directory
    if (!filePath.startsWith(".builder/")) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const fullPath = path.join(process.cwd(), filePath);
    const content = await fs.readFile(fullPath, "utf-8");

    res.json({ content, path: filePath });
  } catch (err: any) {
    console.error("Get instruction error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/ai-instructions/can-edit
 *
 * Check if current user can edit AI instructions
 */
export const handleCanEditInstructions: RequestHandler = async (req, res) => {
  try {
    const userInfo = await getUserInfoFromToken(req);

    if (!userInfo) {
      res.json({ canEdit: false, email: "" });
      return;
    }

    // Check if user is admin (builder.io email) or in analytics team (DATA_DICT_REVIEWERS)
    const isAdmin = userInfo.email.toLowerCase().endsWith("@builder.io");

    const reviewersEnv = process.env.DATA_DICT_REVIEWERS || "";
    const allowedReviewers = reviewersEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    const isAnalytics = allowedReviewers.includes(userInfo.email.toLowerCase());
    const canEdit = isAdmin || isAnalytics;

    res.json({ canEdit, email: userInfo.email });
  } catch (err: any) {
    console.error("Can edit check error:", err.message);
    res.json({ canEdit: false, email: "" });
  }
};

/**
 * POST /api/ai-instructions/save
 *
 * Save content to a SKILL.md or .mdc file
 * Body: { path: string, content: string }
 */
export const handleSaveInstruction: RequestHandler = async (req, res) => {
  try {
    const userInfo = await getUserInfoFromToken(req);

    if (!userInfo) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Check if user is admin (builder.io email) or in analytics team (DATA_DICT_REVIEWERS)
    const isAdmin = userInfo.email.toLowerCase().endsWith("@builder.io");

    const reviewersEnv = process.env.DATA_DICT_REVIEWERS || "";
    const allowedReviewers = reviewersEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    const isAnalytics = allowedReviewers.includes(userInfo.email.toLowerCase());

    if (!isAdmin && !isAnalytics) {
      res.status(403).json({
        error: "Only admins and analytics team can edit AI instructions",
      });
      return;
    }

    const { path: filePath, content } = req.body;

    if (!filePath || typeof filePath !== "string") {
      res.status(400).json({ error: "Missing path parameter" });
      return;
    }

    if (typeof content !== "string") {
      res.status(400).json({ error: "Missing content parameter" });
      return;
    }

    // Security: ensure path is within .builder directory
    if (!filePath.startsWith(".builder/")) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const fullPath = path.join(process.cwd(), filePath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write file
    await fs.writeFile(fullPath, content, "utf-8");

    console.log(`[ai-instructions] Saved ${filePath} by ${userInfo.email}`);

    res.json({
      success: true,
      path: filePath,
      savedBy: userInfo.email,
    });
  } catch (err: any) {
    console.error("Save instruction error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
