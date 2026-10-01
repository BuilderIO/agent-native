/**
 * Reading `GET /_agent-native/agents/probe`.
 *
 * `authorized` is a three-state field, not a boolean: `true` and `false` are
 * decisive answers from the peer, and an absent `authorized` means the check
 * did not finish (a timeout, a 5xx, a card with no JSON-RPC endpoint). The
 * probe sets `authError` to the reason in that case. Reading absent as "not
 * authorized" blamed a missing signing secret for a check that never completed.
 */

export interface PeerProbeResponse {
  status: number;
  body: string;
}

export interface PeerProbeVerdict {
  reachable?: boolean;
  authorized?: boolean;
  authError?: string;
  cardStatus?: string;
  error?: string;
}

export type PeerProbeOutcome =
  | "authorized"
  | "rejected"
  | "unreachable"
  | "undecided"
  | "probe-error";

export function classifyPeerProbe(
  response: PeerProbeResponse,
): PeerProbeOutcome {
  if (response.status !== 200) return "probe-error";
  let verdict: PeerProbeVerdict;
  try {
    verdict = JSON.parse(response.body) as PeerProbeVerdict;
  } catch {
    return "probe-error";
  }
  if (verdict.reachable !== true) return "unreachable";
  if (verdict.authorized === true) return "authorized";
  if (verdict.authorized === false) return "rejected";
  return "undecided";
}

export interface SettledPeerProbe {
  outcome: PeerProbeOutcome;
  /** Every attempt's raw response, oldest first. */
  attempts: PeerProbeResponse[];
}

/**
 * Probe until the peer gives a decisive answer. Only `authorized` and
 * `rejected` are decisive; everything else can be a timeout on a cold peer, so
 * it is retried a bounded number of times and then reported as what it was.
 */
export async function settlePeerProbe(
  read: () => Promise<PeerProbeResponse>,
  {
    attempts = 3,
    delayMs = 2_000,
    sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<SettledPeerProbe> {
  const history: PeerProbeResponse[] = [];
  let outcome: PeerProbeOutcome = "probe-error";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await read();
    history.push(response);
    outcome = classifyPeerProbe(response);
    if (outcome === "authorized" || outcome === "rejected") break;
    if (attempt < attempts) await sleep(delayMs);
  }
  return { outcome, attempts: history };
}

export function explainPeerProbe(
  from: string,
  to: string,
  url: string,
  settled: SettledPeerProbe,
): string {
  const raw = settled.attempts
    .map(
      (attempt, index) =>
        `#${index + 1} HTTP ${attempt.status}: ${attempt.body.slice(0, 400)}`,
    )
    .join("\n");
  const lead = {
    authorized: `${from} is authorized at ${to} (${url}).`,
    rejected: `${from} reaches ${to} at ${url} and ${to} rejected its signed call, so every delegated call fails. The apps do not share a signing secret, or the credential was refused.`,
    unreachable: `${from} cannot reach ${to} at ${url}.`,
    undecided: `${from} reaches ${to} at ${url} but the authorization check never finished, so this is neither a pass nor a rejection. authError is the reason the probe gave.`,
    "probe-error": `${from}'s own probe endpoint failed before it asked ${to} anything (url ${url}).`,
  }[settled.outcome];
  return `${lead}\nProbe responses (${settled.attempts.length}):\n${raw}`;
}
