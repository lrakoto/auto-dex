// Trigram fuzzy-match helpers used by /suggest and /search.
// If the cars table ever grows large, Postgres pg_trgm can replace this.

function makeTrigrams(s) {
  const set = new Set();
  for (let i = 0; i <= s.length - 3; i++) set.add(s.slice(i, i + 3));
  return set;
}

function trigramSim(a, b) {
  const ta = makeTrigrams(a), tb = makeTrigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0; // too short for trigrams — skip
  let inter = 0;
  ta.forEach(t => { if (tb.has(t)) inter++; });
  return (2 * inter) / (ta.size + tb.size);
}

function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 1;
  const words = t.split(/[\s\-]+/);
  return Math.max(trigramSim(q, t), ...words.map(w => trigramSim(q, w)));
}

module.exports = { makeTrigrams, trigramSim, fuzzyScore };
