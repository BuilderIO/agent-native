import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";
import type { Alias } from "@shared/types.js";
import { getSetting, putSetting } from "@agent-native/core/settings";

async function readAliases(): Promise<Alias[]> {
  const data = await getSetting("aliases");
  if (data && Array.isArray((data as any).aliases)) {
    return (data as any).aliases;
  }
  return [];
}

async function writeAliases(aliases: Alias[]): Promise<void> {
  await putSetting("aliases", { aliases });
}

export const listAliases = defineEventHandler(async (_event: H3Event) => {
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
  const aliases = await readAliases();
  const now = new Date().toISOString();
  const alias: Alias = {
    id: nanoid(10),
    name: name.trim(),
    emails,
    createdAt: now,
    updatedAt: now,
  };
  aliases.push(alias);
  await writeAliases(aliases);
  setResponseStatus(event, 201);
  return alias;
});

export const updateAlias = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id");
  const { name, emails } = (await readBody(event)) as {
    name?: string;
    emails?: string[];
  };
  const aliases = await readAliases();
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
  await writeAliases(aliases);
  return aliases[idx];
});

export const deleteAlias = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id");
  const aliases = await readAliases();
  const filtered = aliases.filter((a) => a.id !== id);
  if (filtered.length === aliases.length) {
    setResponseStatus(event, 404);
    return { error: "Alias not found" };
  }
  await writeAliases(filtered);
  setResponseStatus(event, 204);
  return null;
});
