import type {
  BuilderCmsModelFieldSummary,
  ContentDatabaseSourceType,
} from "../shared/api.js";
import {
  readBuilderCmsContentEntries,
  readBuilderCmsModelFields,
  type BuilderCmsReadProgress,
  type BuilderCmsReadState,
} from "./_builder-cms-read-client.js";
import type { BuilderCmsSourceEntry } from "./_builder-cms-source-adapter.js";
import { readLocalTableEntries } from "./_local-table-source.js";
import { readNotionDatabaseSource } from "./_notion-database-source-adapter.js";

export interface ContentDatabaseSourceReadResult {
  state: BuilderCmsReadState;
  entries: BuilderCmsSourceEntry[];
  fields: BuilderCmsModelFieldSummary[];
  fetchedAt: string;
  message: string | null;
  progress?: BuilderCmsReadProgress;
  metadata?: Record<string, unknown>;
}

export interface ContentDatabaseSourceAdapter {
  sourceType: ContentDatabaseSourceType;
  read(args: {
    sourceTable: string;
    limit: number;
    offset: number;
    fullRefresh?: boolean;
  }): Promise<ContentDatabaseSourceReadResult>;
}

const builderCmsAdapter: ContentDatabaseSourceAdapter = {
  sourceType: "builder-cms",
  async read({ sourceTable, fullRefresh }) {
    const fields = await readBuilderCmsModelFields({ model: sourceTable });
    const read = await readBuilderCmsContentEntries({
      model: sourceTable,
      fieldPaths: fields.map((field) => `data.${field.name}`),
      maxPages: fullRefresh ? undefined : 1,
      limit: fullRefresh ? 10_000 : undefined,
    });
    return { ...read, fields };
  },
};

const localTableAdapter: ContentDatabaseSourceAdapter = {
  sourceType: "local-table",
  async read({ sourceTable, limit, offset }) {
    const { entries, modelFields: fields } = await readLocalTableEntries(
      sourceTable,
      { limit, offset },
    );
    return {
      state: "live",
      entries,
      fields,
      fetchedAt: new Date().toISOString(),
      message: null,
    };
  },
};

const notionDatabaseAdapter: ContentDatabaseSourceAdapter = {
  sourceType: "notion-database",
  read: readNotionDatabaseSource,
};

const adapters = new Map<
  ContentDatabaseSourceType,
  ContentDatabaseSourceAdapter
>(
  [builderCmsAdapter, localTableAdapter, notionDatabaseAdapter].map(
    (adapter) => [adapter.sourceType, adapter],
  ),
);

export function getContentDatabaseSourceAdapter(
  sourceType: ContentDatabaseSourceType,
) {
  return adapters.get(sourceType) ?? null;
}
