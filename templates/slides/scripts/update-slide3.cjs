const fs = require('fs');
const API_KEY = 'oBi4Cty5Hn7oWUPkqWpVauDn6E4S45ueHa14ymPF6MWgBCqj3MuoDGDJJGq311iM2DsQ0aSvVvL7Pa2Ay5553w';

async function fetchDarkLogo(domain) {
  const res = await fetch('https://api.brandfetch.io/v2/brands/' + domain, {
    headers: { 'Authorization': 'Bearer ' + API_KEY }
  });
  if (!res.ok) return null;
  const data = await res.json();
  const logos = data.logos || [];
  const darkLogo = logos.find(function(l) { return l.type === 'logo' && l.theme === 'dark'; });
  const anyLogo = logos.find(function(l) { return l.type === 'logo'; });
  const logo = darkLogo || anyLogo;
  if (logo && logo.formats && logo.formats.length > 0) {
    const svg = logo.formats.find(function(f) { return f.format === 'svg'; });
    const png = logo.formats.find(function(f) { return f.format === 'png'; });
    return (svg || png || logo.formats[0]).src;
  }
  return null;
}

async function main() {
  // Pre-fetched URLs from Brand API
  var logos = {
    'greylock.com': 'https://cdn.brandfetch.io/idZNNKeF6A/theme/dark/logo.svg?c=1bxin53im4siw5hzkq36yn260s2Y1YkCroE',
    'microsoft.com': 'https://cdn.brandfetch.io/idchmboHEZ/theme/dark/logo.svg?c=1bxin53im4siw5hzkq36yn260s2Y1YkCroE',
    'zapier.com': 'https://cdn.brandfetch.io/idNMs_nMA0/theme/dark/logo.svg?c=1bxin53im4siw5hzkq36yn260s2Y1YkCroE',
    'jcrew.com': 'https://cdn.brandfetch.io/idxGGdnl4v/theme/dark/logo.svg?c=1bxin53im4siw5hzkq36yn260s2Y1YkCroE',
    'panasonic.com': 'https://cdn.brandfetch.io/idZc2Ve3u9/theme/dark/logo.svg?c=1bxin53im4siw5hzkq36yn260s2Y1YkCroE',
    'scale.com': 'https://cdn.brandfetch.io/idLdViRnHy/theme/dark/logo.svg?c=1bxin53im4siw5hzkq36yn260s2Y1YkCroE',
    'ocbc.com': 'https://cdn.brandfetch.io/idY-deZG93/w/1160/h/312/theme/dark/logo.png?c=1bxin53im4siw5hzkq36yn260s2Y1YkCroE',
    'pendo.io': 'https://cdn.brandfetch.io/idGDHFYdgm/theme/dark/logo.svg?c=1bxin53im4siw5hzkq36yn260s2Y1YkCroE',
    'clickup.com': 'https://cdn.brandfetch.io/idU6lzwMYA/theme/dark/logo.svg?c=1bxin53im4siw5hzkq36yn260s2Y1YkCroE',
    'harrys.com': 'https://cdn.brandfetch.io/idGxZpwqsx/theme/dark/logo.svg?c=1bxin53im4siw5hzkq36yn260s2Y1YkCroE',
  };

  // Also fetch Macy's
  var macysUrl = await fetchDarkLogo('macys.com');
  if (macysUrl) {
    logos['macys.com'] = macysUrl;
    console.log('Macys logo:', macysUrl);
  }

  var data = JSON.parse(fs.readFileSync('./data/decks/builder-fmd.json', 'utf8'));

  // Tabler Icon SVGs - colored #00E5FF (cyan)
  var iconRefresh = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 10px; display: block;"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/></svg>';
  var iconSearch = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 10px; display: block;"><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/></svg>';
  var iconList = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 10px; display: block;"><path d="M11 6h9"/><path d="M11 12h9"/><path d="M12 18h8"/><path d="M4 16l2 2l4 -4"/><path d="M4 4l2 2l4 -4"/></svg>';

  // Update slide 3
  data.slides[2].content = '<div class="fmd-slide" style="padding: 40px 60px; align-items: center;">' +
    '\n  <div class="fmd-heading-lg" style="margin-bottom: 32px; max-width: 700px;">Builder is where your team and AI agents build, review, and ship with confidence</div>' +
    '\n\n  <div style="display: flex; gap: 16px; width: 100%; max-width: 760px; margin-bottom: 28px;">' +
    '\n    <div class="fmd-card" style="flex: 1.2; display: flex; align-items: center; justify-content: center; gap: 40px; padding: 20px 32px;">' +
    '\n      <div style="text-align: center;">' +
    '\n        <div class="fmd-stat">3X</div>' +
    '\n        <div style="font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 6px;">YoY Customer Growth</div>' +
    '\n      </div>' +
    '\n      <div style="text-align: center;">' +
    '\n        <div class="fmd-stat">60%</div>' +
    '\n        <div style="font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 6px;">of Fortune 5</div>' +
    '\n      </div>' +
    '\n    </div>' +
    '\n    <div class="fmd-card" style="flex: 0.8; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px;">' +
    '\n      <div style="font-size: 10px; letter-spacing: 2px; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-bottom: 10px;">TIER-1 INVESTORS</div>' +
    '\n      <div style="display: flex; gap: 24px; align-items: center;">' +
    '\n        <img src="' + logos['greylock.com'] + '" alt="Greylock" style="height: 22px; width: auto; object-fit: contain;" />' +
    '\n        <img src="' + logos['microsoft.com'] + '" alt="Microsoft" style="height: 22px; width: auto; object-fit: contain;" />' +
    '\n      </div>' +
    '\n    </div>' +
    '\n  </div>' +
    '\n\n  <div class="fmd-card" style="display: flex; width: 100%; max-width: 760px; margin-bottom: 28px; padding: 20px 0;">' +
    '\n    <div style="flex: 1; text-align: center; padding: 0 16px;">' +
    '\n      ' + iconRefresh +
    '\n      <div style="font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500; line-height: 1.4;">Non-technical teams<br/>move faster</div>' +
    '\n    </div>' +
    '\n    <div style="flex: 1; text-align: center; padding: 0 16px; border-left: 1px solid rgba(255,255,255,0.06); border-right: 1px solid rgba(255,255,255,0.06);">' +
    '\n      ' + iconSearch +
    '\n      <div style="font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500; line-height: 1.4;">Free up engineering<br/>capacity</div>' +
    '\n    </div>' +
    '\n    <div style="flex: 1; text-align: center; padding: 0 16px;">' +
    '\n      ' + iconList +
    '\n      <div style="font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500; line-height: 1.4;">Accelerate roadmap<br/>and shipping velocity</div>' +
    '\n    </div>' +
    '\n  </div>' +
    '\n\n  <div class="fmd-logos" style="gap: 24px;">' +
    '\n    <img src="' + logos['zapier.com'] + '" alt="Zapier" style="height: 18px; width: auto; object-fit: contain;" />' +
    '\n    <img src="' + logos['jcrew.com'] + '" alt="J.Crew" style="height: 18px; width: auto; object-fit: contain;" />' +
    '\n    <img src="' + logos['panasonic.com'] + '" alt="Panasonic" style="height: 18px; width: auto; object-fit: contain;" />' +
    '\n    <img src="' + logos['scale.com'] + '" alt="Scale" style="height: 18px; width: auto; object-fit: contain;" />' +
    '\n    <img src="' + logos['ocbc.com'] + '" alt="OCBC" style="height: 18px; width: auto; object-fit: contain;" />' +
    '\n    <img src="' + logos['pendo.io'] + '" alt="Pendo" style="height: 18px; width: auto; object-fit: contain;" />' +
    '\n    <img src="' + logos['clickup.com'] + '" alt="ClickUp" style="height: 18px; width: auto; object-fit: contain;" />' +
    '\n    <img src="' + logos['harrys.com'] + '" alt="Harrys" style="height: 18px; width: auto; object-fit: contain;" />' +
    '\n  </div>' +
    '\n</div>';

  // Also fix Macy's logo on slides 2 and 6 if we got the URL
  if (logos['macys.com']) {
    // Slide 2 - small logo in header
    data.slides[1].content = data.slides[1].content.replace(
      /src="[^"]*macys[^"]*"/,
      'src="' + logos['macys.com'] + '"'
    );
    // Slide 6 - large logo
    data.slides[5].content = data.slides[5].content.replace(
      /src="[^"]*macys[^"]*"/,
      'src="' + logos['macys.com'] + '"'
    );
  }

  fs.writeFileSync('./data/decks/builder-fmd.json', JSON.stringify(data, null, 2));
  console.log('All slides updated with Brandfetch asset URLs');
}

main().catch(function(e) { console.error(e); });
