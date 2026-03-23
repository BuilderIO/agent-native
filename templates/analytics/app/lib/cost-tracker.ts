// BigQuery on-demand pricing: $6.25 per TB
const COST_PER_BYTE = 6.25 / 1_000_000_000_000;
const STORAGE_KEY = "analytics_query_cost";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface StoredCost {
  bytes: number;
  startedAt: number;
}

function load(): StoredCost {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { bytes: 0, startedAt: Date.now() };
    const parsed: StoredCost = JSON.parse(raw);
    if (Date.now() - parsed.startedAt > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return { bytes: 0, startedAt: Date.now() };
    }
    return parsed;
  } catch {
    return { bytes: 0, startedAt: Date.now() };
  }
}

function save(data: StoredCost) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let state = load();
let listeners: Set<() => void> = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

export function addBytesProcessed(bytes: number) {
  if (bytes <= 0) return;
  state.bytes += bytes;
  save(state);
  notify();
}

export function getTotalBytes(): number {
  return state.bytes;
}

export function getTotalCost(): number {
  return state.bytes * COST_PER_BYTE;
}

export function getSessionAge(): number {
  return Date.now() - state.startedAt;
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetSession() {
  state = { bytes: 0, startedAt: Date.now() };
  save(state);
  notify();
}
