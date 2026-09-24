import { chmodSync, chownSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const plain = (value, name) => {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) throw new Error(`${name} is required and must be a single line.`);
  return value.trim();
};
const mailbox = (value, name) => {
  const result = plain(value, name);
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(result) || result.includes('{{')) {
    throw new Error(`${name} must be one plain email address.`);
  }
  return result;
};

export function emailConfiguration(env) {
  const smarthost = plain(env.SMTP_SMARTHOST, 'SMTP_SMARTHOST');
  const match = /^([A-Za-z0-9.-]+):(\d{1,5})$/.exec(smarthost);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535 || Number(match[2]) === 465) {
    throw new Error('SMTP_SMARTHOST must be host:port for STARTTLS, typically port 587; implicit TLS on 465 is unsupported.');
  }
  const username = plain(env.SMTP_USERNAME, 'SMTP username');
  const from = mailbox(env.SMTP_FROM?.trim() || username, 'SMTP_FROM');
  const to = mailbox(env.ALERT_EMAIL_TO, 'ALERT_EMAIL_TO');
  if (typeof env.SMTP_PASSWORD !== 'string' || !env.SMTP_PASSWORD || /[\r\n\0]/.test(env.SMTP_PASSWORD)) {
    throw new Error('The Jenkins SMTP password credential is missing or contains a line break.');
  }
  const email = { to, send_resolved: true,
    headers: { Subject: '[Taskboard {{ .Status | toUpper }}] {{ .CommonLabels.alertname }}' } };
  return {
    global: { smtp_smarthost: smarthost, smtp_from: from, smtp_auth_username: username,
      smtp_auth_password_file: '/etc/alertmanager/private/smtp-password', smtp_require_tls: true,
      resolve_timeout: '1m' },
    route: { receiver: 'production-email', group_by: ['alertname', 'environment'],
      group_wait: '10s', group_interval: '15s', repeat_interval: '1h',
      routes: [{ receiver: 'availability-email', matchers: ['alertname="TaskboardDown"'] }] },
    receivers: [{ name: 'production-email', email_configs: [email] },
      { name: 'availability-email', email_configs: [email] }],
  };
}

export function installEmailConfiguration(directory, env, owner) {
  const config = emailConfiguration(env); // Validate everything before modifying existing files.
  mkdirSync(directory, { recursive: true });
  for (const [name, contents, mode] of [
    ['smtp-password', env.SMTP_PASSWORD, 0o400],
    ['alertmanager.yml', `${JSON.stringify(config, null, 2)}\n`, 0o444],
  ]) {
    const temp = join(directory, `${name}.${randomUUID()}.new`);
    try {
      writeFileSync(temp, contents, { mode: 0o600, flag: 'wx' });
      chmodSync(temp, mode);
      if (owner !== undefined) chownSync(temp, owner, owner);
      renameSync(temp, join(directory, name));
    } finally {
      rmSync(temp, { force: true });
    }
  }
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] !== '/private') throw new Error('Expected the private configuration volume at /private.');
    installEmailConfiguration('/private', process.env, 65534);
    console.log('Monitoring email configuration installed. Password remains in the private Docker volume.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
