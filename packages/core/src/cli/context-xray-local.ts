import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ClientId } from "./mcp-config-writers.js";

export interface InstallLocalContextXrayOptions {
  baseDir?: string;
  clients: ClientId[];
  scope: string;
  dryRun?: boolean;
}

export interface InstallLocalContextXrayResult {
  commands: string[];
  scriptPath: string;
  written: string[];
}

const CONTEXT_XRAY_EXECUTABLE = String.raw`#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const HOME = os.homedir();
const CODEX_DIR = process.env.CODEX_HOME && process.env.CODEX_HOME.trim() ? process.env.CODEX_HOME.trim() : path.join(HOME, ".codex");
const CLAUDE_DIR = path.join(HOME, ".claude");
const OUT_DIR = path.join(CODEX_DIR, "context-xray");
const SESSION_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CATEGORIES = ["user", "assistant", "tool_call", "tool_output", "reasoning", "instructions", "attachment", "metadata", "other"];
const LABELS = {
  user: "User asks",
  assistant: "Assistant text",
  tool_call: "Tool calls",
  tool_output: "Tool output",
  reasoning: "Reasoning",
  instructions: "Instructions/context",
  attachment: "Attachments",
  metadata: "Metadata",
  other: "Other",
};
const COLORS = {
  user: "#8ba8ff",
  assistant: "#55b982",
  tool_call: "#f0a85b",
  tool_output: "#e06b73",
  reasoning: "#a77be8",
  instructions: "#6ac3d5",
  attachment: "#d6a85a",
  metadata: "#9aa3ad",
  other: "#c3c8ce",
};

function parseArgs(argv) {
  const out = {
    mode: "current",
    source: "both",
    since: "7d",
    last: 12,
    scanLimit: 80,
    project: process.cwd(),
    allProjects: false,
    sessionId: "",
    format: "html",
    out: "",
    open: false,
    port: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eat = (flag) => {
      if (arg === flag) return argv[++i] || "";
      if (arg.startsWith(flag + "=")) return arg.slice(flag.length + 1);
      return undefined;
    };
    let value;
    if (arg === "threads" || arg === "--threads") out.mode = "threads";
    else if (arg === "trends" || arg === "--trends") out.mode = "trends";
    else if (arg === "current" || arg === "--current") out.mode = "current";
    else if ((value = eat("--source")) !== undefined) out.source = value;
    else if ((value = eat("--since")) !== undefined) out.since = value;
    else if ((value = eat("--last")) !== undefined) out.last = Number(value) || out.last;
    else if ((value = eat("--scan-limit")) !== undefined) out.scanLimit = Number(value) || out.scanLimit;
    else if ((value = eat("--project")) !== undefined) out.project = value;
    else if ((value = eat("--session-id")) !== undefined) out.sessionId = value;
    else if ((value = eat("--format")) !== undefined) out.format = value;
    else if ((value = eat("--out")) !== undefined) out.out = value;
    else if ((value = eat("--port")) !== undefined) out.port = Number(value) || 0;
    else if (arg === "--all-projects") out.allProjects = true;
    else if (arg === "--open") out.open = true;
    else if (arg === "--json") out.format = "json";
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  if (process.env.CLAUDE_CODE_SESSION_ID && !out.sessionId && out.mode === "current") {
    out.sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  }
  if (out.mode === "threads") {
    out.allProjects = true;
    out.last = Math.max(out.last, 30);
  }
  if (out.mode === "trends") {
    out.allProjects = true;
    out.last = Math.max(out.last, 60);
  }
  if (out.mode === "current") {
    out.last = 1;
  }
  return out;
}

function help() {
  console.log([
    "Context X-Ray",
    "",
    "Usage:",
    "  context-xray --open                    Visualize the current/recent local thread",
    "  context-xray threads --open            Pick from recent Codex/Claude sessions",
    "  context-xray trends --since 7d --open  Show recent usage trends",
    "  context-xray --session-id <id> --open  Analyze one exact session",
    "",
    "Options:",
    "  --source codex|claude|both",
    "  --since 24h|7d|2w|ISO",
    "  --last <n>",
    "  --all-projects",
    "  --format html|json",
    "  --out <path>",
  ].join("\n"));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseSince(value) {
  const now = Date.now();
  const match = String(value || "7d").trim().toLowerCase().match(/^(\d+)([hdw])$/);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2];
    const mult = unit === "h" ? 3600000 : unit === "d" ? 86400000 : 604800000;
    return now - amount * mult;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : now - 7 * 86400000;
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function compact(value) {
  try {
    const text = JSON.stringify(value);
    return text.length > 250000 ? text.slice(0, 250000) : text;
  } catch {
    return String(value || "");
  }
}

function textFrom(value, depth) {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") return value.length > 250000 ? value.slice(0, 250000) : value;
  if (typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map((item) => textFrom(item, depth + 1)).filter(Boolean).join("\n");
  const skip = new Set(["encrypted_content", "id", "uuid", "call_id", "sessionId", "parentUuid"]);
  const keys = new Set(["text", "message", "output", "result", "content", "summary", "arguments", "args", "input", "stdout", "stderr", "attachment"]);
  const parts = [];
  for (const key of Object.keys(value)) {
    if (skip.has(key)) continue;
    const item = value[key];
    if (keys.has(key) || typeof item === "object") {
      const text = textFrom(item, depth + 1);
      if (text) parts.push(text);
    }
  }
  return parts.join("\n");
}

function addCounter(counter, key, amount) {
  if (!key || !amount) return;
  counter[key] = (counter[key] || 0) + amount;
}

function mergeCounter(into, from) {
  for (const key of Object.keys(from || {})) addCounter(into, key, from[key]);
}

function estimateTokens(chars) {
  return chars > 0 ? Math.max(1, Math.ceil(chars / 4)) : 0;
}

function fmtTokens(tokens) {
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + "m";
  if (tokens >= 1000) return (tokens / 1000).toFixed(1) + "k";
  return String(tokens);
}

function pct(part, total) {
  return total > 0 ? Math.max(0, Math.min(100, (part / total) * 100)) : 0;
}

function pathCounts(text) {
  const out = {};
  const matches = String(text || "").match(/(?:(?:\/[\w@.+,=-]+)+|(?:[\w.-]+\/)+[\w.+,=-]+)(?:\.[A-Za-z0-9_+-]+)?/g) || [];
  for (const raw of matches) {
    const value = raw.replace(/['",.)]+$/g, "");
    if (value.length > 5 && !value.startsWith("http") && value.includes("/")) addCounter(out, value, 1);
  }
  return out;
}

function codexTitle(id) {
  const index = path.join(CODEX_DIR, "session_index.jsonl");
  for (const record of readJsonl(index)) {
    if (record.id === id && record.thread_name) return String(record.thread_name);
  }
  return "";
}

function observedCodexTokens(payload) {
  if (!payload || payload.type !== "token_count" || !payload.info) return 0;
  const last = payload.info.last_token_usage;
  if (last && Number(last.total_tokens)) return Number(last.total_tokens);
  const total = payload.info.total_token_usage;
  if (total && Number(total.total_tokens)) return Number(total.total_tokens);
  if (total && typeof total === "object") {
    return ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens"].reduce((sum, key) => sum + (Number(total[key]) || 0), 0);
  }
  return 0;
}

function claudeUsageTokens(usage) {
  if (!usage || typeof usage !== "object") return 0;
  return (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0) + (Number(usage.cache_read_input_tokens) || 0);
}

function sessionIdFromPath(file) {
  const match = path.basename(file).match(SESSION_ID_RE);
  return match ? match[0] : path.basename(file, ".jsonl");
}

function classifyCodex(record) {
  const top = String(record.type || "");
  const payload = record.payload && typeof record.payload === "object" ? record.payload : {};
  const ptype = String(payload.type || "");
  let category = "other";
  const tools = {};
  if (top === "session_meta") category = "metadata";
  else if (top === "turn_context") category = "instructions";
  else if (top === "event_msg") category = ptype === "user_message" ? "user" : "metadata";
  else if (top === "response_item") {
    if (["function_call", "custom_tool_call", "web_search_call", "tool_search_call", "tool_call"].includes(ptype) || payload.name && payload.call_id) {
      category = "tool_call";
      if (payload.name) addCounter(tools, String(payload.name), 1);
    } else if (["function_call_output", "custom_tool_call_output", "tool_search_output", "tool_result"].includes(ptype) || Object.prototype.hasOwnProperty.call(payload, "output")) category = "tool_output";
    else if (ptype === "reasoning" || payload.summary) category = "reasoning";
    else if (payload.role === "assistant") category = "assistant";
    else if (payload.role === "user" || payload.role === "developer") category = "user";
  }
  const text = textFrom(record, 0) || (category === "metadata" ? compact(record) : "");
  return { category, chars: text.length, tools, paths: pathCounts(text) };
}

function classifyClaude(record) {
  let category = "other";
  const tools = {};
  const message = record.message && typeof record.message === "object" ? record.message : null;
  let text = "";
  if (message) {
    if (message.role === "user") category = "user";
    else if (message.role === "assistant") category = "assistant";
    const content = Array.isArray(message.content) ? message.content : [message.content];
    const parts = [];
    for (const part of content) {
      if (part && typeof part === "object") {
        if (part.type === "tool_use") {
          category = "tool_call";
          if (part.name) addCounter(tools, String(part.name), 1);
        } else if (part.type === "tool_result") category = "tool_output";
        else if (part.type === "thinking") category = "reasoning";
      }
      parts.push(textFrom(part, 0));
    }
    text = parts.join("\n");
  } else if (record.toolUseResult) {
    category = "tool_output";
    text = textFrom(record.toolUseResult, 0);
  } else if (record.attachment) {
    category = "attachment";
    text = textFrom(record.attachment, 0);
  } else {
    text = textFrom(record, 0);
  }
  return { category, chars: text.length, tools, paths: pathCounts(text) };
}

function summarizeCodex(file) {
  const stat = fs.statSync(file);
  const summary = {
    source: "codex",
    path: file,
    sessionId: sessionIdFromPath(file),
    title: "",
    cwd: "",
    startedAt: "",
    updatedAt: "",
    categories: {},
    tools: {},
    paths: {},
    observedTokens: 0,
    bytes: stat.size,
    mtime: stat.mtimeMs,
  };
  const records = readJsonl(file);
  for (const record of records) {
    const payload = record.payload && typeof record.payload === "object" ? record.payload : {};
    if (record.type === "session_meta") {
      summary.sessionId = String(payload.id || summary.sessionId);
      summary.cwd = String(payload.cwd || summary.cwd);
      summary.startedAt = String(payload.timestamp || summary.startedAt);
    }
    if (payload.cwd && !summary.cwd) summary.cwd = String(payload.cwd);
    if (record.timestamp) summary.updatedAt = String(record.timestamp);
    summary.observedTokens = Math.max(summary.observedTokens, observedCodexTokens(payload));
    const stats = classifyCodex(record);
    addCounter(summary.categories, stats.category, stats.chars);
    mergeCounter(summary.tools, stats.tools);
    mergeCounter(summary.paths, stats.paths);
  }
  summary.title = codexTitle(summary.sessionId) || summary.sessionId;
  return finalizeSummary(summary);
}

function summarizeClaude(file) {
  const stat = fs.statSync(file);
  const summary = {
    source: "claude",
    path: file,
    sessionId: sessionIdFromPath(file),
    title: "",
    cwd: "",
    startedAt: "",
    updatedAt: "",
    categories: {},
    tools: {},
    paths: {},
    observedTokens: 0,
    bytes: stat.size,
    mtime: stat.mtimeMs,
  };
  const records = readJsonl(file);
  for (const record of records) {
    summary.sessionId = String(record.sessionId || summary.sessionId);
    summary.cwd = String(record.cwd || summary.cwd);
    if (record.timestamp) {
      summary.updatedAt = String(record.timestamp);
      if (!summary.startedAt) summary.startedAt = String(record.timestamp);
    }
    if (record.message && typeof record.message === "object") {
      summary.observedTokens = Math.max(summary.observedTokens, claudeUsageTokens(record.message.usage));
      if (!summary.title && record.message.role === "user") summary.title = cleanTitle(textFrom(record.message, 0)).slice(0, 90);
    }
    const stats = classifyClaude(record);
    addCounter(summary.categories, stats.category, stats.chars);
    mergeCounter(summary.tools, stats.tools);
    mergeCounter(summary.paths, stats.paths);
  }
  if (!summary.title) summary.title = summary.sessionId;
  return finalizeSummary(summary);
}

function finalizeSummary(summary) {
  const totalChars = Object.values(summary.categories).reduce((sum, value) => sum + value, 0);
  summary.totalChars = totalChars;
  summary.tokens = summary.observedTokens || estimateTokens(totalChars);
  summary.tokenMethod = summary.observedTokens ? "observed" : "estimated";
  return summary;
}

function walk(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(file);
    }
  };
  visit(root);
  return out;
}

function encodedProject(project) {
  return path.resolve(project).replace(/\//g, "-");
}

function pathInsideOrEqual(value, parent) {
  const relative = path.relative(parent, value);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function candidateFiles(source, args) {
  if (args.sessionId) {
    const roots = source === "codex" ? [path.join(CODEX_DIR, "sessions"), path.join(CODEX_DIR, "archived_sessions")] : [path.join(CLAUDE_DIR, "projects")];
    return roots.flatMap(walk).filter((file) => file.includes(args.sessionId));
  }
  const since = parseSince(args.since);
  const roots = source === "codex" ? [path.join(CODEX_DIR, "sessions"), path.join(CODEX_DIR, "archived_sessions")] : [path.join(CLAUDE_DIR, "projects")];
  const projectFragment = encodedProject(args.project);
  const files = roots.flatMap(walk).filter((file) => {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return false;
    }
    if (stat.mtimeMs < since) return false;
    if (args.allProjects || source === "codex") return true;
    return file.includes(projectFragment) || file.includes(path.basename(args.project));
  }).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return source === "codex" && !args.allProjects ? files : files.slice(0, args.scanLimit);
}

function projectMatches(session, args) {
  if (args.allProjects || args.sessionId) return true;
  const project = path.resolve(args.project);
  if (session.cwd && pathInsideOrEqual(path.resolve(session.cwd), project)) return true;
  return session.path.includes(encodedProject(project));
}

function collectSessions(args) {
  const sources = args.source === "both" ? ["codex", "claude"] : [args.source];
  const sessions = [];
  for (const source of sources) {
    for (const file of candidateFiles(source, args)) {
      try {
        const summary = source === "codex" ? summarizeCodex(file) : summarizeClaude(file);
        if (projectMatches(summary, args)) sessions.push(summary);
      } catch {}
    }
  }
  if (args.mode === "current" || args.sessionId) sessions.sort((a, b) => b.mtime - a.mtime);
  else sessions.sort((a, b) => b.tokens - a.tokens || b.mtime - a.mtime);
  return sessions.slice(0, args.last);
}

function aggregate(sessions) {
  const out = { categories: {}, tools: {}, paths: {} };
  for (const session of sessions) {
    mergeCounter(out.categories, session.categories);
    mergeCounter(out.tools, session.tools);
    mergeCounter(out.paths, session.paths);
  }
  return out;
}

function sortedEntries(counter, limit) {
  return Object.entries(counter || {}).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function recommendations(sessions) {
  if (!sessions.length) return ["No matching sessions found. Try context-xray threads --all-projects --since 2w --open."];
  const agg = aggregate(sessions);
  const total = Object.values(agg.categories).reduce((sum, value) => sum + value, 0);
  const tips = [];
  const toolOutput = pct(agg.categories.tool_output || 0, total);
  const instructions = pct(agg.categories.instructions || 0, total);
  const assistant = pct(agg.categories.assistant || 0, total);
  const maxSession = sessions.reduce((a, b) => a.tokens > b.tokens ? a : b);
  if (toolOutput > 45) tips.push("Tool output dominates context. Prefer targeted rg/sed ranges, cap logs, and ask agents to summarize failing blocks instead of pasting full output.");
  if (instructions > 25) tips.push("Instructions are a large share. Move stable workflow rules into skills or AGENTS/CLAUDE files and keep per-turn prompts short.");
  if (assistant > 45) tips.push("Assistant prose is heavy. Ask for terse progress updates during long runs and save rationale only when it changes decisions.");
  if (maxSession.tokens > 80000) tips.push("The largest session is about " + fmtTokens(maxSession.tokens) + " " + maxSession.tokenMethod + " tokens. Compact or start a fresh handoff before another big implementation pass.");
  const topTool = sortedEntries(agg.tools, 1)[0];
  if (topTool && topTool[1] > 20) tips.push(topTool[0] + " appears " + topTool[1] + " times. Batch independent inspection and use parallel reads/searches.");
  const topPath = sortedEntries(agg.paths, 1)[0];
  if (topPath && topPath[1] > 12) tips.push(topPath[0] + " appears repeatedly (" + topPath[1] + " mentions). Pin a short role summary instead of rereading it.");
  return tips.length ? tips.slice(0, 6) : ["Recent sessions look balanced. Keep using focused reads, compact after milestones, and preserve decisions in a skill or repo doc."];
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
}

function cleanTitle(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function categoryBar(categories) {
  const total = Object.values(categories || {}).reduce((sum, value) => sum + value, 0);
  if (!total) return "<div class=\"bar\"></div>";
  return "<div class=\"bar\">" + CATEGORIES.map((cat) => {
    const value = categories[cat] || 0;
    if (!value) return "";
    const width = Math.max(1, pct(value, total));
    return "<span title=\"" + escapeHtml(LABELS[cat]) + "\" style=\"width:" + width.toFixed(2) + "%;background:" + COLORS[cat] + "\"></span>";
  }).join("") + "</div>";
}

function renderHtml(sessions, args) {
  const agg = aggregate(sessions);
  const totalTokens = sessions.reduce((sum, s) => sum + s.tokens, 0);
  const tips = recommendations(sessions);
  const categoryRows = CATEGORIES.map((cat) => {
    const chars = agg.categories[cat] || 0;
    if (!chars) return "";
    return "<tr><td>" + escapeHtml(LABELS[cat]) + "</td><td>" + fmtTokens(estimateTokens(chars)) + "</td><td>" + pct(chars, Object.values(agg.categories).reduce((sum, value) => sum + value, 0)).toFixed(0) + "%</td></tr>";
  }).join("");
  const sessionCards = sessions.map((session) => {
    const cats = Object.entries(session.categories).sort((a, b) => b[1] - a[1]).map((entry) => "<tr><td>" + escapeHtml(LABELS[entry[0]] || entry[0]) + "</td><td>" + fmtTokens(estimateTokens(entry[1])) + "</td><td>" + pct(entry[1], session.totalChars).toFixed(0) + "%</td></tr>").join("");
    const tools = sortedEntries(session.tools, 6).map((entry) => "<span class=\"badge\">" + escapeHtml(entry[0]) + " x" + entry[1] + "</span>").join("");
    const paths = sortedEntries(session.paths, 5).map((entry) => "<span class=\"badge muted\">" + escapeHtml(entry[0]) + " x" + entry[1] + "</span>").join("");
    return "<article class=\"card session\"><div class=\"session-head\"><div><div class=\"eyebrow\">" + escapeHtml(session.source) + " - " + escapeHtml(session.updatedAt || "unknown time") + "</div><h3>" + escapeHtml(session.title || session.sessionId) + "</h3><p class=\"path\">" + escapeHtml(session.cwd || session.path) + "</p></div><div class=\"token-big\">" + fmtTokens(session.tokens) + "</div></div>" + categoryBar(session.categories) + "<div class=\"session-grid\"><table><tbody>" + cats + "</tbody></table><div><div class=\"mini-label\">Frequent tools</div><div class=\"badges\">" + (tools || "<span class=\"muted-text\">none detected</span>") + "</div><div class=\"mini-label\">Repeated paths</div><div class=\"badges\">" + (paths || "<span class=\"muted-text\">none detected</span>") + "</div></div></div></article>";
  }).join("");
  const topTools = sortedEntries(agg.tools, 10).map((entry) => "<tr><td>" + escapeHtml(entry[0]) + "</td><td>" + entry[1] + "</td></tr>").join("");
  const topPaths = sortedEntries(agg.paths, 10).map((entry) => "<tr><td>" + escapeHtml(entry[0]) + "</td><td>" + entry[1] + "</td></tr>").join("");
  const sourceCounts = sessions.reduce((counts, s) => (counts[s.source] = (counts[s.source] || 0) + 1, counts), {});
  return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Context X-Ray</title><style>" +
    "body{margin:0;background:#0e1116;color:#f3f5f8;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.45}main{max-width:1180px;margin:0 auto;padding:32px 20px 56px}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;margin-bottom:24px}h1{margin:0;font-size:clamp(28px,5vw,52px);letter-spacing:0}h2{margin:0 0 14px;font-size:18px}h3{margin:3px 0 4px;font-size:17px}p{margin:0}.muted,.path,.eyebrow,.muted-text{color:#9aa3ad}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.card{background:linear-gradient(180deg,#151922,#1c2230);border:1px solid #2a3140;border-radius:8px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.22)}.stat strong{display:block;font-size:28px;line-height:1.1}.grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,.8fr);gap:16px;align-items:start}.bar{display:flex;overflow:hidden;height:14px;border-radius:999px;background:#252b37;margin:12px 0}.bar span{display:block;min-width:2px}.tips li{margin:0 0 9px}.session{margin-top:14px}.session-head{display:flex;justify-content:space-between;gap:16px}.token-big{font-weight:700;font-size:28px;color:#8ba8ff;white-space:nowrap}.session-grid{display:grid;grid-template-columns:260px minmax(0,1fr);gap:14px;margin-top:12px}table{width:100%;border-collapse:collapse;font-size:13px}td{border-top:1px solid #2a3140;padding:7px 0;vertical-align:top}td:last-child{text-align:right;color:#9aa3ad}.mini-label{margin:7px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#9aa3ad}.badges{display:flex;flex-wrap:wrap;gap:6px}.badge{display:inline-flex;border:1px solid #2a3140;border-radius:999px;padding:3px 8px;font-size:12px;background:rgba(255,255,255,.04)}.badge.muted{color:#9aa3ad}footer{color:#9aa3ad;margin-top:24px;font-size:12px}@media(max-width:840px){header,.grid,.session-grid{grid-template-columns:1fr;display:grid}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}}" +
    "</style></head><body><main><header><div><div class=\"eyebrow\">Local coding context profile</div><h1>Context X-Ray</h1><p class=\"muted\">Generated " + escapeHtml(new Date().toLocaleString()) + " - mode=" + escapeHtml(args.mode) + " - source=" + escapeHtml(args.source) + " - since=" + escapeHtml(args.since) + "</p></div></header><section class=\"summary\"><div class=\"card stat\"><span class=\"muted\">Sessions</span><strong>" + sessions.length + "</strong></div><div class=\"card stat\"><span class=\"muted\">Observed/estimated tokens</span><strong>" + fmtTokens(totalTokens) + "</strong></div><div class=\"card stat\"><span class=\"muted\">Codex</span><strong>" + (sourceCounts.codex || 0) + "</strong></div><div class=\"card stat\"><span class=\"muted\">Claude</span><strong>" + (sourceCounts.claude || 0) + "</strong></div></section><section class=\"card\"><h2>Where The Context Is Going</h2>" + categoryBar(agg.categories) + "<table><tbody>" + categoryRows + "</tbody></table></section><div class=\"grid\" style=\"margin-top:16px\"><section class=\"card tips\"><h2>Warnings And Optimizations</h2><ol>" + tips.map((tip) => "<li>" + escapeHtml(tip) + "</li>").join("") + "</ol></section><section class=\"card\"><h2>Hotspots</h2><div class=\"mini-label\">Top tools</div><table><tbody>" + (topTools || "<tr><td>None detected</td><td></td></tr>") + "</tbody></table><div class=\"mini-label\">Top paths</div><table><tbody>" + (topPaths || "<tr><td>None detected</td><td></td></tr>") + "</tbody></table></section></div><section style=\"margin-top:16px\"><h2>Sessions</h2>" + sessionCards + "</section><footer>Reads local transcript files only. No transcript content is uploaded.</footer></main></body></html>";
}

function writeJson(sessions, args, file) {
  const agg = aggregate(sessions);
  fs.writeFileSync(file, JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    source: args.source,
    since: args.since,
    totalTokens: sessions.reduce((sum, s) => sum + s.tokens, 0),
    categories: agg.categories,
    tools: sortedEntries(agg.tools, 25),
    paths: sortedEntries(agg.paths, 25),
    recommendations: recommendations(sessions),
    sessions,
  }, null, 2));
}

function openUrl(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    childProcess.spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {}
}

function printSummary(sessions, args, file, url) {
  const total = sessions.reduce((sum, s) => sum + s.tokens, 0);
  console.log("Context X-Ray: analyzed " + sessions.length + " session(s), about " + fmtTokens(total) + " observed/estimated tokens.");
  if (url) console.log("Open: " + url);
  else console.log("Report: " + file);
  console.log("");
  for (const tip of recommendations(sessions).slice(0, 4)) console.log("- " + tip);
  const tools = sortedEntries(aggregate(sessions).tools, 5);
  if (tools.length) console.log("- Frequent tools: " + tools.map((entry) => entry[0] + " x" + entry[1]).join(", "));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return help();
  const sessions = collectSessions(args);
  mkdirp(OUT_DIR);
  const suffix = args.format === "json" ? "json" : "html";
  const file = args.out || path.join(OUT_DIR, "context-xray-" + new Date().toISOString().replace(/[:.]/g, "-") + "." + suffix);
  mkdirp(path.dirname(file));
  if (args.format === "json") writeJson(sessions, args, file);
  else fs.writeFileSync(file, renderHtml(sessions, args));
  const url = args.open && args.format === "html" ? pathToFileURL(file).href : "";
  if (url) openUrl(url);
  printSummary(sessions, args, file, url);
}

main();
`;

export const CONTEXT_XRAY_SKILL_MD = `---
name: context-xray
description: >-
  Visualize local Codex and Claude Code context usage, open an inline/browser
  report, flag warnings, and suggest prompt/tooling optimizations. Use when the
  user types /context-xray, asks where context is going, wants recent local
  coding-agent trends, or wants to improve context efficiency.
metadata:
  visibility: exported
---

# Context X-Ray

Use the locally installed Context X-Ray command to visualize recent Codex and
Claude Code context usage. It reads local transcript files only and does not
upload transcript content.

Project-scoped installs write only project \`.agents\` skill and command
artifacts; user-scoped installs write global Codex/Claude instructions.

## Run

Current or most recent local thread:

\`\`\`sh
~/.agent-native/context-xray/context-xray --open
\`\`\`

Thread picker / recent sessions:

\`\`\`sh
~/.agent-native/context-xray/context-xray threads --open
\`\`\`

Weekly trends:

\`\`\`sh
~/.agent-native/context-xray/context-xray trends --since 7d --open
\`\`\`

Exact session when the host exposes one:

\`\`\`sh
~/.agent-native/context-xray/context-xray --session-id "$CLAUDE_CODE_SESSION_ID" --open
\`\`\`

After running, report the link, the number of sessions analyzed, the largest
context buckets, and 3-5 specific optimizations.
\`--open\` opens the generated local HTML file directly and does not keep a
background report server running.

## Interpret

- Tool output heavy: use narrower commands, smaller file ranges, and summarized
  logs.
- Instructions heavy: move stable behavior into skills or AGENTS/CLAUDE files.
- Assistant prose heavy: ask for shorter status updates during long runs.
- One huge session: compact or start a follow-up thread with a handoff summary.
- Repeated path: pin a short file-role summary instead of rereading the file.
- Repeated tool: batch independent searches or delegate parallel inspection.
`;

export const CONTEXT_XRAY_COMMAND_MD = `---
description: Visualize local Codex/Claude context usage and get optimization tips.
argument-hint: [current|threads|trends|--since 7d]
---

Run Context X-Ray locally and show the user the generated report link plus the
top warnings.

Choose the command from the user's arguments:

- No arguments or \`current\`:
  \`~/.agent-native/context-xray/context-xray --open\`
- \`threads\`:
  \`~/.agent-native/context-xray/context-xray threads --open\`
- \`trends\`:
  \`~/.agent-native/context-xray/context-xray trends --since 7d --open\`

If \`$ARGUMENTS\` includes flags such as \`--since 24h\`, \`--last 20\`, or
\`--all-projects\`, pass them through to the command. If the host exposes
\`CLAUDE_CODE_SESSION_ID\`, prefer:

\`\`\`sh
~/.agent-native/context-xray/context-xray --session-id "$CLAUDE_CODE_SESSION_ID" --open
\`\`\`

\`--open\` opens a local HTML report file directly; there should not be a
long-running server process to monitor.

After the command finishes, summarize:

- the report link
- sessions analyzed
- the largest context bucket
- the most important warning
- two or three concrete ways to improve this thread
`;

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
}

function writeExecutable(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
  fs.chmodSync(file, 0o755);
}

function writeFile(file: string, content: string, written: string[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
  written.push(file);
}

function installProjectArtifacts(baseDir: string, written: string[]): void {
  writeFile(
    path.join(baseDir, ".agents", "skills", "context-xray", "SKILL.md"),
    CONTEXT_XRAY_SKILL_MD,
    written,
  );
  writeFile(
    path.join(baseDir, ".agents", "commands", "context-xray.md"),
    CONTEXT_XRAY_COMMAND_MD,
    written,
  );
}

export function installLocalContextXray(
  options: InstallLocalContextXrayOptions,
): InstallLocalContextXrayResult {
  const installDir = path.join(os.homedir(), ".agent-native", "context-xray");
  const scriptPath = path.join(installDir, "context-xray");
  const binPath = path.join(os.homedir(), ".local", "bin", "context-xray");
  const written: string[] = [];

  if (options.dryRun) {
    return {
      commands: ["context-xray --open"],
      scriptPath,
      written,
    };
  }

  writeExecutable(scriptPath, CONTEXT_XRAY_EXECUTABLE);
  written.push(scriptPath);
  if (process.platform === "win32") {
    const cmdPath = `${binPath}.cmd`;
    writeExecutable(
      cmdPath,
      `@echo off\r\nnode ${JSON.stringify(scriptPath)} %*\r\n`,
    );
    written.push(cmdPath);
  } else {
    writeExecutable(
      binPath,
      `#!/usr/bin/env sh\nexec ${JSON.stringify(scriptPath)} "$@"\n`,
    );
    written.push(binPath);
  }

  const clientSet = new Set(options.clients);
  const wantsCodex = clientSet.has("codex");
  const wantsClaude =
    clientSet.has("claude-code") || clientSet.has("claude-code-cli");

  if (options.scope === "project" && options.baseDir) {
    installProjectArtifacts(options.baseDir, written);
  } else if (wantsCodex) {
    writeFile(
      path.join(codexHome(), "skills", "context-xray", "SKILL.md"),
      CONTEXT_XRAY_SKILL_MD,
      written,
    );
    writeFile(
      path.join(codexHome(), "commands", "context-xray.md"),
      CONTEXT_XRAY_COMMAND_MD,
      written,
    );
  }

  if (options.scope !== "project" && wantsClaude) {
    writeFile(
      path.join(os.homedir(), ".claude", "skills", "context-xray", "SKILL.md"),
      CONTEXT_XRAY_SKILL_MD,
      written,
    );
    writeFile(
      path.join(os.homedir(), ".claude", "commands", "context-xray.md"),
      CONTEXT_XRAY_COMMAND_MD,
      written,
    );
  }

  return {
    commands: ["context-xray --open"],
    scriptPath,
    written,
  };
}
