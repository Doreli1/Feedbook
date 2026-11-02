#!/usr/bin/env node
// Run with `pnpm refresh-lan` whenever the mobile app or web admin can't
// reach the local Supabase stack (login/connection errors, NoRouteToHost on
// the phone, etc.). This machine's LAN IP changes across reboots/network
// switches, and it's hardcoded in three places that must stay in sync:
// apps/mobile/.env.local, apps/web/.env.development.local and
// supabase/functions/.env — see the comments in those files for why
// (a phone/the Docker container can't resolve "localhost" of this PC).
//
// This script detects the current Wi-Fi IPv4 address, rewrites the
// EXPO_PUBLIC_SUPABASE_URL / VITE_SUPABASE_URL / PUBLIC_SUPABASE_URL lines
// in those three files (only the functional `http://<ip>:<port>` value —
// it does not try to rewrite the hand-written history comments above each
// one), repairs any already-stored dish/logo/kosher-certificate photo URLs
// in the local DB that baked in the previous IP (storage URLs are absolute
// and get persisted as-is at upload time — see getPublicUrl() usage in
// apps/web's MenuManager.tsx/RestaurantDetails — so every past upload is a
// dead link once the IP moves), then kills and restarts both dev servers
// (Metro on 8081, Vite on 5173) so the new value actually takes effect.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const root = path.join(__dirname, '..');
const PORT_METRO = 8081;
const PORT_VITE = 5173;
const SUPABASE_PORT = 55321;

function detectLanIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue; // APIPA
      if (/vEthernet|Loopback|Hyper-V|WSL/i.test(name)) continue; // virtual switches
      candidates.push({ name, address: addr.address });
    }
  }
  const wifi = candidates.find((c) => /wi-?fi/i.test(c.name));
  if (wifi) return wifi;
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new Error('No non-virtual IPv4 LAN address found. Are you connected to Wi-Fi/Ethernet?');
  }
  throw new Error(
    `Multiple candidate LAN interfaces found, none named Wi-Fi: ${candidates
      .map((c) => `${c.name}=${c.address}`)
      .join(', ')}. Edit this script to pick the right one.`,
  );
}

function updateEnvFile(file, varName) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    console.warn(`[refresh-lan-ip] skipping ${file} — not found`);
    return { changed: false, oldIp: null };
  }
  const text = fs.readFileSync(full, 'utf8');
  const re = new RegExp(`^(${varName}=https?://)(\\d{1,3}(?:\\.\\d{1,3}){3})(:\\d+)`, 'm');
  const match = text.match(re);
  if (!match) {
    console.warn(`[refresh-lan-ip] ${file}: couldn't find a ${varName}=http://<ip>:<port> line, left untouched`);
    return { changed: false, oldIp: null };
  }
  const oldIp = match[2];
  if (oldIp === lanIp) return { changed: false, oldIp };
  const updated = text.replace(re, `$1${lanIp}$3`);
  fs.writeFileSync(full, updated);
  console.log(`[refresh-lan-ip] ${file}: ${varName} -> ${lanIp}`);
  return { changed: true, oldIp };
}

// Storage URLs baked into dish photos / restaurant logos / kosher
// certificates at upload time, now pointing at a dead IP — repaired via the
// same `replace()` approach validated manually on 2026-11-01. Best-effort:
// if Docker/the local DB container isn't running, this just logs and moves
// on (nothing else in this script depends on it).
function fixStoredPhotoUrls(oldIp, newIp) {
  const fixes = [
    {
      label: 'dishes.photo_urls',
      sql: `update dishes set photo_urls = (select array_agg(replace(url, 'http://${oldIp}:', 'http://${newIp}:')) from unnest(photo_urls) as url) where photo_urls::text ~ 'http://${oldIp.replace(/\./g, '\\.')}:';`,
    },
    {
      label: 'dish_modifier_options.photo_url',
      sql: `update dish_modifier_options set photo_url = replace(photo_url, 'http://${oldIp}:', 'http://${newIp}:') where photo_url ~ 'http://${oldIp.replace(/\./g, '\\.')}:';`,
    },
    {
      label: 'restaurants.kosher_certificate_url',
      sql: `update restaurants set kosher_certificate_url = replace(kosher_certificate_url, 'http://${oldIp}:', 'http://${newIp}:') where kosher_certificate_url ~ 'http://${oldIp.replace(/\./g, '\\.')}:';`,
    },
    {
      label: 'restaurants.logo_url',
      sql: `update restaurants set logo_url = replace(logo_url, 'http://${oldIp}:', 'http://${newIp}:') where logo_url ~ 'http://${oldIp.replace(/\./g, '\\.')}:';`,
    },
    {
      label: 'user_profiles.profile_photo_url',
      sql: `update user_profiles set profile_photo_url = replace(profile_photo_url, 'http://${oldIp}:', 'http://${newIp}:') where profile_photo_url ~ 'http://${oldIp.replace(/\./g, '\\.')}:';`,
    },
  ];
  for (const { label, sql } of fixes) {
    try {
      const out = execSync(`docker exec supabase_db_app psql -U postgres -d postgres -t -c "${sql.replace(/"/g, '\\"')}"`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      const match = out.match(/UPDATE (\d+)/);
      const count = match ? Number(match[1]) : 0;
      if (count > 0) console.log(`[refresh-lan-ip] ${label}: repaired ${count} stale URL(s)`);
    } catch (err) {
      console.warn(`[refresh-lan-ip] couldn't repair ${label} (is the local Supabase Docker stack running?)`);
      break;
    }
  }
}

function killPort(port) {
  try {
    const out = execSync(
      `powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
      { encoding: 'utf8' },
    ).trim();
    if (!out) return;
    for (const pid of out.split(/\s+/).filter(Boolean)) {
      try {
        execSync(`powershell.exe -NoProfile -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`);
        console.log(`[refresh-lan-ip] stopped process ${pid} on port ${port}`);
      } catch {
        // already gone
      }
    }
  } catch {
    // nothing listening, or powershell unavailable — fine
  }
}

function startDetached(label, commandLine, env, logName) {
  const logPath = path.join(os.tmpdir(), logName);
  const logFd = fs.openSync(logPath, 'a');
  // A single command-line string passed to `cmd /c` — cmd.exe parses it, not
  // Node, so this sidesteps the shell:true arg-escaping warning/risk
  // entirely (the strings here are all hardcoded, never user input).
  const child = spawn('cmd', ['/c', commandLine], {
    cwd: root,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  console.log(`[refresh-lan-ip] started ${label} (pid ${child.pid}), log: ${logPath}`);
}

const { address: lanIp, name: ifaceName } = detectLanIp();
console.log(`[refresh-lan-ip] detected LAN IP ${lanIp} on interface "${ifaceName}"`);

const results = [
  updateEnvFile('apps/mobile/.env.local', 'EXPO_PUBLIC_SUPABASE_URL'),
  updateEnvFile('apps/web/.env.development.local', 'VITE_SUPABASE_URL'),
  updateEnvFile('supabase/functions/.env', 'PUBLIC_SUPABASE_URL'),
];
const changed = results.some((r) => r.changed);
const oldIp = results.find((r) => r.oldIp && r.oldIp !== lanIp)?.oldIp;

if (!changed) {
  console.log('[refresh-lan-ip] no files needed updating (IP already current).');
} else if (oldIp) {
  console.log(`[refresh-lan-ip] repairing stored photo/logo/certificate URLs (${oldIp} -> ${lanIp})...`);
  fixStoredPhotoUrls(oldIp, lanIp);
}

console.log(`[refresh-lan-ip] checking local Supabase is reachable at ${lanIp}:${SUPABASE_PORT}...`);
try {
  execSync(
    `powershell.exe -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://${lanIp}:${SUPABASE_PORT}/auth/v1/health' -TimeoutSec 4 -UseBasicParsing).StatusCode } catch { Write-Output 'unreachable' }"`,
    { encoding: 'utf8', stdio: 'pipe' },
  );
} catch {
  // best-effort only
}

killPort(PORT_METRO);
killPort(PORT_VITE);

startDetached(
  'Metro (mobile)',
  'pnpm --filter mobile start -- --clear',
  { REACT_NATIVE_PACKAGER_HOSTNAME: lanIp },
  'feedbook-metro.log',
);
startDetached('Vite (web admin)', 'pnpm --filter web dev', {}, 'feedbook-vite.log');

console.log('[refresh-lan-ip] done. Give both servers ~10-20s to come up, then reload the app/browser.');
