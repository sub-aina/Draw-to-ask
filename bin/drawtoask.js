#!/usr/bin/env node
'use strict';

// Global-install launcher. When installed with `npm install -g drawtoask`,
// this file is exposed on the PATH as `drawtoask`. Running it spawns Electron
// against the bundled app.
//
// Requiring the `electron` module from a plain Node process (i.e. not from
// inside Electron itself) returns the absolute path to the platform's prebuilt
// Electron binary — so we just hand it the app root plus any passthrough args
// (e.g. `drawtoask --spike`).

const { spawn } = require('node:child_process');
const path = require('node:path');

let electronBinary;
try {
  electronBinary = require('electron');
} catch {
  console.error('Draw to Ask: the "electron" dependency is missing. Reinstall with `npm install -g drawtoask`.');
  process.exit(1);
}

const appRoot = path.join(__dirname, '..');
const args = [appRoot, ...process.argv.slice(2)];

const child = spawn(electronBinary, args, { stdio: 'inherit', windowsHide: false });

child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('Draw to Ask: failed to launch Electron —', err.message);
  process.exit(1);
});
