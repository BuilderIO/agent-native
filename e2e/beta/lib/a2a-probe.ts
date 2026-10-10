/**
 * Reading `GET /_agent-native/agents/probe`.
 *
 * The route only checks authorization when the caller names a saved
 * hosted-agent connection (`auth` or `kind`); a plain `?url=` probe of a
 * first-party peer fetches its agent card and stops. So `authorized` is a
 * three-state field: `true` and `false` are decisive answers from the peer, and
 * an absent `authorized` means authorization was not verified (here, always),
 * with `authError` giving the reason when a check started and did not finish.
 * Reading absent as "not authorized" blamed a missing signing secret for a
 * check that never ran. What a plain probe does establish is that the peer is
 * reachable and serves a card that advertises signed (jwtBearer) calls; the
 * authenticated delegation itself is the delegation test's job.
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
  securitySchemes?: string[];
  error?: string;
}

export type PeerProbeOutcome =
  | "authorized"
  | "rejected"
  | "unreachable"
  | "card-problem"
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
  if (verdict.authorized === false || verdict.cardStatus === "auth-rejected") {
    return "rejected";
  }
  if (verdict.authorized === true) return "authorized";
  if (
    verdict.cardStatus !== "reachable" ||
    !verdict.securitySchemes?.includes("jwtBearer")
  ) {
    return "card-problem";
  }
  return "undecided";
}

/** `undecided` is a pass: reachable, signed-call card, authorization not verified by this route. */
export function peerProbePasses(outcome: PeerProbeOutcome): boolean {
  return outcome === "authorized" || outcome === "undecided";
}

export interface SettledPeerProbe {
  outcome: PeerProbeOutcome;
  /** Every attempt's raw response, oldest first. */
  attempts: PeerProbeResponse[];
}

/**
 * Probe until the peer gives a decisive answer. `authorized`, `rejected`, and
 * `undecided` are decisive; everything else can be a timeout or a half-built
 * card on a cold peer, so it is retried a bounded number of times and then
 * reported as what it was.
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
    if (
      outcome === "authorized" ||
      outcome === "rejected" ||
      outcome === "undecided"
    ) {
      break;
    }
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
    "card-problem": `${from} reaches ${to} at ${url} but ${to}'s agent card is not usable for signed calls: the probe needs cardStatus "reachable" (a card with a JSON-RPC endpoint) and a jwtBearer security scheme.`,
    undecided: `${from} reaches ${to} at ${url} and ${to}'s card advertises signed (jwtBearer) calls. Authorization was not verified: this route only does that for a saved hosted-agent connection, so the delegation test covers the signed call.`,
    "probe-error": `${from}'s own probe endpoint failed before it asked ${to} anything (url ${url}).`,
  }[settled.outcome];
  return `${lead}\nProbe responses (${settled.attempts.length}):\n${raw}`;
}
