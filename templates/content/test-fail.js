import { builderToMarkdown } from './client/lib/builder-to-markdown.js';
import fs from 'fs';
const data = JSON.parse(fs.readFileSync('pulled-table-ref.json', 'utf8'));
const table = data.find(b => b.component?.name === 'Material Table');
console.log(builderToMarkdown([table]));
