export function parseNumber(raw: any): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;

  let s = String(raw).trim();
  if (!s) return null;

  // Accounting negatives: "(1,234)" or trailing "Dr"
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { negative = true; s = s.replace(/^-+/, ''); }
  s = s.replace(/\s*(Dr|Cr)\.?$/i, '');

  // Strip currency symbols / text
  s = s.replace(/[₹$€£]|Rs\.?|INR|USD/gi, '');
  // Strip commas and spaces
  s = s.replace(/[,\s]/g, '');
  // Strip trailing %
  s = s.replace(/%$/, '');

  // Lakh / crore suffixes
  let multiplier = 1;
  let m = s.match(/^(\d+(?:\.\d+)?)(L|Lakh|Lakhs)$/i);
  if (m) { multiplier = 100000; s = m[1]; }
  else {
    m = s.match(/^(\d+(?:\.\d+)?)(Cr|Crore|Crores)$/i);
    if (m) { multiplier = 10000000; s = m[1]; }
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  let num = parseFloat(s) * multiplier;
  if (negative) num = -num;
  return isFinite(num) ? num : null;
}

export function isValidQty(n: any): boolean {
  return typeof n === 'number' && isFinite(n) && n > 0;
}

export function isValidPrice(n: any): boolean {
  return typeof n === 'number' && isFinite(n) && n >= 0;
}
