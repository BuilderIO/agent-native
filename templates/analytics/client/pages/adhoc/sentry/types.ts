export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform: string | null;
  dateCreated: string;
  status: string;
}

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  permalink: string;
  level: string;
  status: string;
  platform: string;
  project: { id: string; name: string; slug: string };
  type: string;
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface SentryEvent {
  eventID: string;
  title: string;
  message: string;
  dateCreated: string;
  tags: { key: string; value: string }[];
  user?: { id?: string; email?: string; username?: string };
}

export interface SentryOrgStats {
  start: string;
  end: string;
  intervals: string[];
  groups: {
    by: Record<string, string>;
    totals: Record<string, number>;
    series: Record<string, number[]>;
  }[];
}

export type TimePeriod = "1h" | "24h" | "7d" | "14d" | "30d";
