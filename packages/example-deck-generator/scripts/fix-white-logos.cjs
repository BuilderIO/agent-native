const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./data/decks/builder-fmd.json', 'utf8'));

var content = data.slides[2].content;

// Add filter to Greylock logo
content = content.replace(
  'alt="Greylock" style="height: 22px; width: auto; object-fit: contain;"',
  'alt="Greylock" style="height: 22px; width: auto; object-fit: contain; filter: brightness(0) invert(1);"'
);

// Add filter to all bottom logos in fmd-logos div
// Each logo has style="height: 18px; width: auto; object-fit: contain;"
content = content.replace(
  /style="height: 18px; width: auto; object-fit: contain;"/g,
  'style="height: 18px; width: auto; object-fit: contain; filter: brightness(0) invert(1);"'
);

data.slides[2].content = content;
fs.writeFileSync('./data/decks/builder-fmd.json', JSON.stringify(data, null, 2));
console.log('Added white filter to Greylock and bottom logos');
