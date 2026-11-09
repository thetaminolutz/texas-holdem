// Runs Lighthouse (v11, which still has the PWA category) against `vite preview` and prints a summary.
// Usage: npm run build && npm run preview (in another shell) && npm run lighthouse
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const chrome = process.env.CHROME_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const out = 'lighthouse-report.json';
execFileSync(
  'npx',
  ['lighthouse', url, '--only-categories=pwa,performance,accessibility,best-practices', '--output=json', `--output-path=${out}`, '--chrome-flags=--headless=new --no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader', '--form-factor=desktop', '--screenEmulation.disabled', '--quiet'],
  { stdio: 'inherit', env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) } },
);
const r = JSON.parse(readFileSync(out, 'utf8'));
const lines: string[] = ['### Lighthouse (v11) results', '', '| Category | Score |', '|---|---:|'];
for (const c of Object.values<any>(r.categories)) lines.push(`| ${c.title} | ${c.score === null ? 'n/a' : Math.round(c.score * 100)} |`);
lines.push('', '**PWA audits**', '');
for (const ref of r.categories.pwa?.auditRefs ?? []) {
  const a = r.audits[ref.id];
  if (!a || a.scoreDisplayMode === 'manual') continue;
  lines.push(`- ${a.score === 1 ? '✅' : a.score === null ? '➖' : '❌'} ${a.title}`);
}
const md = lines.join('\n');
writeFileSync('lighthouse-summary.md', md + '\n');
console.log(md);
