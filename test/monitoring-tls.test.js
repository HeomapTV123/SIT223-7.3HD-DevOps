import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { installMonitoringTls } from '../scripts/configure-monitoring-tls.mjs';

test('TLS provisioning isolates private keys, signs service identities and renews leaves under the same CA', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'taskboard-ca-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = installMonitoringTls(directory, { setOwners: false });
  const ca = new X509Certificate(readFileSync(join(directory, 'public/ca.crt')));
  assert.ok(ca.ca);
  assert.equal(first.caFileSha256, createHash('sha256').update(readFileSync(join(directory, 'public/ca.crt'))).digest('hex'));
  assert.deepEqual(readdirSync(join(directory, 'public')).sort(), ['ca.crt', 'tls-info.json']);
  assert.deepEqual(readdirSync(join(directory, 'authority')).sort(), ['ca.crt', 'ca.key']);
  for (const service of ['prometheus', 'alertmanager', 'grafana']) {
    const cert = new X509Certificate(readFileSync(join(directory, service, 'server.crt')));
    assert.ok(cert.verify(ca.publicKey));
    assert.equal(cert.ca, false);
    assert.equal(cert.checkHost(service), service);
    assert.equal(cert.checkHost('localhost'), 'localhost');
    assert.equal(cert.checkIP('127.0.0.1'), '127.0.0.1');
    assert.equal(cert.checkHost('unrelated.example'), undefined);
    assert.ok(Date.parse(cert.validTo) - Date.now() > 29 * 86400000);
    if (process.platform !== 'win32') assert.equal(statSync(join(directory, service, 'server.key')).mode & 0o777, 0o600);
  }
  const firstKey = readFileSync(join(directory, 'prometheus/server.key'), 'utf8');
  const second = installMonitoringTls(directory, { setOwners: false });
  assert.equal(second.caFingerprint256, first.caFingerprint256);
  assert.notEqual(second.certificates[0].fingerprint256, first.certificates[0].fingerprint256);
  assert.notEqual(readFileSync(join(directory, 'prometheus/server.key'), 'utf8'), firstKey);
  assert.equal(readFileSync(join(directory, 'public/tls-info.json'), 'utf8').includes('PRIVATE KEY'), false);
  const caKey = readFileSync(join(directory, 'authority/ca.key'));
  const caCert = readFileSync(join(directory, 'authority/ca.crt'));
  writeFileSync(join(directory, 'authority/ca.key'), firstKey);
  assert.throws(() => installMonitoringTls(directory, { setOwners: false }), /do not match/);
  writeFileSync(join(directory, 'authority/ca.key'), caKey);
  writeFileSync(join(directory, 'authority/ca.crt'), readFileSync(join(directory, 'prometheus/server.crt')));
  assert.throws(() => installMonitoringTls(directory, { setOwners: false }), /invalid or expires soon/);
  writeFileSync(join(directory, 'authority/ca.crt'), caCert);
  assert.deepEqual(readdirSync(join(directory, 'authority')).sort(), ['ca.crt', 'ca.key']);
});

test('TLS provisioning fails on an incomplete CA instead of silently replacing trusted identity', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'taskboard-bad-ca-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'authority'));
  writeFileSync(join(directory, 'authority/ca.crt'), 'incomplete');
  assert.throws(() => installMonitoringTls(directory, { setOwners: false }), /incomplete/);
  assert.deepEqual(readdirSync(join(directory, 'authority')), ['ca.crt']);
});

test('TLS provisioning ignores an OpenSSL executable supplied through PATH', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'taskboard-shadow-openssl-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const untrustedBin = join(directory, 'bin');
  mkdirSync(untrustedBin);
  writeFileSync(join(untrustedBin, 'openssl'), '#!/bin/sh\nprintf "Unexpected OpenSSL from PATH\\n" >&2\nexit 99\n', { mode: 0o755 });
  const certificateDirectory = join(directory, 'certificates');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { installMonitoringTls } from './scripts/configure-monitoring-tls.mjs'; installMonitoringTls(process.argv[1], { setOwners: false });",
    certificateDirectory], {
    env: { ...process.env, PATH: untrustedBin }, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const ca = new X509Certificate(readFileSync(join(certificateDirectory, 'public/ca.crt')));
  const certificate = new X509Certificate(readFileSync(join(certificateDirectory, 'prometheus/server.crt')));
  assert.ok(certificate.verify(ca.publicKey));
  assert.equal(certificate.checkHost('prometheus'), 'prometheus');
});

test('TLS provisioning CLI rejects supplied paths before accessing any certificate volume', () => {
  const result = spawnSync(process.execPath, ['scripts/configure-monitoring-tls.mjs', '../../untrusted'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Monitoring TLS setup failed/);
  assert.equal(result.stderr.includes('untrusted'), false);
});
