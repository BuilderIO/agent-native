const domain = 'zapier.com';
const formats = [
  '/logo',
  '/theme/dark/logo',
  '',
  '/icon',
  '/symbol',
];

async function test() {
  for (const fmt of formats) {
    try {
      const url = 'https://cdn.brandfetch.io/' + domain + fmt;
      const res = await fetch(url, { 
        method: 'GET', 
        redirect: 'follow',
        headers: { 
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      const ct = res.headers.get('content-type') || 'null';
      const isImage = ct.startsWith('image/');
      const body = await res.arrayBuffer();
      console.log((fmt || '/').padEnd(25), res.status, ct.padEnd(25), isImage ? 'IMAGE' : 'NOT-IMAGE', body.byteLength + 'b');
    } catch (e) {
      console.log((fmt || '/').padEnd(25), 'ERR', e.message);
    }
  }
}
test();
