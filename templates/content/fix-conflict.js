const fs = require('fs');
const path = require('path');
const file = 'content/projects/alice/how-to-run-claude-code-on-mobile/draft.md';
let content = fs.readFileSync(file, 'utf8');

const conflictRegex = /<<<<<<< HEAD\n=======\n([\s\S]*?)>>>>>>> refs\/remotes\/origin\/main\n/g;

content = content.replace(conflictRegex, '$1');

fs.writeFileSync(file, content);
console.log('Fixed conflict');
