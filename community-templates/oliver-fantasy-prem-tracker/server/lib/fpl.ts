import { XMLParser } from "fast-xml-parser";

const FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const FPL_FIXTURES_URL = "https://fantasy.premierleague.com/api/fixtures/?future=1";
const ESPN_STANDINGS_URL =
  "https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings";
const NEWS_FEED_URL = "https://www.fantasyfootballscout.co.uk/feed/";

const BOOTSTRAP_TTL_MS = 3 * 60_000;
const FIXTURES_TTL_MS = 10 * 60_000;
const TABLE_TTL_MS = 3 * 60_000;
const NEWS_TTL_MS = 10 * 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fetcher();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "oliver-fantasy-prem-tracker" },
  });
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export interface FplTeam {
  id: number;
  name: string;
  shortName: string;
}

export interface FplElementType {
  id: number;
  singularNameShort: string;
  pluralName: string;
}

export interface FplPlayer {
  id: number;
  webName: string;
  teamId: number;
  elementTypeId: number;
  totalPoints: number;
  goalsScored: number;
  assists: number;
  cleanSheets: number;
  minutes: number;
  form: number;
  pointsPerGame: number;
  ictIndex: number;
  nowCostMillions: number;
  selectedByPercent: number;
  status: string;
  chanceOfPlayingNextRound: number | null;
  transfersInEvent: number;
  transfersOutEvent: number;
}

interface RawBootstrap {
  teams: Array<{ id: number; name: string; short_name: string }>;
  element_types: Array<{
    id: number;
    singular_name_short: string;
    plural_name: string;
  }>;
  elements: Array<{
    id: number;
    web_name: string;
    team: number;
    element_type: number;
    total_points: number;
    goals_scored: number;
    assists: number;
    clean_sheets: number;
    minutes: number;
    form: string;
    points_per_game: string;
    ict_index: string;
    now_cost: number;
    selected_by_percent: string;
    status: string;
    chance_of_playing_next_round: number | null;
    transfers_in_event: number;
    transfers_out_event: number;
  }>;
}

export interface FplBootstrap {
  teams: FplTeam[];
  elementTypes: FplElementType[];
  players: FplPlayer[];
}

async function fetchBootstrapRaw(): Promise<FplBootstrap> {
  const raw = await fetchJson<RawBootstrap>(FPL_BOOTSTRAP_URL);
  return {
    teams: raw.teams.map((team) => ({
      id: team.id,
      name: team.name,
      shortName: team.short_name,
    })),
    elementTypes: raw.element_types.map((type) => ({
      id: type.id,
      singularNameShort: type.singular_name_short,
      pluralName: type.plural_name,
    })),
    players: raw.elements.map((element) => ({
      id: element.id,
      webName: element.web_name,
      teamId: element.team,
      elementTypeId: element.element_type,
      totalPoints: element.total_points,
      goalsScored: element.goals_scored,
      assists: element.assists,
      cleanSheets: element.clean_sheets,
      minutes: element.minutes,
      form: Number(element.form) || 0,
      pointsPerGame: Number(element.points_per_game) || 0,
      ictIndex: Number(element.ict_index) || 0,
      nowCostMillions: element.now_cost / 10,
      selectedByPercent: Number(element.selected_by_percent) || 0,
      status: element.status,
      chanceOfPlayingNextRound: element.chance_of_playing_next_round,
      transfersInEvent: element.transfers_in_event,
      transfersOutEvent: element.transfers_out_event,
    })),
  };
}

export function getBootstrap(): Promise<FplBootstrap> {
  return cached("bootstrap", BOOTSTRAP_TTL_MS, fetchBootstrapRaw);
}

export interface FplFixture {
  id: number;
  event: number | null;
  kickoffTime: string | null;
  teamHomeId: number;
  teamAwayId: number;
  teamHomeDifficulty: number;
  teamAwayDifficulty: number;
  finished: boolean;
}

interface RawFixture {
  id: number;
  event: number | null;
  kickoff_time: string | null;
  team_h: number;
  team_a: number;
  team_h_difficulty: number;
  team_a_difficulty: number;
  finished: boolean;
}

async function fetchFixturesRaw(): Promise<FplFixture[]> {
  const raw = await fetchJson<RawFixture[]>(FPL_FIXTURES_URL);
  return raw.map((fixture) => ({
    id: fixture.id,
    event: fixture.event,
    kickoffTime: fixture.kickoff_time,
    teamHomeId: fixture.team_h,
    teamAwayId: fixture.team_a,
    teamHomeDifficulty: fixture.team_h_difficulty,
    teamAwayDifficulty: fixture.team_a_difficulty,
    finished: fixture.finished,
  }));
}

export function getUpcomingFixtures(): Promise<FplFixture[]> {
  return cached("fixtures", FIXTURES_TTL_MS, fetchFixturesRaw);
}

export interface LeagueTableRow {
  rank: number;
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

interface EspnStandingsResponse {
  children: Array<{
    standings: {
      entries: Array<{
        team: { displayName: string };
        stats: Array<{ name: string; value?: number }>;
      }>;
    };
  }>;
}

function statValue(
  stats: Array<{ name: string; value?: number }>,
  name: string,
): number {
  return stats.find((stat) => stat.name === name)?.value ?? 0;
}

async function fetchLeagueTableRaw(): Promise<LeagueTableRow[]> {
  const raw = await fetchJson<EspnStandingsResponse>(ESPN_STANDINGS_URL);
  const entries = raw.children[0]?.standings.entries ?? [];
  return entries
    .map((entry) => {
      const stats = entry.stats;
      return {
        rank: statValue(stats, "rank"),
        team: entry.team.displayName,
        played: statValue(stats, "gamesPlayed"),
        wins: statValue(stats, "wins"),
        draws: statValue(stats, "ties"),
        losses: statValue(stats, "losses"),
        goalsFor: statValue(stats, "pointsFor"),
        goalsAgainst: statValue(stats, "pointsAgainst"),
        goalDifference: statValue(stats, "pointDifferential"),
        points: statValue(stats, "points"),
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

export function getLeagueTable(): Promise<LeagueTableRow[]> {
  return cached("table", TABLE_TTL_MS, fetchLeagueTableRaw);
}

export interface FplNewsItem {
  title: string;
  link: string;
  pubDate: string | null;
  snippet: string;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#8217;": "\u2019",
  "&#8216;": "\u2018",
  "&#8220;": "\u201c",
  "&#8221;": "\u201d",
  "&#8211;": "\u2013",
  "&#8212;": "\u2014",
  "&nbsp;": " ",
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(
      /&#(\d+);/g,
      (_, code: string) => String.fromCharCode(Number(code)),
    )
    .replace(
      /&amp;|&lt;|&gt;|&quot;|&#8217;|&#8216;|&#8220;|&#8221;|&#8211;|&#8212;|&nbsp;/g,
      (match) => HTML_ENTITIES[match] ?? match,
    );
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
  );
}

async function fetchNewsRaw(): Promise<FplNewsItem[]> {
  const response = await fetch(NEWS_FEED_URL, {
    headers: { "user-agent": "oliver-fantasy-prem-tracker" },
  });
  if (!response.ok) {
    throw new Error(`Request to ${NEWS_FEED_URL} failed with status ${response.status}`);
  }
  const xml = await response.text();
  const parser = new XMLParser({ ignoreAttributes: true, textNodeName: "text" });
  const parsed = parser.parse(xml) as {
    rss?: { channel?: { item?: unknown } };
  };
  const rawItems = parsed.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  return items.slice(0, 20).map((item) => {
    const record = item as Record<string, unknown>;
    const description =
      typeof record.description === "string" ? record.description : "";
    return {
      title:
        typeof record.title === "string"
          ? decodeHtmlEntities(record.title)
          : "Untitled",
      link: typeof record.link === "string" ? record.link : "",
      pubDate: typeof record.pubDate === "string" ? record.pubDate : null,
      snippet: stripHtml(description).slice(0, 220),
    };
  });
}

export function getNews(): Promise<FplNewsItem[]> {
  return cached("news", NEWS_TTL_MS, fetchNewsRaw);
}

export interface EnrichedPlayer extends FplPlayer {
  teamShortName: string;
  teamName: string;
  positionShort: string;
}

export async function getEnrichedPlayers(): Promise<EnrichedPlayer[]> {
  const bootstrap = await getBootstrap();
  const teamsById = new Map(bootstrap.teams.map((team) => [team.id, team]));
  const typesById = new Map(
    bootstrap.elementTypes.map((type) => [type.id, type]),
  );
  return bootstrap.players.map((player) => {
    const team = teamsById.get(player.teamId);
    const type = typesById.get(player.elementTypeId);
    return {
      ...player,
      teamShortName: team?.shortName ?? "UNK",
      teamName: team?.name ?? "Unknown",
      positionShort: type?.singularNameShort ?? "UNK",
    };
  });
}
