import selfsigned from 'selfsigned';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Self-signed cert for localhost so the server can speak HTTPS (the cobrowse room
 * forces https/wss to our proxy origin). Persisted to server/.cert/ so it survives
 * restarts — trust it once in the browser and it stays trusted.
 */
const certDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.cert');
const keyPath = path.join(certDir, 'localhost-key.pem');
const certPath = path.join(certDir, 'localhost-cert.pem');

export async function makeSelfSignedCert(): Promise<{ key: string; cert: string }> {
  // Reuse the persisted cert if present.
  try {
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
    }
  } catch {
    /* fall through to regenerate */
  }

  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' }, // DNS
          { type: 7, ip: '127.0.0.1' }, // IPv4
        ],
      },
    ],
  });

  // Persist for next boot (best-effort).
  try {
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);
  } catch (err) {
    console.warn('[self-cert] could not persist cert:', err instanceof Error ? err.message : err);
  }

  return { key: pems.private, cert: pems.cert };
}
