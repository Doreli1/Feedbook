#!/usr/bin/env node
// Runs automatically after every `pnpm install` (wired as the root
// package.json's "postinstall" script). A fresh install hoists react-dom to
// the workspace root, which carries its own nested node_modules/react copy
// — a different physical instance than apps/web's own local react, even
// when both report the same version number. React refuses two instances of
// the same hook dispatcher and apps/web white-screens with "Invalid hook
// call" and no visible error on the page (only in the browser console).
// Manual fix history/root cause: see the "project_web_admin_duplicate_react_bug"
// memory — this script just re-applies that same fix on its own so it can't
// be forgotten after a reinstall.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rootReactDom = path.join(root, 'node_modules', 'react-dom');
const webReact = path.join(root, 'apps', 'web', 'node_modules', 'react');
const webReactDom = path.join(root, 'apps', 'web', 'node_modules', 'react-dom');

if (!fs.existsSync(rootReactDom) || !fs.existsSync(webReact)) {
  // Layout not what this fix expects (e.g. apps/web no longer has its own
  // local react) — nothing to do.
  process.exit(0);
}

const nestedReact = path.join(webReactDom, 'node_modules', 'react');
const alreadyDeduped = fs.existsSync(webReactDom) && !fs.existsSync(nestedReact);
if (alreadyDeduped) {
  process.exit(0);
}

fs.rmSync(webReactDom, { recursive: true, force: true });
fs.cpSync(rootReactDom, webReactDom, { recursive: true });
fs.rmSync(path.join(webReactDom, 'node_modules', 'react'), { recursive: true, force: true });
fs.rmSync(path.join(root, 'apps', 'web', 'node_modules', '.vite'), { recursive: true, force: true });

console.log('[fix-web-react-dedup] apps/web now shares one React instance with react-dom.');
