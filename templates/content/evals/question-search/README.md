# Question-search bake-off

Compares ways of answering question-style searches ("what did we learn from
the mobile launch") on the search relevance eval's invented corpus
(`../search-relevance/corpus.ts`) and its judged cases. Only invented pages
reach a model, so a method can be judged before any real page text is sent
to an embedding or chat model.

It runs only with `SEARCH_QUESTION_BAKEOFF=1`. Without model keys it scores
the three methods that need none; with them it scores every method.

## Methods

| Method             | What it does                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| current            | Today's `search-documents`: every word must match.                                                                               |
| keywords           | BM25 over title, description and body for the question's words minus filler. No model.                                           |
| current + keywords | Today's search and keywords, merged by reciprocal rank. No model.                                                                |
| embeddings         | Each page in chunks of about 1,200 characters; the closest chunk to the question's embedding wins.                               |
| hybrid             | Today's search and embeddings, merged by reciprocal rank.                                                                        |
| hybrid + keywords  | Today's search, keywords and embeddings, merged.                                                                                 |
| rewrite            | A chat model turns the question into up to three short searches, merged with today's search. Sends only the question to a model. |
| rewrite + hybrid   | The rewritten searches merged with hybrid.                                                                                       |
| HyDE               | Embeds a model-written answer passage instead of the question.                                                                   |
| enrichment         | Each page is also embedded as a model's summary and the questions it answers.                                                    |
| rerank             | A chat model reorders the top 20 of hybrid + keywords.                                                                           |

Every method is scored on the question cases (top-1, top-3, mean reciprocal
rank) and on the other ranked cases (known-item, passage, typo), so a method
that answers questions but buries known items shows it. No search may
surface a hidden, trashed or other person's page; the access cases are the
ones built to tempt it.

The report also counts model calls, time and tokens per search, and the
calls a method makes once per page (embedding and enrichment).

## Running

```sh
SEARCH_QUESTION_BAKEOFF=1 OPENAI_API_KEY=... \
  corepack pnpm --filter content exec vitest run evals/question-search
```

- Embeddings go through Builder's gateway when `BUILDER_PRIVATE_KEY` and
  `BUILDER_PUBLIC_KEY` are set, else OpenAI (`text-embedding-3-small`, or
  `SEARCH_BAKEOFF_EMBEDDING_MODEL`).
- Chat goes to OpenAI (`gpt-6-luna`, or `SEARCH_BAKEOFF_CHAT_MODEL`).
- With `SEARCH_BAKEOFF_PROVIDER=openrouter` and `OPENROUTER_API_KEY`, chat and
  embeddings go through OpenRouter instead (`openai/gpt-6-luna` and
  `openai/text-embedding-3-small`). It's never chosen on its own.
- `SEARCH_QUESTION_BAKEOFF_REPORT=<dir>` writes the report as JSON and
  Markdown.

The gated evals workflow runs it as the `content-question-search` suite.

## Results, 2026-11-09

Through OpenRouter (`openai/text-embedding-3-small`, `openai/gpt-6-luna`) on
116 visible invented pages, 27 question cases and 29 other ranked cases. The
whole run cost about $0.04. Model time is from a home connection, so read it
as relative.

| Method             | Question top-3 | Question top-1 | Other top-3 | Model calls per search | Model ms per search |
| ------------------ | -------------- | -------------- | ----------- | ---------------------- | ------------------- |
| current            | 0%             | 0%             | 97%         | 0                      | 0                   |
| current + keywords | 70%            | 58%            | 97%         | 0                      | 0                   |
| hybrid             | 96%            | 71%            | 100%        | 1                      | 289                 |
| rewrite + hybrid   | 96%            | 75%            | 97%         | 2                      | 3,178               |
| enrichment         | 96%            | 75%            | 100%        | 1                      | 289                 |
| HyDE               | 100%           | 92%            | 100%        | 2                      | 3,575               |
| rerank             | 100%           | 96%            | 100%        | 2                      | 3,701               |

No method surfaced a page the searcher couldn't open. Hybrid answers nearly
every question with one embedding call and no chat model, and it also lifts the
other searches. HyDE and rerank mostly improve which page comes first, at about
twelve times the time per search. Enrichment matches hybrid but makes a chat
call for every page at index time (122 calls against 4).
