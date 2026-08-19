const STOPWORDS = new Set([
  'ltd', 'limited', 'india', 'ind', 'the', 'of', 'and', 'co', 'corp', 'corporation',
  'company', 'pvt', 'private', 'plc', 'inc', 'group', 'holdings', 'holding', 'l',
]);

export function normalizeCompany(str: string): string {
  return String(str ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w))
    .join(' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  
  a = a.slice(0, 40); b = b.slice(0, 40);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val1 = dp[i - 1]![j] ?? 0;
      const val2 = dp[i]![j - 1] ?? 0;
      const val3 = dp[i - 1]![j - 1] ?? 0;
      dp[i]![j] = Math.min(val1 + 1, val2 + 1, val3 + cost);
    }
  }
  return dp[a.length]![b.length] ?? 0;
}

export function fuzzyScore(query: string, candidate: string): number {
  const q = normalizeCompany(query);
  const c = normalizeCompany(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1.0;

  const qTokens = q.split(' ').filter(Boolean);
  const cTokens = c.split(' ').filter(Boolean);
  const cSet = new Set(cTokens);
  const inter = qTokens.filter(t => cSet.has(t));

  if (qTokens.length && inter.length === qTokens.length) return 0.9;
  if (cTokens.length && inter.length === cTokens.length) return 0.85;
  if (c.startsWith(q) || q.startsWith(c)) return 0.78;

  const coverage = qTokens.length ? inter.length / qTokens.length : 0;
  if (coverage >= 0.5) return 0.7 + coverage * 0.08;

  const dist = levenshtein(q, c);
  const maxLen = Math.max(q.length, c.length);
  const sim = 1 - dist / maxLen;
  if (sim >= 0.75) return sim * 0.75;
  return 0;
}
