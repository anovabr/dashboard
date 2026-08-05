#!/usr/bin/env node
// House rule 1: after every edit, extract the last <script> block and node --check it.
// Run with `npm run check`.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const files = process.argv.slice(2);
const targets = files.length ? files : ['index.html', 'manuscripts.html'];
let bad = 0;

for (const f of targets) {
  const html = fs.readFileSync(f, 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\btype=)[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!blocks.length) { console.error(`${f}: no plain <script> block found`); bad++; continue; }
  const js = blocks[blocks.length - 1][1];
  const tmp = path.join(os.tmpdir(), `check-${path.basename(f)}.js`);
  fs.writeFileSync(tmp, js);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log(`ok   ${f}  (last <script>, ${js.split('\n').length} lines)`);
  } catch (e) {
    console.error(`FAIL ${f}\n${e.stderr.toString()}`);
    bad++;
  } finally {
    fs.unlinkSync(tmp);
  }
}
process.exit(bad ? 1 : 0);
