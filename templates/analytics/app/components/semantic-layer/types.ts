// One entry from list-data-dictionary `results`. Stored entries come from
// save-data-dictionary-entry; source-index suggestions (sourceIndex: true,
// approved: false, aiGenerated: true) come from sourceIndexDictionaryEntries.
export interface DictionaryEntry {
  id: string;
  metric: string;
  definition: string;
  source?: string;
  action?: string;
  department?: string;
  table?: string;
  columnsUsed?: string;
  cuts?: string;
  queryTemplate?: string;
  exampleOutput?: string;
  joinPattern?: string;
  updateFrequency?: string;
  dataLag?: string;
  dependencies?: string;
  validDateRange?: string;
  commonQuestions?: string;
  knownGotchas?: string;
  exampleUseCase?: string;
  owner?: string;
  status?: "active" | "deprecated";
  approved?: boolean;
  aiGenerated?: boolean;
  sourceUrl?: string;
  semanticScope?: string;
  createdAt?: string;
  updatedAt?: string;
  author?: string;
  sourceIndex?: boolean;
  sourceKind?: string;
  entryType?: string;
  grain?: string;
  primaryEntity?: string;
  timeDimension?: string;
  semanticModel?: string;
  sourcePath?: string;
  sourceRevision?: string;
  sourceIndexGeneratedAt?: string;
  sourceIndexSources?: string;
}

// Read state of the generated source index that list-data-dictionary merges in.
export type SourceIndexStatus =
  | "not-configured"
  | "unavailable"
  | "invalid"
  | "available";

// list-data-dictionary result page.
export interface DictionaryPage {
  results: DictionaryEntry[];
  nextPage: string | null;
  sourceIndexStatus: SourceIndexStatus;
}
