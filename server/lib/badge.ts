export interface BadgeInput {
  performance: number;
  budget: 'pass' | 'fail' | 'none';
}

const GOOD = '#0cce6b';
const OK = '#ffa400';
const POOR = '#ff4e42';
const NEUTRAL = '#9aa0a6';

// Approximate width of Verdana 11px text; close enough for a badge and needs no font metrics.
const textWidth = (text: string) => Math.round(text.length * 6.6) + 12;

/** A small shields-style SVG. `null` renders a neutral "no data" badge so an embed never breaks. */
export function renderBadge(input: BadgeInput | null): string {
  const label = 'web vitals';
  let value = 'no data';
  let color = NEUTRAL;
  if (input) {
    const suffix = input.budget === 'pass' ? ' · budget met' : input.budget === 'fail' ? ' · over budget' : '';
    value = `${input.performance}${suffix}`;
    color = input.budget === 'fail' ? POOR : input.performance >= 90 ? GOOD : input.performance >= 50 ? OK : POOR;
  }
  const lw = textWidth(label);
  const vw = textWidth(value);
  const w = lw + vw;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">` +
    `<title>${label}: ${value}</title>` +
    `<clipPath id="r"><rect width="${w}" height="20" rx="3"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#30363d"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${lw / 2}" y="14">${label}</text><text x="${lw + vw / 2}" y="14" fill="#0d1117">${value}</text></g>` +
    `</svg>`
  );
}
