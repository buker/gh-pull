#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const forkPublic = path.join(root, 'public');
const outHtml = process.argv[2] || path.join(root, 'dist/gns-inbox.html');

/** GNS html-apps CSP blocks font-src outside the sandbox; never ship Inter via /fonts URLs. */
function sanitizeCssForGns(raw) {
  return raw
    .replace(/@font-face\s*\{[^}]*\}/gs, '')
    .replace(/font-family:\s*['"]?Inter['"]?[^;]*;/gi, '');
}

const cssFiles = [
  path.join(forkPublic, 'theme.css'),
  path.join(forkPublic, 'style.css'),
  path.join(forkPublic, 'query-editor.css'),
  path.join(root, 'gns/read-only.css'),
];
const css = [
  ...cssFiles.map((f) => sanitizeCssForGns(fs.readFileSync(f, 'utf8'))),
  ':root { --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }\n',
].join('\n');

const index = fs.readFileSync(path.join(forkPublic, 'index.html'), 'utf8');
let body = index
  .replace(/<link rel="stylesheet" href="[^"]+">\s*/g, '')
  .replace(/<link rel="preload"[^>]+>\s*/g, '')
  .replace(/<link rel="icon"[^>]+>\s*/g, '')
  .replace(/<script type="module" src="\/app\.js"><\/script>\s*/, '');

const bundleResult = await esbuild.build({
  entryPoints: [path.join(root, 'gns/entry.js')],
  bundle: true,
  format: 'esm',
  write: false,
  target: ['es2022'],
  logLevel: 'warning',
});

const bundleJs = bundleResult.outputFiles[0].text;
const html = body.replace(
  '</head>',
  `<style nonce="STYLE_NONCE">\n${css}\n</style>\n</head>`,
).replace(
  '</body>',
  `<script type="module">\n${bundleJs}\n</script>\n</body>`,
);

fs.mkdirSync(path.dirname(outHtml), { recursive: true });
fs.writeFileSync(outHtml, html);
console.log(`built ${outHtml} (${html.length} bytes)`);
