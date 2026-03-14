const NOTION_API = 'https://api.notion.com/v1';
const DATA_DICTIONARY_DB_ID = '31a3d7274be580da9da7cf54909e1b7c';
const NOTION_API_KEY = process.env.NOTION_API_KEY;

function richTextToString(rt) {
  if (!rt || !Array.isArray(rt)) return '';
  return rt.map(t => t.plain_text ?? '').join('');
}

function extractProp(props, name) {
  const prop = props[name];
  if (!prop) return '';

  switch (prop.type) {
    case 'title': return richTextToString(prop.title);
    case 'rich_text': return richTextToString(prop.rich_text);
    case 'select': return prop.select?.name ?? '';
    case 'multi_select': return (prop.multi_select ?? []).map(s => s.name).join(', ');
    case 'number': return prop.number != null ? String(prop.number) : '';
    default: return '';
  }
}

async function fetchDataDictionary() {
  const res = await fetch(`${NOTION_API}/databases/${DATA_DICTIONARY_DB_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 100 })
  });

  const result = await res.json();
  const entries = [];

  for (const page of result.results ?? []) {
    const props = page.properties ?? {};
    const allProps = {};
    for (const name of Object.keys(props)) {
      allProps[name] = extractProp(props, name);
    }

    entries.push({
      metric: allProps['Metric'] || '',
      definition: allProps['Definition'] || '',
      table: allProps['Table'] || '',
      cuts: allProps['Cuts'] || '',
      department: allProps['Department'] || '',
      queryTemplate: allProps['Query Template'] || '',
      commonQuestions: allProps['Common Questions'] || '',
      knownGotchas: allProps['Known Gotchas'] || '',
      owner: allProps['Owner'] || '',
      exampleOutput: allProps['Example Output'] || '',
      columnsUsed: allProps['Columns Used'] || '',
      joinPattern: allProps['Join Pattern'] || '',
      updateFrequency: allProps['Update Frequency'] || '',
      exampleUseCase: allProps['Example Use Case'] || '',
    });
  }

  return entries;
}

const entries = await fetchDataDictionary();

console.log('=== DATA DICTIONARY ANALYSIS ===\n');
console.log(`Total Metrics: ${entries.length}\n`);

entries.forEach((e, i) => {
  console.log(`${i+1}. ${e.metric}`);
  console.log(`   Definition: ${e.definition || 'MISSING ❌'}`);
  console.log(`   Table: ${e.table || 'MISSING ❌'}`);
  console.log(`   Department: ${e.department || 'MISSING ❌'}`);
  console.log(`   Owner: ${e.owner || 'MISSING ❌'}`);
  console.log(`   Query Template: ${e.queryTemplate ? '✓' : 'MISSING ❌'}`);
  console.log(`   Common Questions: ${e.commonQuestions || 'MISSING ❌'}`);
  console.log(`   Known Gotchas: ${e.knownGotchas || 'MISSING ❌'}`);
  console.log(`   Example Use Case: ${e.exampleUseCase || 'MISSING ❌'}`);
  console.log('');
});

// Analysis
const missing = {
  definition: entries.filter(e => !e.definition).length,
  table: entries.filter(e => !e.table).length,
  department: entries.filter(e => !e.department).length,
  owner: entries.filter(e => !e.owner).length,
  queryTemplate: entries.filter(e => !e.queryTemplate).length,
  commonQuestions: entries.filter(e => !e.commonQuestions).length,
  knownGotchas: entries.filter(e => !e.knownGotchas).length,
  exampleUseCase: entries.filter(e => !e.exampleUseCase).length,
};

console.log('=== MISSING FIELDS SUMMARY ===');
Object.entries(missing).forEach(([field, count]) => {
  const pct = Math.round((count / entries.length) * 100);
  console.log(`${field}: ${count}/${entries.length} (${pct}% missing)`);
});

// Save raw data for analysis
import { writeFileSync } from 'fs';
writeFileSync('dd-analysis.json', JSON.stringify(entries, null, 2));
console.log('\n✓ Saved raw data to dd-analysis.json');
