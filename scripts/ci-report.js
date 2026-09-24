import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

mkdirSync('reports', { recursive: true });
for (const name of ['junit.xml', 'lcov.info']) rmSync(`reports/${name}`, { force: true });
const result = spawnSync(process.execPath, [
  '--test', '--experimental-test-coverage',
  '--test-coverage-include=src/**/*.js', '--test-coverage-exclude=src/server.js',
  '--test-coverage-include=scripts/smoke-deploy.mjs',
  '--test-coverage-include=scripts/configure-monitoring.mjs',
  '--test-coverage-include=scripts/check-monitoring.mjs',
  '--test-coverage-include=scripts/configure-monitoring-tls.mjs',
  '--test-coverage-lines=85', '--test-coverage-branches=75', '--test-coverage-functions=85',
  '--test-reporter=junit', '--test-reporter-destination=reports/junit.xml',
  '--test-reporter=lcov', '--test-reporter-destination=reports/lcov.info',
], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
try {
  const report = readFileSync('reports/junit.xml', 'utf8');
  const summary = [...report.matchAll(/<!-- (tests|pass|fail|cancelled|skipped|duration_ms) ([\d.]+) -->/g)]
    .map((match) => `${match[1]}: ${match[2]}`);
  console.log(summary.join(' | '));
  const coverage = readFileSync('reports/lcov.info', 'utf8');
  const sum = (key) => [...coverage.matchAll(new RegExp(`^${key}:(\\d+)$`, 'gm'))]
    .reduce((total, match) => total + Number(match[1]), 0);
  for (const [label, found, hit] of [['Lines', 'LF', 'LH'], ['Branches', 'BRF', 'BRH'], ['Functions', 'FNF', 'FNH']]) {
    const total = sum(found);
    console.log(`${label}: ${total ? (100 * sum(hit) / total).toFixed(2) : '0.00'}%`);
  }
  console.log('Reports: reports/junit.xml and reports/lcov.info');
  if (result.status !== 0) console.error(report);
} catch (error) {
  console.error(`Unable to read generated reports: ${error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
