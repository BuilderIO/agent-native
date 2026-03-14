const fs = require('fs');
async function run() {
  const res = await fetch('http://localhost:8080/api/builder/articles', {
    headers: {
      'x-builder-api-key': 'YJIGb4i01jvw0SRdL5Bt'
    }
  });
  const data = await res.json();
  const article = data.articles.find(a => a.data.handle === 'best-ai-background-agents-for-developers-2026');
  if (article) {
    fs.writeFileSync('pulled-table-ref.json', JSON.stringify(article.data.blocks, null, 2));
    console.log('Saved to pulled-table-ref.json');
  } else {
    console.log('Article not found');
  }
}
run();
