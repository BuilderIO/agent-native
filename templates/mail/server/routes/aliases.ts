import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { Alias } from "@shared/types.js";

const ALIASES_FILE = path.join(process.cwd(), "data", "aliases.json");

function readAliases(): Alias[] {
  try {
    return JSON.parse(fs.readFileSync(ALIASES_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeAliases(aliases: Alias[]): void {
  fs.mkdirSync(path.dirname(ALIASES_FILE), { recursive: true });
  fs.writeFileSync(ALIASES_FILE, JSON.stringify(aliases, null, 2));
}

export const listAliases = defineEventHandler((_event: H3Event) => {
  return readAliases();
});

export const createAlias = defineEventHandler(async (event: H3Event) => {
  const { name, emails } = (await readBody(event)) as {
    name: string;
    emails: string[];
  };
  if (!name?.trim() || !Array.isArray(emails) || emails.length === 0) {
    setResponseStatus(event, 400);
    return { error: "name and emails are required" };
  }
  const aliases = readAliases();
  const now = new Date().toISOString();
  const alias: Alias = {
    id: nanoid(10),
    name: name.trim(),
    emails,
    createdAt: now,
    updatedAt: now,
  };
  aliases.push(alias);
  writeAliases(aliases);
  setResponseStatus(event, 201);
  return alias;
});

export const updateAlias = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id");
  const { name, emails } = (await readBody(event)) as {
    name?: string;
    emails?: string[];
  };
  const aliases = readAliases();
  const idx = aliases.findIndex((a) => a.id === id);
  if (idx === -1) {
    setResponseStatus(event, 404);
    return { error: "Alias not found" };
  }
  aliases[idx] = {
    ...aliases[idx],
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(emails !== undefined ? { emails } : {}),
    updatedAt: new Date().toISOString(),
  };
  writeAliases(aliases);
  return aliases[idx];
});

export const deleteAlias = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id");
  const aliases = readAliases();
  const filtered = aliases.filter((a) => a.id !== id);
  if (filtered.length === aliases.length) {
    setResponseStatus(event, 404);
    return { error: "Alias not found" };
  }
  writeAliases(filtered);
  setResponseStatus(event, 204);
  return null;
});
