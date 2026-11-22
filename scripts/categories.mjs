// Star-list slugs ordered from most specific to most general.
// A repo in several lists is shown under the first matching one.
export const CATEGORY_ORDER = [
  'reverse-engineering',
  'artificial-intelligence',
  'game-development',
  'mobile-development',
  'desktop-development',
  'frontend-development',
  'backend-development',
  'general-programming',
  'developer-tools',
  'others',
];

export function primaryCategory(slugs) {
  return CATEGORY_ORDER.find((c) => slugs.includes(c)) ?? slugs[0] ?? 'uncategorized';
}
