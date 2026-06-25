#!/usr/bin/env node

// ESM — this package is "type": "module", so use imports (not require).
import { execSync } from 'node:child_process';
import os from 'node:os';

// Clear every port this app uses before (re)starting, so stale dev instances don't
// linger and fight over ports:
//   8787 — Express HTTP API   9443 — HTTPS (cobrowse room proxy)   9400 — Vite UI
const PORTS = [
  process.env.PORT || 8787,
  process.env.COBROWSE_HTTPS_PORT || 9443,
  process.env.CLIENT_PORT || 9400,
];
const platform = os.platform();

function killPort(port) {
  console.log(`[kill-port] Checking for processes on port ${port}...`);
  try {
    if (platform === 'win32') {
      // Only match LISTENING rows on the exact port — avoids killing outbound
      // connections that happen to talk to the port from elsewhere.
      const output = execSync(`netstat -ano -p tcp`, { encoding: 'utf-8' });
      // Match LISTENING rows where the LOCAL address ends in :<port>, covering both
      // IPv4 (0.0.0.0:9400) and IPv6 ([::]:9400 / [::1]:9400) bindings.
      const re = new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'gm');
      const pids = new Set();
      let m;
      while ((m = re.exec(output)) !== null) pids.add(m[1]);

      if (pids.size > 0) {
        console.log(`[kill-port] Found ${pids.size} process(es) listening on :${port}`);
        pids.forEach((pid) => {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            console.log(`[kill-port] Killed PID ${pid} on :${port}`);
          } catch { /* already dead */ }
        });
      } else {
        console.log(`[kill-port] Port ${port} is free`);
      }
    } else {
      try {
        const output = execSync(`lsof -ti:${port}`, { encoding: 'utf-8' });
        const pids = output.trim().split('\n').filter((p) => p);
        if (pids.length > 0) {
          console.log(`[kill-port] Found ${pids.length} process(es) on port ${port}`);
          pids.forEach((pid) => {
            try {
              execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
              console.log(`[kill-port] Killed PID ${pid} on :${port}`);
            } catch { /* already dead */ }
          });
        } else {
          console.log(`[kill-port] Port ${port} is free`);
        }
      } catch (err) {
        if (err.status === 1) console.log(`[kill-port] Port ${port} is free`);
        else throw err;
      }
    }
  } catch (error) {
    console.error(`[kill-port] Error clearing ${port}: ${error.message}`);
  }
}

for (const port of PORTS) killPort(port);
console.log(`[kill-port] Ports [${PORTS.join(', ')}] cleared.`);
