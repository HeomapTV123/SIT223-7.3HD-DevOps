import { execFileSync } from 'node:child_process';
import { X509Certificate, createHash, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const services = [
  { name: 'prometheus', uid: 65534, gid: 65534 },
  { name: 'alertmanager', uid: 65534, gid: 65534 },
  { name: 'grafana', uid: 472, gid: 0 },
];
const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
const publicKey = (key) => key.export({ type: 'spki', format: 'der' });

function installFile(directory, name, contents, mode, owner) {
  const temp = join(directory, name + '.' + randomBytes(8).toString('hex') + '.new');
  try {
    writeFileSync(temp, contents, { mode: 0o600, flag: 'wx' });
    chmodSync(temp, mode);
    if (owner) chownSync(temp, owner.uid, owner.gid);
    renameSync(temp, join(directory, name));
  } finally {
    rmSync(temp, { force: true });
  }
}

export function installMonitoringTls(directory, { setOwners = true } = {}) {
  const authority = join(directory, 'authority');
  const publicDirectory = join(directory, 'public');
  mkdirSync(authority, { recursive: true, mode: 0o700 });
  chmodSync(authority, 0o700);
  mkdirSync(publicDirectory, { recursive: true });
  chmodSync(publicDirectory, 0o755);
  const caKey = join(authority, 'ca.key');
  const caFile = join(authority, 'ca.crt');
  const scratch = mkdtempSync(join(authority, 'issuance-'));
  try {
    if (existsSync(caKey) !== existsSync(caFile)) throw new Error('The monitoring CA is incomplete; restore its private volume.');
    if (!existsSync(caKey)) {
      openssl('req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '3650',
        '-subj', '/CN=Taskboard local monitoring CA',
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-keyout', join(scratch, 'ca.key'), '-out', join(scratch, 'ca.crt'));
      installFile(authority, 'ca.key', readFileSync(join(scratch, 'ca.key')), 0o600);
      installFile(authority, 'ca.crt', readFileSync(join(scratch, 'ca.crt')), 0o644);
    }
    const caPem = readFileSync(caFile);
    const ca = new X509Certificate(caPem);
    if (!ca.ca || !ca.verify(ca.publicKey) || Date.parse(ca.validFrom) > Date.now()
      || Date.parse(ca.validTo) - Date.now() < 31 * 86400000) {
      throw new Error('The monitoring CA is invalid or expires soon; rotate it and update client trust.');
    }
    if (!publicKey(ca.publicKey).equals(publicKey(createPublicKey(createPrivateKey(readFileSync(caKey)))))) {
      throw new Error('The monitoring CA certificate and key do not match.');
    }
    const certificates = [];
    for (const service of services) {
      const destination = join(directory, service.name);
      mkdirSync(destination, { recursive: true });
      chmodSync(destination, 0o755);
      const keyFile = join(scratch, service.name + '.key');
      const csrFile = join(scratch, service.name + '.csr');
      const certFile = join(scratch, service.name + '.crt');
      const extensions = join(scratch, 'server.ext');
      writeFileSync(extensions, 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:'
        + service.name + ',DNS:sit223-hd-' + service.name + ',DNS:localhost,IP:127.0.0.1,IP:::1\n');
      openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
        '-subj', '/CN=' + service.name, '-keyout', keyFile, '-out', csrFile);
      openssl('x509', '-req', '-in', csrFile, '-CA', caFile, '-CAkey', caKey,
        '-set_serial', '0x' + randomBytes(16).toString('hex'), '-days', '30', '-sha256',
        '-extfile', extensions, '-out', certFile);
      openssl('verify', '-CAfile', caFile, '-verify_hostname', service.name, certFile);
      const certPem = readFileSync(certFile);
      const certificate = new X509Certificate(certPem);
      installFile(destination, 'server.key', readFileSync(keyFile), 0o600, setOwners ? service : undefined);
      installFile(destination, 'server.crt', certPem, 0o444);
      certificates.push({ service: service.name, fingerprint256: certificate.fingerprint256, validTo: certificate.validTo });
    }
    installFile(publicDirectory, 'ca.crt', caPem, 0o444);
    const metadata = { caFingerprint256: ca.fingerprint256,
      caFileSha256: createHash('sha256').update(caPem).digest('hex'), caValidTo: ca.validTo, certificates };
    installFile(publicDirectory, 'tls-info.json', JSON.stringify(metadata, null, 2) + '\n', 0o444);
    return metadata;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('TLS provisioning does not accept CLI arguments.');
    installMonitoringTls('/tls');
    console.log('Monitoring TLS certificates installed. Only public certificates and fingerprints may be archived.');
  } catch {
    console.error('Monitoring TLS setup failed. Check the CA volume, expiry, file permissions and OpenSSL installation.');
    process.exitCode = 1;
  }
}
