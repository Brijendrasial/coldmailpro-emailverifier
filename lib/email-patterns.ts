export type EmailPattern = {
  key: string;
  label: string;
  prior: number;
  build: (first: string, last: string) => string;
};

export const EMAIL_PATTERNS: EmailPattern[] = [
  { key: 'first.last', label: 'firstname.lastname', prior: 64, build: (f,l) => `${f}.${l}` },
  { key: 'first', label: 'firstname', prior: 62, build: (f) => f },
  { key: 'flast', label: 'firstinitiallastname', prior: 60, build: (f,l) => `${f[0]}${l}` },
  { key: 'firstlast', label: 'firstnamelastname', prior: 56, build: (f,l) => `${f}${l}` },
  { key: 'firstl', label: 'firstname + lastinitial', prior: 52, build: (f,l) => `${f}${l[0]}` },
  { key: 'f.last', label: 'firstinitial.lastname', prior: 50, build: (f,l) => `${f[0]}.${l}` },
  { key: 'first_last', label: 'firstname_lastname', prior: 45, build: (f,l) => `${f}_${l}` },
  { key: 'first-last', label: 'firstname-lastname', prior: 43, build: (f,l) => `${f}-${l}` },
  { key: 'last.first', label: 'lastname.firstname', prior: 38, build: (f,l) => `${l}.${f}` },
  { key: 'lastfirst', label: 'lastnamefirstname', prior: 35, build: (f,l) => `${l}${f}` },
  { key: 'lastf', label: 'lastname + firstinitial', prior: 32, build: (f,l) => `${l}${f[0]}` },
];

export function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function generatePatternCandidates(name: string, domain: string) {
  const parts = normalizeName(name);
  const first = parts[0] || '';
  const last = parts.length > 1 ? parts.at(-1) || '' : '';
  if (!first || !last) return [];

  const seen = new Set<string>();
  const output: Array<{ pattern: string; label: string; prior: number; email: string; local: string }> = [];

  for (const pattern of EMAIL_PATTERNS) {
    const local = pattern.build(first, last).toLowerCase();
    if (!local || seen.has(local)) continue;
    seen.add(local);
    output.push({ pattern: pattern.key, label: pattern.label, prior: pattern.prior, local, email: `${local}@${domain}` });
  }

  return output;
}

export function identifyPattern(name: string, email: string) {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  const local = email.split('@')[0]?.toLowerCase() || '';
  if (!domain || !local) return null;
  return generatePatternCandidates(name, domain).find((candidate) => candidate.local === local) || null;
}
