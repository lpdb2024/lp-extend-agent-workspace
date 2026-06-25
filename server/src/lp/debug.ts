/**
 * Verbose cobrowse/flow tracing, off by default. Enable with COBROWSE_DEBUG=1 to see
 * the full handshake → createSN → accept → room-auth → proxy → WS-bridge sequence
 * (handy when adapting this to another account/region). Errors are logged regardless
 * via console.warn at the call sites.
 */
const ON = process.env.COBROWSE_DEBUG === '1' || process.env.COBROWSE_DEBUG === 'true';

export function dbg(...args: unknown[]): void {
  if (ON) console.log(...args);
}
