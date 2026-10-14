import { describe, expect, it } from 'vitest';
import { fold, haystack, matchRanges, snippet, tokenize } from '../src/search.js';

describe('fold', () => {
  it('folds Turkish letters both ways', () => {
    expect(fold('Şifre')).toBe('sifre');
    expect(fold('İSTANBUL')).toBe('istanbul');
    expect(fold('ılık ÇAĞ')).toBe('ilik cag');
    expect(fold('Öğrenci Ünvanı')).toBe('ogrenci unvani');
  });

  it('removes accents and folds special letters', () => {
    expect(fold('Café Crème')).toBe('cafe creme');
    expect(fold('Straße')).toBe('strase'); // ß → s: one unit for one unit, never "ss"
    expect(fold('Łódź')).toBe('lodz');
  });

  it('folds the special letters in upper case too', () => {
    expect(fold('ŁÆØĐẞ')).toBe(fold('łæøđß'));
  });

  // Highlighting maps match positions straight back onto the original string, so folding
  // must never change the length. toLowerCase() would: 'İ'.toLowerCase() is two units.
  it.each(['İstanbul', 'ŞİŞLİ', 'café', 'naïve', 'Straße', '😀 emoji 👋', 'ﬁ ligature', ''])(
    'keeps the length of %j',
    (s) => {
      expect(fold(s)).toHaveLength(s.length);
    }
  );
});

describe('tokenize', () => {
  it('folds the query and splits on any whitespace', () => {
    expect(tokenize('  Şifre\tİstanbul\n cafe ')).toEqual(['sifre', 'istanbul', 'cafe']);
  });

  it('returns nothing for an empty or blank query', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('matchRanges', () => {
  it('finds a folded token in the original text', () => {
    const text = 'Yeni Şifre: 1234';
    const [[a, b]] = matchRanges(text, tokenize('sifre'));
    expect(text.slice(a, b)).toBe('Şifre');
  });

  it('finds every occurrence of every token, sorted', () => {
    expect(matchRanges('ab ab cd', ['ab', 'cd'])).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
  });

  it('merges overlapping and touching ranges', () => {
    expect(matchRanges('abcdef', ['abc', 'cde'])).toEqual([[0, 5]]);
    expect(matchRanges('abcdef', ['abc', 'def'])).toEqual([[0, 6]]);
  });

  it('returns nothing without tokens or without a match', () => {
    expect(matchRanges('anything', [])).toEqual([]);
    expect(matchRanges('anything', ['zzz'])).toEqual([]);
  });
});

describe('snippet', () => {
  it('flattens whitespace into one line', () => {
    expect(snippet('first line\n\n  second\tline  ', [])).toBe('first line second line');
  });

  it('caps the length', () => {
    expect(snippet('x'.repeat(500), [])).toHaveLength(200);
    expect(snippet('x'.repeat(500), [], 50)).toHaveLength(50);
  });

  it('scrolls a far-away match into view, with an ellipsis', () => {
    const text = 'a'.repeat(100) + ' needle here';
    const s = snippet(text, ['needle']);
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('needle');
  });

  it('starts at the beginning when the match is already near it', () => {
    expect(snippet('short needle text', ['needle'])).toBe('short needle text');
  });
});

describe('haystack', () => {
  it('searches text items by their text', () => {
    expect(haystack({ kind: 'text', text: 'hello' })).toBe('hello');
    expect(haystack({ kind: 'link', text: 'https://x.dev' })).toBe('https://x.dev');
  });

  it('makes images findable by "image", size and source app', () => {
    const h = haystack({ kind: 'image', width: 1280, height: 720, source: 'SnippingTool' });
    expect(h).toContain('image');
    expect(h).toContain('1280x720');
    expect(h).toContain('SnippingTool');
  });
});
