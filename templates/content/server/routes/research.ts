import { RequestHandler } from "express";
import fs from "fs";
import path from "path";
import type { ResearchData } from "../../shared/api";

const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");

function normalizeProjectParam(project: string | string[] | undefined): string {
  if (!project) return "";
  return Array.isArray(project) ? project.join("/") : project;
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

export const getResearch: RequestHandler = (req, res) => {
  const project = normalizeProjectParam(req.params.project);
  if (!isValidProjectPath(project)) {
    res.status(400).json({ error: "Invalid project" });
    return;
  }

  const researchPath = getResearchPath(project);
  if (!fs.existsSync(researchPath)) {
    res.json(null);
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(researchPath, "utf-8"));
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to read research data" });
  }
};

export const saveResearch: RequestHandler = (req, res) => {
  const project = normalizeProjectParam(req.params.project);
  if (!isValidProjectPath(project)) {
    res.status(400).json({ error: "Invalid project" });
    return;
  }

  const projectDir = path.join(PROJECTS_DIR, project);
  if (!fs.existsSync(projectDir)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const data: ResearchData = req.body;
  if (!data || !data.topic) {
    res.status(400).json({ error: "Research data with topic is required" });
    return;
  }

  data.updatedAt = new Date().toISOString();

  const resourcesDir = path.join(projectDir, "resources");
  if (!fs.existsSync(resourcesDir)) {
    fs.mkdirSync(resourcesDir, { recursive: true });
  }

  const researchPath = getResearchPath(project);
  fs.writeFileSync(researchPath, JSON.stringify(data, null, 2), "utf-8");
  res.json(data);
};
