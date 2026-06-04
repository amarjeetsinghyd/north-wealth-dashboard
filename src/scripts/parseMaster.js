import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.resolve(__dirname, '../../Company Master.csv');
const outputPath = path.resolve(__dirname, '../lib/companyMaster.json');

console.log(`Reading CSV from: ${csvPath}`);

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

try {
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/);
  
  if (lines.length === 0) {
    console.error('Empty CSV file!');
    process.exit(1);
  }

  const header = parseCSVLine(lines[0]);
  console.log('Headers detected:', header);
  // Headers: bsecode(0), nsesymbol(1), companyname(2), companyshortname(3), categoryname(4),
  //          isin(5), bsegroup(6), mcap(7), mcaptype(8), displaytype(9), sectorcode(10),
  //          sectorname(11), industrycode(12), industryname(13), bselistedflag(14),
  //          nselistedflag(15), BSEStatus(16), NSEStatus(17)

  const companies = [];
  const nseIndex = {};
  const bseIndex = {};
  const isinIndex = {};

  let parsedCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const row = parseCSVLine(line);
    if (row.length < 14) continue; // Invalid row

    const bsecode = row[0];
    const nsesymbol = row[1];
    const companyname = row[2];
    const shortname = row[3] || '';
    const isin = row[5] || '';
    const bsegroup = row[6] || '';
    const mcapRaw = row[7];
    const mcaptypeRaw = row[8];
    const sectorname = row[11];
    const industryname = row[13];
    const bseListedFlag = row[14] || '';
    const nseListedFlag = row[15] || '';
    const bseStatus = row[16] || '';
    const nseStatus = row[17] || '';

    // Standardize market cap category
    let mcaptype = 'Mid';
    if (mcaptypeRaw.toLowerCase().includes('large')) mcaptype = 'Large';
    if (mcaptypeRaw.toLowerCase().includes('small')) mcaptype = 'Small';

    const mcapVal = parseFloat(mcapRaw) || 0;

    // Create the expanded company tuple
    // Index: [0]name, [1]sector, [2]mcaptype, [3]mcapVal, [4]industry,
    //        [5]isin, [6]bsegroup, [7]shortname, [8]nseStatus, [9]bseStatus
    const companyTuple = [
      companyname,
      sectorname,
      mcaptype,
      mcapVal,
      industryname,
      isin,
      bsegroup,
      shortname,
      nseStatus.replace(/\r/g, ''),
      bseStatus.replace(/\r/g, '')
    ];

    const currentCompanyIdx = companies.length;
    companies.push(companyTuple);

    // Map NSE index if defined and active
    if (nsesymbol && nsesymbol !== 'undefined' && nsesymbol !== 'null') {
      const cleanedNse = nsesymbol.toUpperCase().trim();
      nseIndex[cleanedNse] = currentCompanyIdx;
    }

    // Map BSE index if defined
    if (bsecode && bsecode !== 'undefined' && bsecode !== 'null') {
      const cleanedBse = bsecode.toUpperCase().trim();
      bseIndex[cleanedBse] = currentCompanyIdx;
    }

    // Map ISIN index if defined
    if (isin && isin !== 'undefined' && isin !== 'null') {
      const cleanedIsin = isin.toUpperCase().trim();
      isinIndex[cleanedIsin] = currentCompanyIdx;
    }

    parsedCount++;
  }

  const outputData = {
    companies,
    nse: nseIndex,
    bse: bseIndex,
    isin: isinIndex
  };

  console.log(`Successfully parsed ${parsedCount} rows.`);
  console.log(`Total unique companies in output: ${companies.length}`);
  console.log(`Total NSE symbols indexed: ${Object.keys(nseIndex).length}`);
  console.log(`Total BSE codes indexed: ${Object.keys(bseIndex).length}`);
  console.log(`Total ISINs indexed: ${Object.keys(isinIndex).length}`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(outputData), 'utf8');
  console.log(`Output successfully written to: ${outputPath}`);

} catch (err) {
  console.error('Error processing Company Master CSV:', err);
}
