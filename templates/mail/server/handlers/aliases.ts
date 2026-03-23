import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";
import type { Alias } from "@shared/types.js";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { getSession } from "@agent-native/core/server";

async function uEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
}

async function readAliases(email: string): Promise<Alias[]> {
  const data = await getUserSetting(email, "aliases");
  if (data && Array.isArray((data as any).aliases)) {
    return (data as any).aliases;
  }
  return [];
}

async function writeAliases(email: string, aliases: Alias[]): Promise<void> {
  await putUserSetting(email, "aliases", { aliases });
}

export const listAliases = defineEventHandler(async (event: H3Event) => {
  const email = await uEmail(event);
  return readAliases(email);
});

export const createAlias = defineEventHandler(async (event: H3Event) => {
  const email = await uEmail(event);
  const { name, emails } = (await readBody(event)) as {
    name: string;
    emails: string[];
  };
  if (!name?.trim() || !Array.isArray(emails) || emails.length === 0) {
    setResponseStatus(event, 400);
    return { error: "name and emails are required" };
  }
  const aliases = await readAliases(email);
  const now = new Date().toISOString();
  const alias: Alias = {
    id: nanoid(10),
    name: name.trim(),
    emails,
    createdAt: now,
    updatedAt: now,
  };
  aliases.push(alias);
  await writeAliases(email, aliases);
  setResponseStatus(event, 201);
  return alias;
});

export const updateAlias = defineEventHandler(async (event: H3Event) => {
  const email = await uEmail(event);
  const id = getRouterParam(event, "id");
  const { name, emails } = (await readBody(event)) as {
    name?: string;
    emails?: string[];
  };
  const aliases = await readAliases(email);
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
  await writeAliases(email, aliases);
  return aliases[idx];
});

export const deleteAlias = defineEventHandler(async (event: H3Event) => {
  const email = await uEmail(event);
  const id = getRouterParam(event, "id");
  const aliases = await readAliases(email);
  const filtered = aliases.filter((a) => a.id !== id);
  if (filtered.length === aliases.length) {
    setResponseStatus(event, 404);
    return { error: "Alias not found" };
  }
  await writeAliases(email, filtered);
  setResponseStatus(event, 204);
  return null;
});
