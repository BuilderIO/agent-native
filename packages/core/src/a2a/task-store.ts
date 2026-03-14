import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Task, Message, TaskState } from "./types.js";

const TASKS_DIR = path.join(process.cwd(), "data", "a2a-tasks");

function ensureDir() {
  fs.mkdirSync(TASKS_DIR, { recursive: true });
}

function taskPath(id: string): string {
  return path.join(TASKS_DIR, `${id}.json`);
}

export function createTask(message: Message, contextId?: string): Task {
  ensureDir();
  const task: Task = {
    id: crypto.randomUUID(),
    contextId,
    status: {
      state: "submitted",
      timestamp: new Date().toISOString(),
    },
    history: [message],
    artifacts: [],
  };
  fs.writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2));
  return task;
}

export function getTask(id: string): Task | null {
  try {
    const data = fs.readFileSync(taskPath(id), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function updateTask(
  id: string,
  update: {
    state?: TaskState;
    message?: Message;
    artifacts?: Task["artifacts"];
  },
): Task | null {
  const task = getTask(id);
  if (!task) return null;

  if (update.state) {
    task.status = {
      state: update.state,
      message: update.message ?? task.status.message,
      timestamp: new Date().toISOString(),
    };
  }

  if (update.message && task.history) {
    task.history.push(update.message);
  }

  if (update.artifacts) {
    task.artifacts = [...(task.artifacts ?? []), ...update.artifacts];
  }

  fs.writeFileSync(taskPath(id), JSON.stringify(task, null, 2));
  return task;
}

export function listTasks(contextId?: string): Task[] {
  ensureDir();
  const files = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json"));
  const tasks: Task[] = [];

  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(TASKS_DIR, file), "utf-8");
      const task: Task = JSON.parse(data);
      if (!contextId || task.contextId === contextId) {
        tasks.push(task);
      }
    } catch {
      // Skip invalid files
    }
  }

  return tasks;
}
