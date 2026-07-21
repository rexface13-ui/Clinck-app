/**
 * Chars Arabic speakers routinely mix up when typing (أ/إ/آ/ا, ة/ه, ى/ي,
 * ؤ/و, ئ/ي) collapsed to one canonical form, so client-side search doesn't
 * require the exact variant. Mirrors backend/app/Support/Arabic.php.
 */
const MAP: Record<string, string> = {
  'أ': 'ا',
  'إ': 'ا',
  'آ': 'ا',
  'ٱ': 'ا',
  'ة': 'ه',
  'ى': 'ي',
  'ؤ': 'و',
  'ئ': 'ي',
}

export function normalizeArabic(text: string): string {
  return text.replace(/[أإآٱةىؤئ]/g, (ch) => MAP[ch] ?? ch)
}
