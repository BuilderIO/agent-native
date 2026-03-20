import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "fs";
import path from "path";
import type { ResearchData } from "../../shared/api";

const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");

function normalizeProjectParam(project: string | undefined): string {
  if (!project) return "";
  return project;
}

function isValidProjectPath(project: string): boolean {
  if (!project) return false;
  const normalized = path.posix.normalize(project);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  if (normalized.includes("\0")) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return false;
  return segments.every((segment) => /^[a-z0-9][a-z0-9-]*$/.test(segment));
}

function getResearchPath(project: string): string {
  return path.join(PROJECTS_DIR, project, "resources", "research.json");
}

export const getResearch = defineEventHandler((event: H3Event) => {
  const project = normalizeProjectParam(
    getRouterParam(event, "project") as string,
  );
  if (!isValidProjectPath(project)) {
    setResponseStatus(event, 400);
    return { error: "Invalid project" };
  }

  const researchPath = getResearchPath(project);
  if (!fs.existsSync(researchPath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(researchPath, "utf-8"));
    return data;
  } catch {
    setResponseStatus(event, 500);
    return { error: "Failed to read research data" };
  }
});

export const saveResearch = defineEventHandler(async (event: H3Event) => {
  const project = normalizeProjectParam(
    getRouterParam(event, "project") as string,
  );
  if (!isValidProjectPath(project)) {
    setResponseStatus(event, 400);
    return { error: "Invalid project" };
  }

  const projectDir = path.join(PROJECTS_DIR, project);
  if (!fs.existsSync(projectDir)) {
    setResponseStatus(event, 404);
    return { error: "Project not found" };
  }

  const data: ResearchData = await readBody(event);
  if (!data || !data.topic) {
    setResponseStatus(event, 400);
    return { error: "Research data with topic is required" };
  }

  data.updatedAt = new Date().toISOString();

  const resourcesDir = path.join(projectDir, "resources");
  if (!fs.existsSync(resourcesDir)) {
    fs.mkdirSync(resourcesDir, { recursive: true });
  }

  const researchPath = getResearchPath(project);
  fs.writeFileSync(researchPath, JSON.stringify(data, null, 2), "utf-8");
  return data;
});
