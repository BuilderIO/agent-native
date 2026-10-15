export const ARTICLE_TOPICS = {
  "coding-agents": {
    name: "Working with coding agents",
    description:
      "Plans, specs, bug reports, and reviews that keep your coding agent on track.",
  },
  prototyping: {
    name: "Prototyping and design",
    description:
      "Briefs, wireframes, and prototypes you can react to before anything gets built.",
  },
  "meetings-and-notes": {
    name: "Meetings, notes, and dictation",
    description:
      "Capture what was said and decided, without typing it all yourself.",
  },
  metrics: {
    name: "Metrics and analytics",
    description:
      "The numbers worth tracking, and how to get answers from your own data.",
  },
  presentations: {
    name: "Pitch decks and presentations",
    description: "What goes in the deck, and how to build it faster.",
  },
} as const;

export type ArticleTopic = keyof typeof ARTICLE_TOPICS;
export type ArticleTopicSummary = {
  slug: ArticleTopic;
  name: string;
  description: string;
  count: number;
};

export function getArticleTopics(
  articles: { topic: ArticleTopic }[],
): ArticleTopicSummary[] {
  return (Object.keys(ARTICLE_TOPICS) as ArticleTopic[]).flatMap((slug) => {
    const count = articles.filter((article) => article.topic === slug).length;
    return count ? [{ slug, ...ARTICLE_TOPICS[slug], count }] : [];
  });
}
