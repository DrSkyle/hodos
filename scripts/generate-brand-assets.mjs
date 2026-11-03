import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const brandDir = path.join(rootDir, 'brand');
const webPublicDir = path.join(rootDir, 'apps/web/public');
const androidResDir = path.join(rootDir, 'apps/web/android/app/src/main/res');

fs.mkdirSync(brandDir, { recursive: true });
fs.mkdirSync(webPublicDir, { recursive: true });

// Master SVGs
const masterSquareSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="Hodos">
  <rect width="128" height="128" rx="30" fill="#104e3f"/>
  <path d="M34 99 57 29Q64 13 71 29L94 99" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="13"/>
  <path d="M48 74h32" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="10"/>
</svg>`;

const masterRoundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="Hodos">
  <circle cx="64" cy="64" r="64" fill="#104e3f"/>
  <path d="M34 99 57 29Q64 13 71 29L94 99" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="13"/>
  <path d="M48 74h32" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="10"/>
</svg>`;

const wordmarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" width="600" height="200">
  <rect x="20" y="20" width="160" height="160" rx="38" fill="#104e3f"/>
  <path d="M62 144 L91 56 Q100 36 109 56 L138 144" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
  <path d="M80 112 h40" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="12"/>
  <text x="210" y="132" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="96" font-weight="800" fill="#104e3f" letter-spacing="-3">hodos<tspan fill="#10b981">.</tspan></text>
</svg>`;

// Save SVG files
fs.writeFileSync(path.join(brandDir, 'icon.svg'), masterSquareSvg);
fs.writeFileSync(path.join(webPublicDir, 'icon.svg'), masterSquareSvg);
fs.writeFileSync(path.join(webPublicDir, 'icon-round.svg'), masterRoundSvg);

function renderPng(svg, size, width, height) {
  const w = width || size;
  const h = height || size;
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: w }
  });
  return resvg.render().asPng();
}

console.log('Rendering web icons...');
// Render Web PNG assets
fs.writeFileSync(path.join(webPublicDir, 'favicon-16.png'), renderPng(masterSquareSvg, 16));
fs.writeFileSync(path.join(webPublicDir, 'favicon-32.png'), renderPng(masterSquareSvg, 32));
fs.writeFileSync(path.join(webPublicDir, 'apple-touch-icon.png'), renderPng(masterSquareSvg, 180));
fs.writeFileSync(path.join(webPublicDir, 'icon-192.png'), renderPng(masterSquareSvg, 192));
fs.writeFileSync(path.join(webPublicDir, 'icon-512.png'), renderPng(masterSquareSvg, 512));

// Square and round masters (1024x1024)
fs.writeFileSync(path.join(webPublicDir, 'hodos-icon.png'), renderPng(masterSquareSvg, 1024));
fs.writeFileSync(path.join(webPublicDir, 'hodos-round.png'), renderPng(masterRoundSvg, 1024));
fs.writeFileSync(path.join(webPublicDir, 'hodos-wordmark.png'), renderPng(wordmarkSvg, 0, 1200, 400));

console.log('Brand assets generation complete!');
