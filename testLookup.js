import { getStockMeta } from './src/lib/sectorMap.ts';

const testSymbols = [
  'EXIDEIND',
  'PENINLAND',
  'TITAN',
  'WIPRO',
  'HINDALCO',
  'LT',
  'TATACHEM',
  'BLUESTARCO',
  '500086', // Exide BSE
  '500114', // Titan BSE
  'NIFTYBEES',
  'LIQUIDBEES',
  'INVALID_SYMBOL'
];

console.log('Testing Stock Meta Lookups:\n');

testSymbols.forEach(sym => {
  const meta = getStockMeta(sym);
  console.log(`Symbol: ${sym}`);
  console.log(`  Company name: ${meta.industry ? 'Mapped' : 'Default'}`);
  console.log(`  Sector:       ${meta.sector}`);
  console.log(`  Market Cap:   ${meta.marketCap}`);
  console.log(`  Asset Class:  ${meta.assetClass}`);
  if (meta.industry) {
    console.log(`  Industry:     ${meta.industry}`);
  }
  console.log('----------------------------------------');
});
