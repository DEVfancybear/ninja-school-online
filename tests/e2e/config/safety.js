import { URL } from 'node:url';

export function validateE2eSafety({ databaseUrl, serverPort, clientPort }) {
  if (!databaseUrl) {
    throw new Error('NINJA_E2E_DATABASE_URL is required; refusing to use a development database.');
  }

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('NINJA_E2E_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('NINJA_E2E_DATABASE_URL must use PostgreSQL.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error(`Unsafe NINJA_E2E database host ${hostname}; only loopback is allowed.`);
  }
  if (url.pathname.slice(1) !== 'ninja_m7_e2e') {
    throw new Error('Dedicated E2E database must be exactly `ninja_m7_e2e`; refusing to run.');
  }

  for (const [name, port] of [['server', serverPort], ['client', clientPort]]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000 || port === 4200) {
      throw new Error(`Unsafe NINJA_E2E ${name} port ${port}; refusing development/invalid port.`);
    }
  }
  if (serverPort === clientPort) {
    throw new Error('NINJA_E2E server and client ports must be different.');
  }

  return { serverPort, clientPort };
}
