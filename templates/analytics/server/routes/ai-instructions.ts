import { defineEventHandler, getQuery, readBody, setResponseStatus } from "h3";
import fs from "fs/promises";
import path from "path";
const SKILLS_DIR = path.join(process.cwd(), ".builder/skills");
const RULES_DIR = path.join(process.cwd(), ".builder/rules");

// Auth removed — stub always returns a local user
async function getUserInfoFromToken(): Promise<{
  uid: string;
  email: string;
} | null> {
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
export const handleListInstructions = defineEventHandler(async (event) => {
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

    return { files };
  } catch (err: any) {
    console.error("List instructions error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

/**
 * GET /api/ai-instructions/get?path=.builder/skills/bigquery/SKILL.md
 *
 * Get content of a specific SKILL.md or .mdc file
 */
export const handleGetInstruction = defineEventHandler(async (event) => {
  try {
    const { path: filePath } = getQuery(event);

    if (!filePath || typeof filePath !== "string") {
      setResponseStatus(event, 400);
      return { error: "Missing path parameter" };
    }

    // Security: ensure path is within .builder directory
    if (!filePath.startsWith(".builder/")) {
      setResponseStatus(event, 403);
      return { error: "Access denied" };
    }

    const fullPath = path.join(process.cwd(), filePath);
    const content = await fs.readFile(fullPath, "utf-8");

    return { content, path: filePath };
  } catch (err: any) {
    console.error("Get instruction error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

/**
 * GET /api/ai-instructions/can-edit
 *
 * Check if current user can edit AI instructions
 */
export const handleCanEditInstructions = defineEventHandler(async (event) => {
  try {
    const userInfo = await getUserInfoFromToken();

    if (!userInfo) {
      return { canEdit: false, email: "" };
    }

    // Check if user is admin (matches ADMIN_EMAIL_DOMAIN) or in analytics team (DATA_DICT_REVIEWERS)
    const adminDomain = process.env.ADMIN_EMAIL_DOMAIN || "";
    const isAdmin =
      adminDomain && userInfo.email.toLowerCase().endsWith(`@${adminDomain}`);

    const reviewersEnv = process.env.DATA_DICT_REVIEWERS || "";
    const allowedReviewers = reviewersEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    const isAnalytics = allowedReviewers.includes(userInfo.email.toLowerCase());
    const canEdit = isAdmin || isAnalytics;

    return { canEdit, email: userInfo.email };
  } catch (err: any) {
    console.error("Can edit check error:", err.message);
    return { canEdit: false, email: "" };
  }
});

/**
 * POST /api/ai-instructions/save
 *
 * Save content to a SKILL.md or .mdc file
 * Body: { path: string, content: string }
 */
export const handleSaveInstruction = defineEventHandler(async (event) => {
  try {
    const userInfo = await getUserInfoFromToken();

    if (!userInfo) {
      setResponseStatus(event, 401);
      return { error: "Authentication required" };
    }

    // Check if user is admin (matches ADMIN_EMAIL_DOMAIN) or in analytics team (DATA_DICT_REVIEWERS)
    const adminDomain = process.env.ADMIN_EMAIL_DOMAIN || "";
    const isAdmin =
      adminDomain && userInfo.email.toLowerCase().endsWith(`@${adminDomain}`);

    const reviewersEnv = process.env.DATA_DICT_REVIEWERS || "";
    const allowedReviewers = reviewersEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    const isAnalytics = allowedReviewers.includes(userInfo.email.toLowerCase());

    if (!isAdmin && !isAnalytics) {
      setResponseStatus(event, 403);
      return {
        error: "Only admins and analytics team can edit AI instructions",
      };
    }

    const { path: filePath, content } = await readBody(event);

    if (!filePath || typeof filePath !== "string") {
      setResponseStatus(event, 400);
      return { error: "Missing path parameter" };
    }

    if (typeof content !== "string") {
      setResponseStatus(event, 400);
      return { error: "Missing content parameter" };
    }

    // Security: ensure path is within .builder directory
    if (!filePath.startsWith(".builder/")) {
      setResponseStatus(event, 403);
      return { error: "Access denied" };
    }

    const fullPath = path.join(process.cwd(), filePath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write file
    await fs.writeFile(fullPath, content, "utf-8");

    console.log(`[ai-instructions] Saved ${filePath} by ${userInfo.email}`);

    return {
      success: true,
      path: filePath,
      savedBy: userInfo.email,
    };
  } catch (err: any) {
    console.error("Save instruction error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});
