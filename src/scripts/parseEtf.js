import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.resolve(__dirname, '../../ETF Master.csv');
const outputPath = path.resolve(__dirname, '../lib/etfMaster.json');

console.log(`Reading ETF CSV from: ${csvPath}`);

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Simple helper to clean quotes
const cleanQuotes = (str) => str.replace(/^"|"$/g, '').trim();

try {
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/);
  
  if (lines.length === 0) {
    console.error('Empty ETF CSV file!');
    process.exit(1);
  }

  const header = parseCSVLine(lines[0]);
  console.log('Headers detected:', header);
  // Headers: Equity_CMOTSCode(0), MF_CMOTSCode(1), mf_cocode(2), AMCName(3),
  //          ETFName(4), ISIN(5), ETFCategory(6), BSEListed(7), NSEListed(8)

  const etfs = [];
  const isinIndex = {};
  const tickerIndex = {};

  let parsedCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const row = parseCSVLine(line);
    if (row.length < 7) continue; // Invalid row

    const amcName = cleanQuotes(row[3]);
    const etfName = cleanQuotes(row[4]);
    const isin = cleanQuotes(row[5]);
    const etfCategory = cleanQuotes(row[6]);
    const bseListed = row[7] ? cleanQuotes(row[7]) : '';
    const nseListed = row[8] ? cleanQuotes(row[8]) : '';

    if (!isin || isin === 'undefined') continue;

    // Determine Ticker from Name (smart mapping for common ones)
    let ticker = null;
    const nameLower = etfName.toLowerCase();

    if (nameLower.includes('gold bees') || nameLower.includes('goldbees')) ticker = 'GOLDBEES';
    else if (nameLower.includes('silver bees') || nameLower.includes('silverbees')) ticker = 'SILVERBEES';
    else if (nameLower.includes('junior bees') || nameLower.includes('juniorbees') || nameLower.includes('next 50 junior')) ticker = 'JUNIORBEES';
    else if (nameLower.includes('liquid bees') || nameLower.includes('liquidbees') || nameLower.includes('1d rate liquid')) ticker = 'LIQUIDBEES';
    else if (nameLower.includes('nifty 50 bees') || nameLower.includes('nifty bees')) ticker = 'NIFTYBEES';
    else if (nameLower.includes('bank bees') || nameLower.includes('bankbees') || nameLower.includes('nifty bank bees')) ticker = 'BANKBEES';
    else if (nameLower.includes('it bees') || nameLower.includes('itbees')) ticker = 'ITBEES';
    else if (nameLower.includes('hang seng bees') || nameLower.includes('hangsengbees')) ticker = 'HANGSENGBEES';
    else if (nameLower.includes('pharma bees') || nameLower.includes('pharmabees')) ticker = 'PHARMABEES';
    else if (nameLower.includes('infra bees') || nameLower.includes('infrabees')) ticker = 'INFRABEES';
    else if (nameLower.includes('consumption bees') || nameLower.includes('consumptionbees')) ticker = 'CONSUMPTIONBEES';
    else if (nameLower.includes('monifty50')) ticker = 'MONIFTY50';
    else if (nameLower.includes('nifty100')) ticker = 'NIFTY100';
    else if (nameLower.includes('midcap100')) ticker = 'MIDCAP100';
    else if (nameLower.includes('nasdaq 100') || nameLower.includes('nasdaq100')) ticker = 'MONASDAQ100';

    // Expanded ETF tuple: [etfName, category, amcName]
    const etfTuple = [
      etfName,
      etfCategory,
      amcName
    ];

    const currentEtfIdx = etfs.length;
    etfs.push(etfTuple);

    // Map ISIN index
    const cleanedIsin = isin.toUpperCase().trim();
    isinIndex[cleanedIsin] = currentEtfIdx;

    // Map Ticker index if matched
    if (ticker) {
      tickerIndex[ticker] = currentEtfIdx;
    }

    parsedCount++;
  }

  const outputData = {
    etfs,
    isin: isinIndex,
    ticker: tickerIndex
  };

  console.log(`Successfully parsed ${parsedCount} ETFs.`);
  console.log(`Total unique ETFs in output: ${etfs.length}`);
  console.log(`Total ISINs indexed: ${Object.keys(isinIndex).length}`);
  console.log(`Total Tickers auto-indexed: ${Object.keys(tickerIndex).length}`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(outputData), 'utf8');
  console.log(`ETF Output successfully written to: ${outputPath}`);

} catch (err) {
  console.error('Error processing ETF Master CSV:', err);
}
