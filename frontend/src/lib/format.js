/*
 * Locale-aware formatters. All money values across the app use Italian
 * thousand/decimal separators: 1234.5 → "1.234,50$".
 *
 * For raw integer/decimal counts (views, clicks, subs) keep using the
 * compact formatNum helpers that already exist per-page — those abbreviate
 * to K/M for readability and don't carry a currency.
 */

const itMoney = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const itPlain = new Intl.NumberFormat('it-IT');

// "1.234,56$"  ·  null/NaN → "—"
export function formatUSD(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${itMoney.format(Number(n))}$`;
}

// Same, but lets you override the currency symbol if a row carries
// something non-USD (we already store currency per Infloww link).
export function formatMoney(n, symbol = '$') {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const s = symbol === 'USD' ? '$' : symbol;
  return `${itMoney.format(Number(n))}${s}`;
}

// Integer with IT thousands separators (no decimals): 1234 → "1.234"
export function formatIntIT(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return itPlain.format(Math.round(Number(n)));
}
