import type { Request, Response } from "express";
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

export function listAliases(req: Request, res: Response) {
  res.json(readAliases());
}

export function createAlias(req: Request, res: Response) {
  const { name, emails } = req.body as { name: string; emails: string[] };
  if (!name?.trim() || !Array.isArray(emails) || emails.length === 0) {
    res.status(400).json({ error: "name and emails are required" });
    return;
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
  res.status(201).json(alias);
}

export function updateAlias(req: Request, res: Response) {
  const { id } = req.params;
  const { name, emails } = req.body as { name?: string; emails?: string[] };
  const aliases = readAliases();
  const idx = aliases.findIndex((a) => a.id === id);
  if (idx === -1) {
    res.status(404).json({ error: "Alias not found" });
    return;
  }
  aliases[idx] = {
    ...aliases[idx],
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(emails !== undefined ? { emails } : {}),
    updatedAt: new Date().toISOString(),
  };
  writeAliases(aliases);
  res.json(aliases[idx]);
}

export function deleteAlias(req: Request, res: Response) {
  const { id } = req.params;
  const aliases = readAliases();
  const filtered = aliases.filter((a) => a.id !== id);
  if (filtered.length === aliases.length) {
    res.status(404).json({ error: "Alias not found" });
    return;
  }
  writeAliases(filtered);
  res.status(204).end();
}
