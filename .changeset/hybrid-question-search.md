---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Search can find pages by meaning as well as by words. A search index registered with `semantic: true` and an `audience` keeps page-chunk embeddings fresh through a second change-feed consumer, `search-embeddings`, which an app adds with `semanticSearchMigration()`. `searchSemanticIndex()` returns the nearest pages the searcher's audiences may match, or says why it couldn't (`off`, or `unavailable` with `no-provider`, `no-vector-store` or `error`), and never throws. Embeddings use the organization's embedding provider and record usage for every call. Meaning search is on by default; an organization admin can turn it off in Settings → Infrastructure or with `manage-service-providers` `{ semanticSearch: false }`, which deletes the organization's vectors, and turning it back on queues every page again. Vectors live in pgvector by default; `configureSemanticSearch({ vectorStore })` swaps the store, and `createMemorySearchVectorStore()` from `@agent-native/core/testing` runs the whole path in tests without pgvector.
