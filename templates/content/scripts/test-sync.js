const fs = require('fs');

const file = fs.readFileSync('content/projects/steve/claude-code-for-designers/draft.md', 'utf8');

console.log(file.substring(0, 100));
