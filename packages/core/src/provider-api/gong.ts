export interface GongCallParty {
  name?: string;
  emailAddress?: string;
  [key: string]: unknown;
}

export interface GongCallRecord {
  id?: string;
  title?: string;
  started?: string;
  duration?: number;
  direction?: string;
  parties?: GongCallParty[];
  [key: string]: unknown;
}

export interface GongCallSummary {
  id?: string;
  title?: string;
  started?: string;
  duration?: number;
  direction?: string;
  parties: Array<{ name?: string; email?: string }>;
}

export function filterGongCallsByEmail(
  calls: readonly GongCallRecord[],
  email: string,
  limit = 10,
): GongCallSummary[] {
  const normalizedEmail = email.toLowerCase();
  return calls
    .filter((call) =>
      (call.parties ?? []).some(
        (party) => party.emailAddress?.toLowerCase() === normalizedEmail,
      ),
    )
    .slice(0, limit)
    .map((call) => ({
      id: call.id,
      title: call.title,
      started: call.started,
      duration: call.duration,
      direction: call.direction,
      parties: (call.parties ?? []).map((party) => ({
        name: party.name,
        email: party.emailAddress,
      })),
    }));
}

export interface LookupGongCallsByEmailOptions {
  credential: string;
  email: string;
  lookbackDays?: number;
  limit?: number;
  now?: number;
  fetch?: typeof globalThis.fetch;
}

export type GongCallsLookupResult =
  | { ok: true; calls: GongCallSummary[] }
  | { ok: false; status: number; error: string };

export async function lookupGongCallsByEmail(
  options: LookupGongCallsByEmailOptions,
): Promise<GongCallsLookupResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const lookbackDays = options.lookbackDays ?? 90;
  const fromDateTime = new Date(
    (options.now ?? Date.now()) - lookbackDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const url = `https://api.gong.io/v2/calls?fromDateTime=${fromDateTime}`;
  const authHeaders = [
    `Bearer ${options.credential}`,
    `Basic ${Buffer.from(options.credential).toString("base64")}`,
  ];

  try {
    let firstStatus = 502;
    for (const [index, authorization] of authHeaders.entries()) {
      const response = await fetchImpl(url, {
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
      });
      if (index === 0) firstStatus = response.status;
      if (!response.ok) continue;
      const data = (await response.json()) as { calls?: GongCallRecord[] };
      return {
        ok: true,
        calls: filterGongCallsByEmail(
          data.calls ?? [],
          options.email,
          options.limit,
        ),
      };
    }
    return {
      ok: false,
      status: firstStatus,
      error: `Gong API error: ${firstStatus}`,
    };
  } catch {
    return { ok: false, status: 500, error: "Failed to reach Gong API" };
  }
}
