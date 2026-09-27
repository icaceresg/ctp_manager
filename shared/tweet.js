// Longitud de un texto tal como la cuenta X (twitter-text v3): la mayoría de
// caracteres latinos cuentan 1, CJK y emojis cuentan 2 y cada enlace cuenta 23.

const LIGHT_RANGES = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];
const URL_WEIGHT = 23;

const TLDS =
  'com|net|org|io|es|co|ai|dev|app|me|ly|gl|tv|info|biz|xyz|us|uk|de|fr|it|mx|ar|cl|pe|ve|ec|uy|py|bo|cr|pa|gt|hn|sv|ni|do|pr|cu|br|pt|eu|edu|gov|link|site|online|store|shop|blog|news|tech|page|so|gg|fm|to|be|ch|nl|ca|au|in|jp|cn|ru|cat|gal|eus';

const URL_RE = new RegExp(
  `(?<![\\p{L}\\p{N}@._-])(?:https?:\\/\\/[^\\s]+|(?:www\\.)?(?:[\\p{L}\\p{N}-]+\\.)+(?:${TLDS})(?![\\p{L}\\p{N}])(?::\\d+)?(?:\\/[^\\s]*)?)`,
  'giu',
);
const TRAILING_PUNCT = /[.,;:!?'")\]}¡¿…]+$/u;
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('es', { granularity: 'grapheme' }) : null;

function charWeight(cp) {
  for (const [start, end] of LIGHT_RANGES) {
    if (cp >= start && cp <= end) return 1;
  }
  return 2;
}

function weighPlainText(text) {
  if (!text) return 0;
  let total = 0;
  const graphemes = segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
  for (const g of graphemes) {
    const first = g.codePointAt(0);
    if (EMOJI_RE.test(g) && (first > 4351 || g.includes('️') || g.length > 2)) {
      total += 2;
      continue;
    }
    for (const ch of g) total += charWeight(ch.codePointAt(0));
  }
  return total;
}

/** Enlaces que X detectaría en el texto. */
export function extractUrls(text = '') {
  const urls = [];
  for (const m of String(text).normalize('NFC').matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING_PUNCT, '');
    if (url) urls.push({ url, index: m.index });
  }
  return urls;
}

export function tweetLength(text = '') {
  const t = String(text).normalize('NFC');
  let total = 0;
  let last = 0;
  for (const { url, index } of extractUrls(t)) {
    total += weighPlainText(t.slice(last, index)) + URL_WEIGHT;
    last = index + url.length;
  }
  return total + weighPlainText(t.slice(last));
}
