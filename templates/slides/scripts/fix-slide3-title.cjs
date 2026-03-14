const fs = require('fs');

async function main() {
  // Read the current deck data from file (which has our changes)
  const data = JSON.parse(fs.readFileSync('./data/decks/builder-fmd.json', 'utf8'));
  
  // Send via PUT to the API so the React client picks it up
  const res = await fetch('http://localhost:8080/api/decks/builder-fmd', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  
  if (res.ok) {
    console.log('Deck updated via API successfully');
  } else {
    console.log('API error:', res.status, await res.text());
  }
}

main().catch(console.error);
