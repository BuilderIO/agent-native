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
const MAX_EVENT_SAMPLES = 80;
const MAX_STEP_SAMPLES = 900;
const PRESSURE_WINDOW = 5;
const PRESSURE_TOKENS = 50000;

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

function eventPreview(text) {
  return cleanTitle(String(text || "")).slice(0, 240);
}

function inferMcpTool(toolName) {
  const value = String(toolName || "");
  if (value.startsWith("mcp__")) {
    const rest = value.slice(5);
    const split = rest.indexOf("__");
    if (split !== -1) return { server: rest.slice(0, split), tool: rest.slice(split + 2) };
    const dot = rest.indexOf(".");
    if (dot !== -1) return { server: rest.slice(0, dot), tool: rest.slice(dot + 1) };
  }
  if (value.startsWith("mcp_")) {
    const rest = value.slice(4);
    const split = rest.indexOf("_");
    if (split !== -1) return { server: rest.slice(0, split), tool: rest.slice(split + 1) };
  }
  return { server: "", tool: "" };
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

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cachedInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    turnsWithUsage: 0,
    peakTurnTokens: 0,
    peakTurnLabel: "",
    latestTurnTokens: 0,
    latestInputTokens: 0,
    series: [],
  };
}

function usageTotal(usage) {
  if (!usage) return 0;
  if (Number(usage.totalTokens)) return Number(usage.totalTokens) || 0;
  return (Number(usage.inputTokens) || 0) +
    (Number(usage.outputTokens) || 0) +
    (Number(usage.cacheCreationInputTokens) || 0) +
    (Number(usage.cacheReadInputTokens) || 0) +
    (Number(usage.reasoningOutputTokens) || 0);
}

function normalizedUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const usage = {
    inputTokens: Number(raw.input_tokens) || Number(raw.inputTokens) || 0,
    outputTokens: Number(raw.output_tokens) || Number(raw.outputTokens) || 0,
    cacheCreationInputTokens: Number(raw.cache_creation_input_tokens) || Number(raw.cacheCreationInputTokens) || 0,
    cacheReadInputTokens: Number(raw.cache_read_input_tokens) || Number(raw.cacheReadInputTokens) || Number(raw.cached_input_tokens) || Number(raw.cachedInputTokens) || 0,
    cachedInputTokens: Number(raw.cached_input_tokens) || Number(raw.cachedInputTokens) || 0,
    reasoningOutputTokens: Number(raw.reasoning_output_tokens) || Number(raw.reasoningOutputTokens) || 0,
    totalTokens: Number(raw.total_tokens) || Number(raw.totalTokens) || 0,
  };
  if (!usage.totalTokens) usage.totalTokens = usageTotal(usage);
  return usage.totalTokens || usage.inputTokens || usage.outputTokens || usage.cacheCreationInputTokens || usage.cacheReadInputTokens ? usage : null;
}

function codexUsageFromPayload(payload) {
  if (!payload || payload.type !== "token_count" || !payload.info) return null;
  return normalizedUsage(payload.info.last_token_usage || payload.info.total_token_usage);
}

function addUsage(summary, usage, timestamp, label) {
  if (!usage) return;
  const total = usageTotal(usage);
  summary.usage.inputTokens += usage.inputTokens || 0;
  summary.usage.outputTokens += usage.outputTokens || 0;
  summary.usage.cacheCreationInputTokens += usage.cacheCreationInputTokens || 0;
  summary.usage.cacheReadInputTokens += usage.cacheReadInputTokens || 0;
  summary.usage.cachedInputTokens += usage.cachedInputTokens || 0;
  summary.usage.reasoningOutputTokens += usage.reasoningOutputTokens || 0;
  summary.usage.totalTokens += total;
  summary.usage.turnsWithUsage += 1;
  summary.usage.latestTurnTokens = total;
  summary.usage.latestInputTokens = (usage.inputTokens || 0) + (usage.cacheCreationInputTokens || 0) + (usage.cacheReadInputTokens || 0);
  if (total > summary.usage.peakTurnTokens) {
    summary.usage.peakTurnTokens = total;
    summary.usage.peakTurnLabel = label || timestamp || "turn " + summary.usage.turnsWithUsage;
  }
  if (summary.usage.series.length < 260) {
    summary.usage.series.push({
      timestamp: String(timestamp || ""),
      label: label || "turn " + summary.usage.turnsWithUsage,
      totalTokens: total,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      cacheCreationInputTokens: usage.cacheCreationInputTokens || 0,
      cacheReadInputTokens: usage.cacheReadInputTokens || 0,
      cachedInputTokens: usage.cachedInputTokens || 0,
      reasoningOutputTokens: usage.reasoningOutputTokens || 0,
    });
  }
}

function sessionIdFromPath(file) {
  const match = path.basename(file).match(SESSION_ID_RE);
  return match ? match[0] : path.basename(file, ".jsonl");
}

function safeJson(value) {
  if (!value || typeof value !== "string") return null;
  const text = value.trim();
  if (!text || !/^[{[]/.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeToolInput(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    const parsed = safeJson(value);
    return parsed && typeof parsed === "object" ? parsed : { text: value };
  }
  if (typeof value === "object") return value;
  return { text: String(value) };
}

function codexToolInput(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (Object.prototype.hasOwnProperty.call(payload, "input")) return normalizeToolInput(payload.input);
  if (Object.prototype.hasOwnProperty.call(payload, "arguments")) return normalizeToolInput(payload.arguments);
  if (Object.prototype.hasOwnProperty.call(payload, "args")) return normalizeToolInput(payload.args);
  if (Object.prototype.hasOwnProperty.call(payload, "parameters")) return normalizeToolInput(payload.parameters);
  return {};
}

function firstStringField(input, keys) {
  if (!input || typeof input !== "object") return "";
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function shortCommand(command) {
  return cleanTitle(command).slice(0, 260);
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function normalizeCommand(command) {
  return stripAnsi(command)
    .replace(/\/Users\/[^\s"']+/g, "<abs-path>")
    .replace(/\/tmp\/[^\s"']+/g, "<tmp-path>")
    .replace(/:\d+(:\d+)?/g, ":<line>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,36}\b/gi, "<id>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260)
    .toLowerCase();
}

function toolFamily(toolName, input, inputText) {
  const name = String(toolName || "").toLowerCase();
  if (inferMcpTool(toolName).server) return "mcp";
  if (/(^|_|\.)(task|agent|subagent|spawn_agent|delegate)/.test(name)) return "agent";
  if (/(read|view|open_file|get_file|cat_file)/.test(name)) return "read";
  if (/(grep|glob|search|find|ripgrep|rg|list|ls)/.test(name)) return "search";
  if (/(edit|write|patch|apply_patch|replace|update_file|create_file|delete|rm)/.test(name)) return "write";
  if (/(bash|shell|exec|terminal|command|run)/.test(name)) return "execute";
  const text = String(inputText || "").toLowerCase();
  if (/^\s*(rg|grep|find|ls)\b/.test(text)) return "search";
  if (/^\s*(cat|sed|nl|head|tail)\b/.test(text)) return "read";
  if (/^\s*(python|node|pnpm|npm|yarn|bun|cargo|go|git|make|pytest|vitest)\b/.test(text)) return "execute";
  return "tool";
}

function toolTarget(toolName, input, inputText) {
  const direct = firstStringField(input, ["file_path", "filePath", "path", "filename", "relative_path", "target", "cwd"]);
  if (direct) return direct;
  const command = firstStringField(input, ["command", "cmd", "shell", "script"]);
  if (command) return shortCommand(command);
  const paths = pathCounts(inputText || "");
  const firstPath = Object.keys(paths)[0];
  if (firstPath) return firstPath;
  return shortCommand(inputText || toolName || "");
}

function toolCommand(toolName, input, inputText) {
  const command = firstStringField(input, ["command", "cmd", "shell", "script"]);
  if (command) return shortCommand(command);
  const name = String(toolName || "").toLowerCase();
  if (/(bash|shell|exec|terminal|command|run)/.test(name)) return shortCommand(inputText || "");
  return "";
}

function outputLooksError(value, text) {
  if (!value || typeof value !== "object") {
    return /\b(exit code|status|error)\s*[:=]?\s*[1-9]\b/i.test(text || "") || /\bfailed\b|\btraceback\b|\bexception\b/i.test(text || "");
  }
  if (value.is_error === true || value.error === true || value.success === false) return true;
  const code = Number(value.exit_code ?? value.exitCode ?? value.status ?? value.code);
  if (Number.isFinite(code) && code !== 0) return true;
  return /\b(exit code|status)\s*[:=]?\s*[1-9]\b/i.test(text || "") || /\btraceback\b|\bexception\b/i.test(text || "");
}

function initTraceFields(summary) {
  summary.usage = emptyUsage();
  summary.steps = [];
  summary.stepCount = 0;
  summary._callMap = {};
  summary._lastToolStep = null;
}

function recordToolStep(summary, options) {
  const input = normalizeToolInput(options.input);
  const inputText = textFrom(input, 0) || compact(input);
  const preview = eventPreview(inputText || options.preview || options.tool || "");
  const family = toolFamily(options.tool, input, inputText || preview);
  const command = toolCommand(options.tool, input, inputText || preview);
  const mcp = inferMcpTool(options.tool);
  const step = {
    index: summary.stepCount++,
    source: summary.source,
    sessionId: summary.sessionId,
    timestamp: String(options.timestamp || ""),
    type: "tool_call",
    tool: String(options.tool || "tool_call"),
    family,
    target: toolTarget(options.tool, input, inputText || preview),
    command,
    normalizedCommand: command ? normalizeCommand(command) : "",
    mcpServer: mcp.server,
    mcpTool: mcp.tool,
    tokens: estimateTokens((inputText || preview).length),
    preview,
    isError: false,
    errorPreview: "",
  };
  if (summary.steps.length < MAX_STEP_SAMPLES) summary.steps.push(step);
  for (const id of options.ids || []) {
    if (id) summary._callMap[String(id)] = step;
  }
  summary._lastToolStep = step;
  return step;
}

function markToolResult(summary, ids, isError, preview) {
  let step = null;
  for (const id of ids || []) {
    if (id && summary._callMap[String(id)]) {
      step = summary._callMap[String(id)];
      break;
    }
  }
  if (!step) step = summary._lastToolStep;
  if (!step) return;
  if (isError) {
    step.isError = true;
    step.errorPreview = eventPreview(preview || step.errorPreview || "");
  }
}

function contentBlocks(content) {
  if (Array.isArray(content)) return content;
  if (content == null) return [];
  return [content];
}

function classifyCodex(record) {
  const top = String(record.type || "");
  const payload = record.payload && typeof record.payload === "object" ? record.payload : {};
  const ptype = String(payload.type || "");
  let category = "other";
  const tools = {};
  let toolName = "";
  if (top === "session_meta") category = "metadata";
  else if (top === "turn_context") category = "instructions";
  else if (top === "event_msg") category = ptype === "user_message" ? "user" : "metadata";
  else if (top === "response_item") {
    if (["function_call", "custom_tool_call", "web_search_call", "tool_search_call", "tool_call"].includes(ptype) || payload.name && payload.call_id) {
      category = "tool_call";
      toolName = payload.name ? String(payload.name) : ptype || "tool_call";
      if (payload.name) addCounter(tools, String(payload.name), 1);
    } else if (["function_call_output", "custom_tool_call_output", "tool_search_output", "tool_result"].includes(ptype) || Object.prototype.hasOwnProperty.call(payload, "output")) {
      category = "tool_output";
      toolName = payload.name ? String(payload.name) : "tool output";
    }
    else if (ptype === "reasoning" || payload.summary) category = "reasoning";
    else if (payload.role === "assistant") category = "assistant";
    else if (payload.role === "user" || payload.role === "developer") category = "user";
  }
  const text = textFrom(record, 0) || (category === "metadata" ? compact(record) : "");
  return {
    category,
    chars: text.length,
    tools,
    paths: pathCounts(text),
    toolName,
    mcp: inferMcpTool(toolName),
    metadataType: top + (ptype ? ":" + ptype : ""),
    preview: eventPreview(text),
  };
}

function classifyClaude(record) {
  let category = "other";
  const tools = {};
  let toolName = "";
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
          toolName = part.name ? String(part.name) : "tool_use";
          if (part.name) addCounter(tools, String(part.name), 1);
        } else if (part.type === "tool_result") {
          category = "tool_output";
          toolName = "tool_result";
        }
        else if (part.type === "thinking") category = "reasoning";
      }
      parts.push(textFrom(part, 0));
    }
    text = parts.join("\n");
  } else if (record.toolUseResult) {
    category = "tool_output";
    toolName = "toolUseResult";
    text = textFrom(record.toolUseResult, 0);
  } else if (record.attachment) {
    category = "attachment";
    text = textFrom(record.attachment, 0);
  } else {
    text = textFrom(record, 0);
  }
  return {
    category,
    chars: text.length,
    tools,
    paths: pathCounts(text),
    toolName,
    mcp: inferMcpTool(toolName),
    metadataType: String(record.type || message && message.role || "record"),
    preview: eventPreview(text),
  };
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
    toolTokens: {},
    paths: {},
    metadata: {},
    mcpUsage: {},
    mcpTools: {},
    toolEvents: [],
    metadataEvents: [],
    observedTokens: 0,
    bytes: stat.size,
    mtime: stat.mtimeMs,
  };
  initTraceFields(summary);
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
    addUsage(summary, codexUsageFromPayload(payload), String(record.timestamp || payload.timestamp || ""), "turn " + (summary.usage.turnsWithUsage + 1));
    const stats = classifyCodex(record);
    addCounter(summary.categories, stats.category, stats.chars);
    mergeCounter(summary.tools, stats.tools);
    if (stats.toolName && stats.category === "tool_call") {
      recordToolStep(summary, {
        tool: stats.toolName,
        input: codexToolInput(payload),
        ids: [payload.call_id, payload.id],
        timestamp: record.timestamp || payload.timestamp,
        preview: stats.preview,
      });
      addCounter(summary.toolTokens, stats.toolName, estimateTokens(stats.chars));
      if (stats.mcp.server) {
        addCounter(summary.mcpUsage, stats.mcp.server, 1);
        addCounter(summary.mcpTools, stats.mcp.server + " / " + (stats.mcp.tool || stats.toolName), 1);
      }
      if (summary.toolEvents.length < MAX_EVENT_SAMPLES) {
        summary.toolEvents.push({
          source: "codex",
          sessionId: summary.sessionId,
          timestamp: String(record.timestamp || payload.timestamp || ""),
          category: stats.category,
          tool: stats.toolName,
          mcpServer: stats.mcp.server,
          mcpTool: stats.mcp.tool,
          tokens: estimateTokens(stats.chars),
          preview: stats.preview,
        });
      }
    }
    if (stats.category === "tool_output") {
      const text = textFrom(payload, 0);
      markToolResult(summary, [payload.call_id, payload.id], outputLooksError(payload, text), text);
    }
    if (stats.category === "metadata") {
      addCounter(summary.metadata, stats.metadataType, stats.chars);
      if (summary.metadataEvents.length < MAX_EVENT_SAMPLES) {
        summary.metadataEvents.push({
          source: "codex",
          sessionId: summary.sessionId,
          timestamp: String(record.timestamp || payload.timestamp || ""),
          type: stats.metadataType,
          tokens: estimateTokens(stats.chars),
          preview: stats.preview,
        });
      }
    }
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
    toolTokens: {},
    paths: {},
    metadata: {},
    mcpUsage: {},
    mcpTools: {},
    toolEvents: [],
    metadataEvents: [],
    observedTokens: 0,
    bytes: stat.size,
    mtime: stat.mtimeMs,
  };
  initTraceFields(summary);
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
      addUsage(summary, normalizedUsage(record.message.usage), String(record.timestamp || ""), "turn " + (summary.usage.turnsWithUsage + 1));
      if (!summary.title && record.message.role === "user") summary.title = cleanTitle(textFrom(record.message, 0)).slice(0, 90);
      for (const part of contentBlocks(record.message.content)) {
        if (!part || typeof part !== "object") continue;
        if (part.type === "tool_use") {
          recordToolStep(summary, {
            tool: part.name || "tool_use",
            input: part.input || {},
            ids: [part.id, record.uuid],
            timestamp: record.timestamp,
            preview: textFrom(part.input || part, 0),
          });
        } else if (part.type === "tool_result") {
          const text = textFrom(part, 0);
          markToolResult(summary, [part.tool_use_id, record.sourceToolAssistantUUID], part.is_error === true || outputLooksError(part, text), text);
        }
      }
    }
    if (record.toolUseResult) {
      const text = textFrom(record.toolUseResult, 0);
      markToolResult(summary, [record.toolUseID, record.toolUseId, record.sourceToolAssistantUUID], outputLooksError(record.toolUseResult, text), text);
    }
    const stats = classifyClaude(record);
    addCounter(summary.categories, stats.category, stats.chars);
    mergeCounter(summary.tools, stats.tools);
    if (stats.toolName && stats.category === "tool_call") {
      addCounter(summary.toolTokens, stats.toolName, estimateTokens(stats.chars));
      if (stats.mcp.server) {
        addCounter(summary.mcpUsage, stats.mcp.server, 1);
        addCounter(summary.mcpTools, stats.mcp.server + " / " + (stats.mcp.tool || stats.toolName), 1);
      }
      if (summary.toolEvents.length < MAX_EVENT_SAMPLES) {
        summary.toolEvents.push({
          source: "claude",
          sessionId: summary.sessionId,
          timestamp: String(record.timestamp || ""),
          category: stats.category,
          tool: stats.toolName,
          mcpServer: stats.mcp.server,
          mcpTool: stats.mcp.tool,
          tokens: estimateTokens(stats.chars),
          preview: stats.preview,
        });
      }
    }
    if (stats.category === "metadata") {
      addCounter(summary.metadata, stats.metadataType, stats.chars);
      if (summary.metadataEvents.length < MAX_EVENT_SAMPLES) {
        summary.metadataEvents.push({
          source: "claude",
          sessionId: summary.sessionId,
          timestamp: String(record.timestamp || ""),
          type: stats.metadataType,
          tokens: estimateTokens(stats.chars),
          preview: stats.preview,
        });
      }
    }
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
  summary.totalSteps = summary.stepCount || (summary.steps || []).length;
  delete summary._callMap;
  delete summary._lastToolStep;
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
  const out = { categories: {}, tools: {}, toolTokens: {}, paths: {}, metadata: {}, mcpUsage: {}, mcpTools: {}, toolEvents: [], metadataEvents: [], steps: [], usage: emptyUsage() };
  for (const session of sessions) {
    mergeCounter(out.categories, session.categories);
    mergeCounter(out.tools, session.tools);
    mergeCounter(out.toolTokens, session.toolTokens);
    mergeCounter(out.paths, session.paths);
    mergeCounter(out.metadata, session.metadata);
    mergeCounter(out.mcpUsage, session.mcpUsage);
    mergeCounter(out.mcpTools, session.mcpTools);
    out.usage.inputTokens += (session.usage && session.usage.inputTokens) || 0;
    out.usage.outputTokens += (session.usage && session.usage.outputTokens) || 0;
    out.usage.cacheCreationInputTokens += (session.usage && session.usage.cacheCreationInputTokens) || 0;
    out.usage.cacheReadInputTokens += (session.usage && session.usage.cacheReadInputTokens) || 0;
    out.usage.cachedInputTokens += (session.usage && session.usage.cachedInputTokens) || 0;
    out.usage.reasoningOutputTokens += (session.usage && session.usage.reasoningOutputTokens) || 0;
    out.usage.totalTokens += (session.usage && session.usage.totalTokens) || 0;
    out.usage.turnsWithUsage += (session.usage && session.usage.turnsWithUsage) || 0;
    if (session.usage && session.usage.peakTurnTokens > out.usage.peakTurnTokens) {
      out.usage.peakTurnTokens = session.usage.peakTurnTokens;
      out.usage.peakTurnLabel = (session.title || session.sessionId) + " · " + session.usage.peakTurnLabel;
    }
    for (const step of session.steps || []) {
      if (out.steps.length < 2000) out.steps.push(Object.assign({ sessionTitle: session.title, cwd: session.cwd, sessionPath: session.path }, step));
    }
    for (const event of session.toolEvents || []) {
      if (out.toolEvents.length < 500) out.toolEvents.push(Object.assign({ sessionTitle: session.title, cwd: session.cwd, sessionPath: session.path }, event));
    }
    for (const event of session.metadataEvents || []) {
      if (out.metadataEvents.length < 500) out.metadataEvents.push(Object.assign({ sessionTitle: session.title, cwd: session.cwd, sessionPath: session.path }, event));
    }
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
  if (toolOutput > 45) tips.push("Tool output dominates context. In your prompt, ask the agent to keep command output capped, summarize failures, and only expand logs when the exact lines matter.");
  if (instructions > 25) tips.push("Instructions are a large share. Move durable workflow preferences into a skill, AGENTS.md, or CLAUDE.md so each thread can start with a shorter task prompt.");
  if (assistant > 45) tips.push("Assistant prose is heavy. Ask for brief progress updates and a final decision log, instead of detailed narration during every loop.");
  if (maxSession.tokens > 80000) tips.push("The largest session is about " + fmtTokens(maxSession.tokens) + " " + maxSession.tokenMethod + " tokens. Ask for a handoff summary, then continue in a fresh thread before the next large implementation pass.");
  const topTool = sortedEntries(agg.tools, 1)[0];
  if (topTool && topTool[1] > 20) tips.push(topTool[0] + " appears " + topTool[1] + " times. Tell the agent to batch independent inspection and avoid rerunning diagnostics unless state changed.");
  const topPath = sortedEntries(agg.paths, 1)[0];
  if (topPath && topPath[1] > 12) tips.push(topPath[0] + " appears repeatedly (" + topPath[1] + " mentions). Ask the agent to keep a short file-role summary and reopen the file only when it needs exact lines.");
  return tips.length ? tips.slice(0, 6) : ["Recent sessions look balanced. Keep giving scoped tasks, ask for compaction after milestones, and preserve reusable decisions in a skill or repo doc."];
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

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.origin + url.pathname;
  } catch {
    return String(value || "").split(/[?#]/)[0].slice(0, 120);
  }
}

function mcpTarget(definition) {
  if (!definition || typeof definition !== "object") return "configured";
  if (definition.url) return safeUrl(definition.url);
  if (definition.command) return String(definition.command);
  if (definition.transport) return String(definition.transport);
  return "configured";
}

function addMcpServer(out, name, source, definition) {
  if (!name) return;
  const key = source + ":" + name;
  if (out.some((server) => server.key === key)) return;
  out.push({
    key,
    name: String(name),
    source,
    target: mcpTarget(definition),
  });
}

function readMcpJson(file, source, out) {
  const json = readJsonFile(file);
  if (!json || typeof json !== "object") return;
  const servers = json.mcpServers || json.mcp_servers || json.servers;
  if (!servers || typeof servers !== "object") return;
  for (const name of Object.keys(servers)) addMcpServer(out, name, source, servers[name]);
}

function readCodexTomlServers(file, out) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^\s*\[mcp_servers\.(?:"([^"]+)"|([^\]]+))\]\s*$/);
    if (!match) continue;
    const name = match[1] || match[2] || "";
    const section = {};
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      if (/^\s*\[/.test(lines[cursor])) break;
      const pair = lines[cursor].match(/^\s*([A-Za-z0-9_-]+)\s*=\s*"?([^"]+)"?\s*$/);
      if (pair) section[pair[1]] = pair[2];
    }
    addMcpServer(out, name, "Codex config", section);
  }
}

function readMcpServers(project) {
  const out = [];
  readCodexTomlServers(path.join(CODEX_DIR, "config.toml"), out);
  readMcpJson(path.join(HOME, ".claude.json"), "Claude user config", out);
  readMcpJson(path.join(CLAUDE_DIR, "settings.json"), "Claude settings", out);
  readMcpJson(path.join(path.resolve(project), ".mcp.json"), "Project .mcp.json", out);
  readMcpJson(path.join(path.resolve(project), ".cursor", "mcp.json"), "Project Cursor MCP", out);
  readMcpJson(path.join(HOME, ".cowork", "mcp.json"), "Cowork MCP", out);
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}

function sourceCounts(sessions) {
  return sessions.reduce((counts, session) => {
    counts[session.source] = (counts[session.source] || 0) + 1;
    return counts;
  }, {});
}

function buildReport(sessions, args) {
  const agg = aggregate(sessions);
  return {
    generatedAt: new Date().toISOString(),
    generatedLabel: new Date().toLocaleString(),
    mode: args.mode,
    source: args.source,
    since: args.since,
    project: path.resolve(args.project),
    sessionCount: sessions.length,
    sourceCounts: sourceCounts(sessions),
    totalTokens: sessions.reduce((sum, s) => sum + s.tokens, 0),
    categories: agg.categories,
    tools: sortedEntries(agg.tools, 50),
    toolTokens: sortedEntries(agg.toolTokens, 50),
    paths: sortedEntries(agg.paths, 50),
    metadata: sortedEntries(agg.metadata, 50),
    mcpUsage: sortedEntries(agg.mcpUsage, 50),
    mcpTools: sortedEntries(agg.mcpTools, 50),
    mcpServers: readMcpServers(args.project),
    recommendations: recommendations(sessions),
    toolEvents: agg.toolEvents,
    metadataEvents: agg.metadataEvents,
    sessions,
  };
}

function jsonScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function overviewEnhancementScript() {
  return "(" + function () {
    const dataEl = document.getElementById("xray-data");
    if (!dataEl) return;
    const report = JSON.parse(dataEl.textContent || "{}");
    const cats = ["user", "assistant", "tool_call", "tool_output", "reasoning", "instructions", "attachment", "metadata", "other"];
    const labels = {
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
    const colors = {
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

    function esc(value) {
      return String(value || "").replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch];
      });
    }

    function fmt(value) {
      const number = Number(value) || 0;
      if (number >= 1000000) return (number / 1000000).toFixed(1) + "m";
      if (number >= 1000) return (number / 1000).toFixed(1) + "k";
      return String(number);
    }

    function tok(chars) {
      chars = Number(chars) || 0;
      return chars > 0 ? Math.max(1, Math.ceil(chars / 4)) : 0;
    }

    function totalCounter(counter) {
      return Object.keys(counter || {}).reduce(function (sum, key) {
        return sum + (Number(counter[key]) || 0);
      }, 0);
    }

    function pct(part, total) {
      return total > 0 ? Math.max(0, Math.min(100, (part / total) * 100)) : 0;
    }

    function actionRow(kind, value, title, subtitle, right, farRight, color) {
      return "<button class=\"row-button\" data-overview-kind=\"" + esc(kind) + "\" data-overview-value=\"" + esc(value) + "\"><span><span class=\"row-title\">" + (color ? "<span class=\"badge\"><span class=\"dot\" style=\"background:" + esc(color) + "\"></span>" + esc(title) + "</span>" : esc(title)) + "</span><span class=\"meta\">" + esc(subtitle) + "</span></span><span class=\"row-meta\">" + esc(right) + "</span><span class=\"row-meta\">" + esc(farRight || "") + "</span></button>";
    }

    function bar(counter) {
      const total = totalCounter(counter);
      if (!total) return "<div class=\"bar\"></div>";
      return "<div class=\"bar\">" + cats.map(function (cat) {
        const value = (counter || {})[cat] || 0;
        if (!value) return "";
        return "<button type=\"button\" data-overview-kind=\"category\" data-overview-value=\"" + esc(cat) + "\" title=\"" + esc(labels[cat]) + "\" style=\"width:" + Math.max(1, pct(value, total)).toFixed(2) + "%;background:" + colors[cat] + ";border:0;padding:0;display:block;min-width:2px;cursor:pointer\"></button>";
      }).join("") + "</div>";
    }

    function topTools(limit) {
      return (report.tools || []).slice(0, limit || 8);
    }

    function toolTokens(name) {
      const found = (report.toolTokens || []).filter(function (entry) {
        return entry[0] === name;
      })[0];
      return found ? found[1] : 0;
    }

    function sessionMatches(kind, value) {
      return (report.sessions || []).filter(function (session) {
        if (kind === "category") return !!((session.categories || {})[value]);
        if (kind === "path") return !!((session.paths || {})[value]);
        return false;
      }).sort(function (a, b) {
        const left = kind === "path" ? (a.paths || {})[value] || 0 : (a.categories || {})[value] || 0;
        const right = kind === "path" ? (b.paths || {})[value] || 0 : (b.categories || {})[value] || 0;
        return right - left;
      });
    }

    function sampleCards(events) {
      events = (events || []).slice(0, 8);
      if (!events.length) return "<p class=\"empty\">No sampled records for this item.</p>";
      return "<div class=\"detail-list\">" + events.map(function (event) {
        return "<article class=\"sample\"><div class=\"sample-top\"><span>" + esc(event.source) + " · " + esc(event.sessionTitle || event.sessionId) + "</span><span>" + fmt(event.tokens || 0) + " tok</span></div><p>" + esc(event.preview || "No preview captured.") + "</p></article>";
      }).join("") + "</div>";
    }

    function sessionCards(sessions, kind, value) {
      sessions = (sessions || []).slice(0, 8);
      if (!sessions.length) return "<p class=\"empty\">No matching sessions for this item.</p>";
      return "<div class=\"detail-list\">" + sessions.map(function (session) {
        const amount = kind === "path" ? (session.paths || {})[value] || 0 : tok((session.categories || {})[value] || 0);
        const unit = kind === "path" ? "mentions" : "tok";
        return "<article class=\"sample\"><div class=\"sample-top\"><span>" + esc(session.source) + " · " + esc(session.updatedAt || "unknown time") + "</span><span>" + esc(fmt(amount) + " " + unit) + "</span></div><p><strong>" + esc(session.title || session.sessionId) + "</strong></p><p class=\"meta\">" + esc(session.cwd || session.path) + "</p></article>";
      }).join("") + "</div>";
    }

    function openDetailTab(tab, selector, value) {
      const tabButton = document.querySelector("[data-tab=\"" + tab + "\"]");
      if (tabButton) tabButton.click();
      if (!selector) return;
      window.setTimeout(function () {
        const rows = Array.prototype.slice.call(document.querySelectorAll(selector));
        const row = rows.filter(function (item) {
          return item.getAttribute(selector.slice(1, -1)) === value;
        })[0];
        if (row) row.click();
      }, 0);
    }

    function jumpButton(tab, label, selector, value) {
      return "<button class=\"row-button\" data-overview-jump=\"" + esc(tab) + "\" data-overview-selector=\"" + esc(selector) + "\" data-overview-value=\"" + esc(value || "") + "\"><span><span class=\"row-title\">" + esc(label) + "</span><span class=\"meta\">Open the full detail tab</span></span><span class=\"row-meta\">open</span><span class=\"row-meta\"></span></button>";
    }

    function setDetail(kind, value) {
      const el = document.getElementById("overview-drilldown");
      if (!el) return;
      if (kind === "tool") {
        const events = (report.toolEvents || []).filter(function (event) {
          return event.tool === value;
        });
        el.innerHTML = "<div class=\"section-head\"><div><h2>" + esc(value) + "</h2><p class=\"meta\">Sampled calls from the selected sessions.</p></div></div>" + sampleCards(events) + "<div class=\"mini-label\">More</div>" + jumpButton("tools", "Open Tool Calls", "[data-tool]", value);
      } else if (kind === "metadata") {
        const events = (report.metadataEvents || []).filter(function (event) {
          return event.type === value;
        });
        el.innerHTML = "<div class=\"section-head\"><div><h2>" + esc(value) + "</h2><p class=\"meta\">Sampled metadata records from transcripts.</p></div></div>" + sampleCards(events) + "<div class=\"mini-label\">More</div>" + jumpButton("metadata", "Open Metadata", "[data-meta]", value);
      } else if (kind === "path") {
        el.innerHTML = "<div class=\"section-head\"><div><h2>" + esc(value) + "</h2><p class=\"meta\">Sessions where this path repeats.</p></div></div>" + sessionCards(sessionMatches("path", value), "path", value) + "<div class=\"mini-label\">More</div>" + jumpButton("sessions", "Open Sessions", "", "");
      } else {
        const chars = (report.categories || {})[value] || 0;
        const sessions = sessionMatches("category", value);
        let extra = "";
        if (value === "tool_call") {
          extra = "<div class=\"mini-label\">Top tools</div>" + topTools(6).map(function (entry) {
            return actionRow("tool", entry[0], entry[0], "Click for sampled calls", "x" + entry[1], fmt(toolTokens(entry[0])) + " tok");
          }).join("");
        } else if (value === "metadata") {
          extra = "<div class=\"mini-label\">Metadata types</div>" + (report.metadata || []).slice(0, 6).map(function (entry) {
            return actionRow("metadata", entry[0], entry[0], "Click for sampled records", fmt(tok(entry[1])) + " tok", fmt(entry[1]) + " ch");
          }).join("");
        }
        el.innerHTML = "<div class=\"section-head\"><div><h2>" + esc(labels[value] || value) + "</h2><p class=\"meta\">" + esc(fmt(tok(chars)) + " estimated tokens across " + sessions.length + " session(s).") + "</p></div></div>" + (extra || sessionCards(sessions, "category", value));
      }
      bindOverview();
    }

    function bindOverview() {
      Array.prototype.forEach.call(document.querySelectorAll("[data-overview-kind]"), function (button) {
        button.onclick = function () {
          setDetail(button.getAttribute("data-overview-kind"), button.getAttribute("data-overview-value"));
        };
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-overview-jump]"), function (button) {
        button.onclick = function () {
          const selector = button.getAttribute("data-overview-selector");
          const value = button.getAttribute("data-overview-value");
          openDetailTab(button.getAttribute("data-overview-jump"), selector, value);
        };
      });
    }

    function renderOverview() {
      const panel = document.getElementById("panel-overview");
      if (!panel) return;
      const total = totalCounter(report.categories);
      const categoryRows = cats.map(function (cat) {
        const chars = (report.categories || {})[cat] || 0;
        if (!chars) return "";
        return actionRow("category", cat, labels[cat], "Click for sessions and hotspots", fmt(tok(chars)) + " tok", pct(chars, total).toFixed(0) + "%", colors[cat]);
      }).join("");
      const toolRows = topTools(8).map(function (entry) {
        return actionRow("tool", entry[0], entry[0], "Click for sampled calls", "x" + entry[1], fmt(toolTokens(entry[0])) + " tok");
      }).join("") || "<p class=\"empty\">No tool calls detected.</p>";
      const pathRows = (report.paths || []).slice(0, 8).map(function (entry) {
        return actionRow("path", entry[0], entry[0], "Click for matching sessions", "x" + entry[1], "");
      }).join("") || "<p class=\"empty\">No repeated paths detected.</p>";
      const metadataRows = (report.metadata || []).slice(0, 8).map(function (entry) {
        return actionRow("metadata", entry[0], entry[0], "Click for sampled records", fmt(tok(entry[1])) + " tok", fmt(entry[1]) + " ch");
      }).join("") || "<p class=\"empty\">No metadata-heavy records detected.</p>";
      panel.innerHTML = "<div class=\"grid\"><section class=\"card\"><div class=\"section-head\"><div><h2>Where The Context Is Going</h2><p class=\"meta\">Click a segment or row to inspect it.</p></div></div>" + bar(report.categories) + "<div>" + categoryRows + "</div></section><section class=\"card\" id=\"overview-drilldown\"><div class=\"section-head\"><div><h2>Warnings And Optimizations</h2><p class=\"meta\">Promptable changes you control.</p></div></div><ol class=\"tips\">" + (report.recommendations || []).map(function (tip) { return "<li>" + esc(tip) + "</li>"; }).join("") + "</ol></section></div><div class=\"grid equal\" style=\"margin-top:14px\"><section class=\"card\"><h2>Tool Hotspots</h2>" + toolRows + "</section><section class=\"card\"><h2>Top Paths</h2>" + pathRows + "</section></div><section class=\"card\" style=\"margin-top:14px\"><h2>Metadata Types</h2>" + metadataRows + "</section>";
      bindOverview();
    }

    renderOverview();
  }.toString() + ")();";
}

function renderHtml(sessions, args) {
  const report = buildReport(sessions, args);
  return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Context X-Ray</title><style>" +
    "@import url(\"https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap\");" +
    ":root{--background:0 0% 100%;--foreground:220 10% 10%;--card:0 0% 100%;--muted:220 10% 95%;--muted-foreground:220 5% 45%;--accent:220 10% 92%;--border:220 10% 90%;--ring:220 10% 55%;--destructive:0 84% 60%;--radius:.5rem;--shadow:0 1px 2px rgba(16,24,40,.06);}" +
    "@media(prefers-color-scheme:dark){:root{--background:220 10% 7%;--foreground:220 8% 92%;--card:220 9% 9%;--muted:220 8% 15%;--muted-foreground:220 6% 64%;--accent:220 8% 17%;--border:220 8% 18%;--ring:220 8% 54%;--destructive:0 72% 51%;--shadow:none;}}" +
    "*{box-sizing:border-box}html{background:hsl(var(--background))}body{margin:0;background:hsl(var(--background));color:hsl(var(--foreground));font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;font-feature-settings:\"cv02\",\"cv03\",\"cv04\",\"cv11\";line-height:1.45}button{font:inherit;color:inherit}main{max-width:1180px;margin:0 auto;padding:20px 18px 44px}.topbar{border-bottom:1px solid hsl(var(--border));background:hsl(var(--background));position:sticky;top:0;z-index:10}.topbar-inner{max-width:1180px;margin:0 auto;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px}.title-row{display:flex;align-items:center;gap:9px}.logo-dot{width:10px;height:10px;border-radius:999px;background:#38bdf8;box-shadow:0 0 0 4px rgba(56,189,248,.12)}h1{font-size:20px;line-height:1.1;margin:0;font-weight:650;letter-spacing:0}h2{font-size:15px;line-height:1.2;margin:0;font-weight:650}h3{font-size:14px;line-height:1.3;margin:0;font-weight:600}p{margin:0}.muted,.eyebrow,.meta,.empty{color:hsl(var(--muted-foreground))}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:650}.meta{font-size:12px}.tabs{display:inline-flex;align-items:center;gap:2px;border:1px solid hsl(var(--border));background:hsl(var(--muted)/.35);border-radius:8px;padding:2px}.tab{border:0;background:transparent;border-radius:6px;padding:6px 10px;font-size:12px;line-height:1.1;cursor:pointer}.tab:hover{background:hsl(var(--accent)/.5)}.tab.active{background:hsl(var(--background));box-shadow:var(--shadow)}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0}.card{background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:8px;padding:14px;box-shadow:var(--shadow)}.stat-value{display:block;font-size:28px;line-height:1.1;font-weight:700;margin-top:6px}.panel{display:none}.panel.active{display:block}.grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.8fr);gap:14px;align-items:start}.grid.equal{grid-template-columns:repeat(2,minmax(0,1fr))}.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}.bar{display:flex;overflow:hidden;height:10px;border-radius:999px;background:hsl(var(--muted));margin:10px 0 12px}.bar span{display:block;min-width:2px}.table{width:100%;border-collapse:collapse;font-size:12px}.table th{text-align:left;color:hsl(var(--muted-foreground));font-weight:600;border-bottom:1px solid hsl(var(--border));padding:7px 8px}.table td{border-bottom:1px solid hsl(var(--border));padding:8px;vertical-align:top}.table th:last-child,.table td:last-child{text-align:right}.row-button{width:100%;display:grid;grid-template-columns:minmax(0,1fr) 74px 70px;gap:10px;align-items:center;text-align:left;border:1px solid transparent;background:transparent;border-radius:6px;padding:8px;cursor:pointer}.row-button:hover,.row-button.active{border-color:hsl(var(--border));background:hsl(var(--accent)/.35)}.row-title{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row-meta{font-size:12px;color:hsl(var(--muted-foreground));text-align:right}.badge-list{display:flex;flex-wrap:wrap;gap:6px}.badge{display:inline-flex;align-items:center;gap:5px;border:1px solid hsl(var(--border));border-radius:999px;padding:3px 7px;font-size:11px;background:hsl(var(--background));max-width:100%}.badge .dot{width:7px;height:7px;border-radius:999px;flex:0 0 auto}.tips{margin:0;padding-left:20px}.tips li{margin:0 0 8px}.detail{min-height:228px}.detail-list{display:grid;gap:8px;margin-top:10px}.sample{border:1px solid hsl(var(--border));border-radius:8px;padding:10px;background:hsl(var(--muted)/.22)}.sample-top{display:flex;justify-content:space-between;gap:10px;margin-bottom:5px;font-size:11px;color:hsl(var(--muted-foreground))}.sample p{font-size:12px;color:hsl(var(--foreground));overflow-wrap:anywhere}.session-card{border:1px solid hsl(var(--border));border-radius:8px;background:hsl(var(--card));margin-bottom:10px;overflow:hidden}.session-card summary{list-style:none;display:flex;justify-content:space-between;gap:14px;cursor:pointer;padding:13px 14px}.session-card summary::-webkit-details-marker{display:none}.session-body{border-top:1px solid hsl(var(--border));padding:12px 14px}.session-title{font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.session-path{font-size:12px;color:hsl(var(--muted-foreground));margin-top:3px;overflow-wrap:anywhere}.token-big{font-size:20px;font-weight:700;white-space:nowrap}.mini-label{margin:10px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:650;color:hsl(var(--muted-foreground))}.footer{margin-top:20px;color:hsl(var(--muted-foreground));font-size:12px}.hidden{display:none!important}@media(max-width:840px){.topbar-inner{align-items:flex-start;flex-direction:column}.stats,.grid,.grid.equal{grid-template-columns:1fr}.tabs{width:100%;overflow:auto}.tab{white-space:nowrap}.row-button{grid-template-columns:minmax(0,1fr) 64px 58px}.session-card summary{align-items:flex-start;flex-direction:column}}" +
    "</style></head><body><header class=\"topbar\"><div class=\"topbar-inner\"><div><div class=\"title-row\"><span class=\"logo-dot\"></span><h1>Context X-Ray</h1></div><p class=\"meta\">Generated " + escapeHtml(report.generatedLabel) + " · mode=" + escapeHtml(report.mode) + " · source=" + escapeHtml(report.source) + " · since=" + escapeHtml(report.since) + "</p></div><nav class=\"tabs\" aria-label=\"Report views\"><button class=\"tab active\" data-tab=\"overview\">Overview</button><button class=\"tab\" data-tab=\"tools\">Tool Calls</button><button class=\"tab\" data-tab=\"mcp\">MCP</button><button class=\"tab\" data-tab=\"metadata\">Metadata</button><button class=\"tab\" data-tab=\"sessions\">Sessions</button></nav></div></header><main><section class=\"stats\" id=\"stats\"></section><section class=\"panel active\" id=\"panel-overview\"></section><section class=\"panel\" id=\"panel-tools\"></section><section class=\"panel\" id=\"panel-mcp\"></section><section class=\"panel\" id=\"panel-metadata\"></section><section class=\"panel\" id=\"panel-sessions\"></section><p class=\"footer\">Reads local transcript and MCP config files only. No transcript content is uploaded.</p></main><script type=\"application/json\" id=\"xray-data\">" + jsonScript(report) + "</script><script>" +
    "(function(){var report=JSON.parse(document.getElementById('xray-data').textContent);var cats=['user','assistant','tool_call','tool_output','reasoning','instructions','attachment','metadata','other'];var labels={user:'User asks',assistant:'Assistant text',tool_call:'Tool calls',tool_output:'Tool output',reasoning:'Reasoning',instructions:'Instructions/context',attachment:'Attachments',metadata:'Metadata',other:'Other'};var colors={user:'#8ba8ff',assistant:'#55b982',tool_call:'#f0a85b',tool_output:'#e06b73',reasoning:'#a77be8',instructions:'#6ac3d5',attachment:'#d6a85a',metadata:'#9aa3ad',other:'#c3c8ce'};function esc(v){return String(v||'').replace(/[&<>\"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[ch];});}function fmt(n){n=Number(n)||0;if(n>=1000000)return(n/1000000).toFixed(1)+'m';if(n>=1000)return(n/1000).toFixed(1)+'k';return String(n);}function tok(chars){chars=Number(chars)||0;return chars>0?Math.max(1,Math.ceil(chars/4)):0;}function pc(part,total){return total>0?Math.max(0,Math.min(100,(part/total)*100)):0;}function totalCounter(counter){return Object.keys(counter||{}).reduce(function(sum,key){return sum+(Number(counter[key])||0);},0);}function bar(counter){var total=totalCounter(counter);if(!total)return'<div class=\"bar\"></div>';return'<div class=\"bar\">'+cats.map(function(cat){var value=counter[cat]||0;if(!value)return'';return'<span title=\"'+esc(labels[cat])+'\" style=\"width:'+Math.max(1,pc(value,total)).toFixed(2)+'%;background:'+colors[cat]+'\"></span>';}).join('')+'</div>';}function metric(label,value){return'<article class=\"card\"><div class=\"eyebrow\">'+esc(label)+'</div><span class=\"stat-value\">'+esc(value)+'</span></article>';}function tableRows(entries,kind){if(!entries||!entries.length)return'<tr><td>None detected</td><td></td></tr>';return entries.map(function(entry){var value=entry[1];var shown=kind==='chars'?fmt(tok(value)):(kind==='tokens'?fmt(value):String(value));return'<tr><td>'+esc(entry[0])+'</td><td>'+esc(shown)+'</td></tr>';}).join('');}function toolToken(name){var found=(report.toolTokens||[]).filter(function(entry){return entry[0]===name;})[0];return found?found[1]:0;}function renderStats(){var counts=report.sourceCounts||{};document.getElementById('stats').innerHTML=metric('Sessions',report.sessionCount)+metric('Observed/estimated tokens',fmt(report.totalTokens))+metric('Codex',counts.codex||0)+metric('Claude',counts.claude||0);}function renderOverview(){var categoryTotal=totalCounter(report.categories);var categoryRows=cats.map(function(cat){var chars=(report.categories||{})[cat]||0;if(!chars)return'';return'<tr><td><span class=\"badge\"><span class=\"dot\" style=\"background:'+colors[cat]+'\"></span>'+esc(labels[cat])+'</span></td><td>'+fmt(tok(chars))+'</td><td>'+pc(chars,categoryTotal).toFixed(0)+'%</td></tr>';}).join('');document.getElementById('panel-overview').innerHTML='<div class=\"grid\"><section class=\"card\"><div class=\"section-head\"><div><h2>Where The Context Is Going</h2><p class=\"meta\">Approximate contribution by transcript bucket.</p></div></div>'+bar(report.categories)+'<table class=\"table\"><tbody>'+categoryRows+'</tbody></table></section><section class=\"card\"><div class=\"section-head\"><div><h2>Warnings And Optimizations</h2><p class=\"meta\">Promptable changes you control.</p></div></div><ol class=\"tips\">'+(report.recommendations||[]).map(function(tip){return'<li>'+esc(tip)+'</li>';}).join('')+'</ol></section></div><div class=\"grid equal\" style=\"margin-top:14px\"><section class=\"card\"><h2>Top Paths</h2><table class=\"table\"><tbody>'+tableRows(report.paths,'count')+'</tbody></table></section><section class=\"card\"><h2>Metadata Types</h2><table class=\"table\"><tbody>'+tableRows(report.metadata,'chars')+'</tbody></table></section></div>';}function renderTools(){var rows=(report.tools||[]).map(function(entry,index){var name=entry[0];var count=entry[1];return'<button class=\"row-button'+(index===0?' active':'')+'\" data-tool=\"'+esc(name)+'\"><span><span class=\"row-title\">'+esc(name)+'</span><span class=\"meta\">Click to inspect sampled calls</span></span><span class=\"row-meta\">x'+count+'</span><span class=\"row-meta\">'+fmt(toolToken(name))+' tok</span></button>';}).join('')||'<div class=\"empty\">No tool calls detected in these sessions.</div>';document.getElementById('panel-tools').innerHTML='<div class=\"grid\"><section class=\"card\"><div class=\"section-head\"><div><h2>Tool Calls</h2><p class=\"meta\">Calls are clickable; samples are capped so the report stays light.</p></div></div><div>'+rows+'</div></section><aside class=\"card detail\" id=\"tool-detail\"></aside></div>';Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'),function(btn){btn.addEventListener('click',function(){Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'),function(item){item.classList.remove('active');});btn.classList.add('active');renderToolDetail(btn.getAttribute('data-tool'));});});if((report.tools||[]).length)renderToolDetail(report.tools[0][0]);else document.getElementById('tool-detail').innerHTML='<h2>Tool Detail</h2><p class=\"empty\">Nothing to inspect yet.</p>';}function renderToolDetail(name){var events=(report.toolEvents||[]).filter(function(event){return event.tool===name;}).slice(0,30);document.getElementById('tool-detail').innerHTML='<div class=\"section-head\"><div><h2>'+esc(name)+'</h2><p class=\"meta\">'+events.length+' sampled call'+(events.length===1?'':'s')+'</p></div></div><div class=\"detail-list\">'+(events.map(function(event){return'<article class=\"sample\"><div class=\"sample-top\"><span>'+esc(event.source)+' · '+esc(event.sessionTitle||event.sessionId)+'</span><span>'+fmt(event.tokens||0)+' tok</span></div><p>'+esc(event.preview||'No preview captured.')+'</p></article>';}).join('')||'<p class=\"empty\">No sampled call payloads for this tool.</p>')+'</div>';}function renderMcp(){var servers=report.mcpServers||[];var usage=report.mcpUsage||[];var configured=servers.map(function(server){return'<button class=\"row-button\" data-mcp=\"'+esc(server.name)+'\"><span><span class=\"row-title\">'+esc(server.name)+'</span><span class=\"meta\">'+esc(server.source)+' · '+esc(server.target)+'</span></span><span class=\"row-meta\">config</span><span class=\"row-meta\"></span></button>';}).join('')||'<div class=\"empty\">No MCP server config found in the common local config files.</div>';var detected=usage.map(function(entry,index){return'<button class=\"row-button'+(!servers.length&&index===0?' active':'')+'\" data-mcp=\"'+esc(entry[0])+'\"><span><span class=\"row-title\">'+esc(entry[0])+'</span><span class=\"meta\">Detected from mcp__server__tool style names</span></span><span class=\"row-meta\">x'+entry[1]+'</span><span class=\"row-meta\"></span></button>';}).join('')||'<div class=\"empty\">No MCP-prefixed tool calls detected in the selected sessions.</div>';document.getElementById('panel-mcp').innerHTML='<div class=\"grid\"><section class=\"card\"><div class=\"section-head\"><div><h2>MCP Servers</h2><p class=\"meta\">Configured locally plus inferred calls from transcripts.</p></div></div><div class=\"mini-label\">Configured</div>'+configured+'<div class=\"mini-label\">Detected usage</div>'+detected+'</section><aside class=\"card detail\" id=\"mcp-detail\"></aside></div>';Array.prototype.forEach.call(document.querySelectorAll('[data-mcp]'),function(btn){btn.addEventListener('click',function(){Array.prototype.forEach.call(document.querySelectorAll('[data-mcp]'),function(item){item.classList.remove('active');});btn.classList.add('active');renderMcpDetail(btn.getAttribute('data-mcp'));});});if(usage.length)renderMcpDetail(usage[0][0]);else if(servers.length)renderMcpDetail(servers[0].name);else document.getElementById('mcp-detail').innerHTML='<h2>MCP Detail</h2><p class=\"empty\">Install or run sessions with MCP tools to see usage here.</p>';}function renderMcpDetail(name){var server=(report.mcpServers||[]).filter(function(item){return item.name===name;})[0];var tools=(report.mcpTools||[]).filter(function(entry){return entry[0].indexOf(name+' / ')===0;});var events=(report.toolEvents||[]).filter(function(event){return event.mcpServer===name;}).slice(0,25);document.getElementById('mcp-detail').innerHTML='<div class=\"section-head\"><div><h2>'+esc(name)+'</h2><p class=\"meta\">'+(server?esc(server.source+' · '+server.target):'Detected from tool call names')+'</p></div></div><div class=\"mini-label\">Tools</div><table class=\"table\"><tbody>'+tableRows(tools,'count')+'</tbody></table><div class=\"mini-label\">Sample calls</div><div class=\"detail-list\">'+(events.map(function(event){return'<article class=\"sample\"><div class=\"sample-top\"><span>'+esc(event.mcpTool||event.tool)+'</span><span>'+fmt(event.tokens||0)+' tok</span></div><p>'+esc(event.preview||'No preview captured.')+'</p></article>';}).join('')||'<p class=\"empty\">No sampled MCP calls for this server in the selected sessions.</p>')+'</div>';}function renderMetadata(){var rows=(report.metadata||[]).map(function(entry,index){return'<button class=\"row-button'+(index===0?' active':'')+'\" data-meta=\"'+esc(entry[0])+'\"><span><span class=\"row-title\">'+esc(entry[0])+'</span><span class=\"meta\">Click to inspect sampled records</span></span><span class=\"row-meta\">'+fmt(tok(entry[1]))+' tok</span><span class=\"row-meta\">'+fmt(entry[1])+' ch</span></button>';}).join('')||'<div class=\"empty\">No metadata-heavy records detected.</div>';document.getElementById('panel-metadata').innerHTML='<div class=\"grid\"><section class=\"card\"><div class=\"section-head\"><div><h2>Metadata</h2><p class=\"meta\">Breakdown by transcript record type.</p></div></div>'+rows+'</section><aside class=\"card detail\" id=\"metadata-detail\"></aside></div>';Array.prototype.forEach.call(document.querySelectorAll('[data-meta]'),function(btn){btn.addEventListener('click',function(){Array.prototype.forEach.call(document.querySelectorAll('[data-meta]'),function(item){item.classList.remove('active');});btn.classList.add('active');renderMetadataDetail(btn.getAttribute('data-meta'));});});if((report.metadata||[]).length)renderMetadataDetail(report.metadata[0][0]);else document.getElementById('metadata-detail').innerHTML='<h2>Metadata Detail</h2><p class=\"empty\">Nothing to inspect yet.</p>';}function renderMetadataDetail(type){var events=(report.metadataEvents||[]).filter(function(event){return event.type===type;}).slice(0,30);document.getElementById('metadata-detail').innerHTML='<div class=\"section-head\"><div><h2>'+esc(type)+'</h2><p class=\"meta\">'+events.length+' sampled record'+(events.length===1?'':'s')+'</p></div></div><div class=\"detail-list\">'+(events.map(function(event){return'<article class=\"sample\"><div class=\"sample-top\"><span>'+esc(event.source)+' · '+esc(event.sessionTitle||event.sessionId)+'</span><span>'+fmt(event.tokens||0)+' tok</span></div><p>'+esc(event.preview||'No preview captured.')+'</p></article>';}).join('')||'<p class=\"empty\">No sampled records for this metadata type.</p>')+'</div>';}function renderSessions(){document.getElementById('panel-sessions').innerHTML=(report.sessions||[]).map(function(session,index){var catRows=Object.keys(session.categories||{}).sort(function(a,b){return session.categories[b]-session.categories[a];}).map(function(cat){var chars=session.categories[cat];return'<tr><td>'+esc(labels[cat]||cat)+'</td><td>'+fmt(tok(chars))+'</td><td>'+pc(chars,session.totalChars||0).toFixed(0)+'%</td></tr>';}).join('');var tools=(session.tools?Object.keys(session.tools):[]).sort(function(a,b){return session.tools[b]-session.tools[a];}).slice(0,8).map(function(name){return'<span class=\"badge\">'+esc(name)+' x'+session.tools[name]+'</span>';}).join('')||'<span class=\"empty\">none detected</span>';var paths=(session.paths?Object.keys(session.paths):[]).sort(function(a,b){return session.paths[b]-session.paths[a];}).slice(0,8).map(function(name){return'<span class=\"badge\">'+esc(name)+' x'+session.paths[name]+'</span>';}).join('')||'<span class=\"empty\">none detected</span>';return'<details class=\"session-card\"'+(index===0?' open':'')+'><summary><span><span class=\"eyebrow\">'+esc(session.source)+' · '+esc(session.updatedAt||'unknown time')+'</span><span class=\"session-title\">'+esc(session.title||session.sessionId)+'</span><span class=\"session-path\">'+esc(session.cwd||session.path)+'</span></span><span class=\"token-big\">'+fmt(session.tokens)+'</span></summary><div class=\"session-body\">'+bar(session.categories)+'<div class=\"grid equal\"><div><div class=\"mini-label\">Buckets</div><table class=\"table\"><tbody>'+catRows+'</tbody></table></div><div><div class=\"mini-label\">Frequent tools</div><div class=\"badge-list\">'+tools+'</div><div class=\"mini-label\">Repeated paths</div><div class=\"badge-list\">'+paths+'</div></div></div></div></details>';}).join('')||'<section class=\"card\"><p class=\"empty\">No matching sessions found.</p></section>';}function activate(name){Array.prototype.forEach.call(document.querySelectorAll('.tab'),function(tab){tab.classList.toggle('active',tab.getAttribute('data-tab')===name);});Array.prototype.forEach.call(document.querySelectorAll('.panel'),function(panel){panel.classList.toggle('active',panel.id==='panel-'+name);});if(location.hash!=='#'+name)history.replaceState(null,'','#'+name);}Array.prototype.forEach.call(document.querySelectorAll('.tab'),function(tab){tab.addEventListener('click',function(){activate(tab.getAttribute('data-tab'));});});renderStats();renderOverview();renderTools();renderMcp();renderMetadata();renderSessions();var initial=(location.hash||'#overview').slice(1);if(document.getElementById('panel-'+initial))activate(initial);})();" +
    "</script><script>" + overviewEnhancementScript() + "</script></body></html>";
}

function writeJson(sessions, args, file) {
  fs.writeFileSync(file, JSON.stringify(buildReport(sessions, args), null, 2));
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

- Tool output heavy: ask the agent to cap command output, summarize failures,
  and only expand logs when exact lines matter.
- Instructions heavy: move stable behavior into skills or AGENTS/CLAUDE files.
- Assistant prose heavy: ask for brief progress updates and a final decision
  log.
- One huge session: ask for a handoff summary, then continue in a fresh thread.
- Repeated path: ask the agent to keep a short file-role summary and reopen the
  file only when exact lines are needed.
- Repeated tool: ask the agent to batch independent inspection and avoid
  rerunning diagnostics unless state changed.
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
- two or three promptable ways to improve this thread
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
