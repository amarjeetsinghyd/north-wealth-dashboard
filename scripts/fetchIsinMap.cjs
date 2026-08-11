const https = require('https');
const fs = require('fs');

async function downloadBhavcopy() {
  const date = new Date();
  for (let offset = 0; offset < 10; offset++) {
    const target = new Date(date.getTime() - offset * 24 * 60 * 60 * 1000);
    const dd = String(target.getDate()).padStart(2, '0');
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const yyyy = target.getFullYear();
    const dateStr = `${dd}${mm}${yyyy}`;
    
    console.log(`Trying ${dateStr}...`);
    const url = `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${dateStr}.csv`;
    
    try {
      const data = await new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Status ${res.statusCode}`));
            return;
          }
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve(body));
        }).on('error', reject);
      });
      
      return data;
    } catch (e) {
      console.log(`Not found for ${dateStr}`);
    }
  }
  throw new Error("Could not find Bhavcopy");
}

async function main() {
  const csvData = await downloadBhavcopy();
  const lines = csvData.split('\n');
  const isinMap = {};
  
  const headers = lines[0].split(',').map(h => h.trim());
  const symIdx = headers.indexOf('SYMBOL');
  const seriesIdx = headers.indexOf('SERIES');
  const isinIdx = headers.indexOf('ISIN');
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split(',').map(c => c.trim());
    const series = cols[seriesIdx];
    if (['EQ', 'BE', 'BZ', 'SM', 'ST', 'GS'].includes(series)) {
      const symbol = cols[symIdx];
      const isin = cols[isinIdx];
      if (isin && symbol) {
        isinMap[isin] = symbol;
      }
    }
  }
  
  fs.writeFileSync('src/lib/isinMap.json', JSON.stringify(isinMap, null, 2));
  console.log(`Successfully generated isinMap.json with ${Object.keys(isinMap).length} entries.`);
}

main().catch(console.error);
