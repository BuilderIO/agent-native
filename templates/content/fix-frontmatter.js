const fs = require('fs');

const path = 'content/projects/alice/test-cursor-alternatives/draft.md';
let content = fs.readFileSync(path, 'utf8');

// There are two frontmatter blocks now. We need to consolidate them and remove the invalid one
const regex = /^---\n([\s\S]*?)\n---\n+/g;
const matches = [...content.matchAll(regex)];

if (matches.length >= 2) {
  // Let's just use the second one which is the good one
  content = content.replace(matches[0][0], '');
  fs.writeFileSync(path, content);
  console.log('Fixed draft.md');
} else {
  console.log('Could not find multiple frontmatter blocks');
}
