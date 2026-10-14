// Search folding: case- and accent-insensitive, Turkish-aware, and length-preserving
// (each UTF-16 unit maps to exactly one unit) so match indices map straight back to the original
// string for highlighting. "sifre" finds "Şifre", "istanbul" finds "İSTANBUL", "cafe" finds "café".
const SPECIAL = { İ: 'i', I: 'i', ı: 'i', ß: 's', æ: 'a', ø: 'o', ł: 'l', đ: 'd' };

export function fold(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    let m = SPECIAL[c];
    if (!m) {
      m = c.normalize('NFD')[0].toLowerCase();
      if (m.length !== 1) m = c;
    }
    out += m;
  }
  return out;
}

export function tokenize(query) {
  return fold(query).split(/\s+/).filter(Boolean);
}

export function haystack(item) {
  if (item.kind === 'image') return `image ${item.width}x${item.height} ${item.source}`;
  return item.text;
}

// Merged [start, end) ranges of every token occurrence in `text`.
export function matchRanges(text, tokens) {
  if (!tokens.length) return [];
  const folded = fold(text);
  const ranges = [];
  for (const t of tokens) {
    let from = 0;
    let idx;
    let guard = 0;
    while ((idx = folded.indexOf(t, from)) !== -1 && guard++ < 200) {
      ranges.push([idx, idx + t.length]);
      from = idx + t.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

// One-line preview for list rows, scrolled so the first match is visible.
export function snippet(text, tokens, length = 200) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!tokens.length) return flat.slice(0, length);
  const folded = fold(flat);
  const first = Math.min(...tokens.map((t) => folded.indexOf(t)).filter((i) => i >= 0), Infinity);
  const start = first !== Infinity && first > 40 ? first - 20 : 0;
  return (start ? '…' : '') + flat.slice(start, start + length);
}
