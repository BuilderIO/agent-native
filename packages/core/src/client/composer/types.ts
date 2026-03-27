export interface FileResult {
  path: string;
  name: string;
  source: "codebase" | "resource";
  type: "file" | "folder";
}

export interface SkillResult {
  name: string;
  description: string;
  path: string;
  source: "codebase" | "resource";
}

export interface Reference {
  type: "file" | "skill";
  path: string;
  name: string;
  source: "codebase" | "resource";
}
