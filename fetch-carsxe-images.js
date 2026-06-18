#!/usr/bin/env node
/**
 * fetch-carsxe-images.js
 * -----------------------
 * Fetches one hero image per (year + model + trim) from the CarsXE Images API
 * and writes them into inventory.html, between the CARSXE_IMAGES_START / _END
 * markers, as a JS object keyed by "YEAR|MODEL|TRIM".
 *
 * The key format matches what getVehiclePhoto() in inventory.html looks up,
 * so a fetched image becomes the hero photo for that exact vehicle (with the
 * imagin.studio shot as automatic fallback if the URL ever fails).
 *
 * USAGE (run from the same folder as inventory.html):
 *     CARSXE_KEY=cxe_live_xxxxx node fetch-carsxe-images.js
 *
 * Options:
 *     --download   Also download each image into ./vehicle-images/ and point
 *                  the map at the local copy (recommended for production: the
 *                  CarsXE links are third-party and can change or expire).
 *     --dry-run    Fetch + report, but DON'T modify inventory.html.
 *
 * Requires Node 18+ (uses the built-in global fetch).
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────
const KEY = process.env.CARSXE_KEY;
const HTML_FILE   = path.join(__dirname, 'inventory.html');
const IMG_DIR     = path.join(__dirname, 'vehicle-images');
const THROTTLE_MS = 300;          // pause between API calls (be kind to the API / your quota)
const LICENSE     = 'ShareCommercially'; // safest license for a live commercial site
const DOWNLOAD = process.argv.includes('--download');
const DRY_RUN  = process.argv.includes('--dry-run');

// ── What to fetch ───────────────────────────────────────────────────────────
// siteModel  = the model string EXACTLY as it appears in inventory.html
//              (it forms the lookup key "YEAR|siteModel|TRIM").
// make/model = the CarsXE query params (lowercase, as CarsXE expects).
// Add more objects here later to cover other models/brands.
const TARGETS = [
  {
    siteModel: 'Corolla',
    make:  'toyota',
    model: 'corolla',
    years: [2020, 2021, 2022, 2023, 2024, 2025],
    trims: ['L', 'LE', 'SE', 'XLE', 'XSE', 'Hybrid LE', 'Hybrid SE', 'Hybrid XLE'],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Try the request with trim+year first, then loosen (trim off, then year off)
// so e.g. "Hybrid LE" still returns *something* if CarsXE has no exact match.
async function fetchImage(make, model, year, trim) {
  const attempts = [
    { year, trim },   // most specific
    { year },         // drop trim
    {},               // drop year + trim (generic model photo)
  ];

  for (const extra of attempts) {
    const url = new URL('https://api.carsxe.com/images');
    url.searchParams.set('key', KEY);
    url.searchParams.set('make', make);
    url.searchParams.set('model', model);
    if (extra.year) url.searchParams.set('year', String(extra.year));
    if (extra.trim) url.searchParams.set('trim', extra.trim);
    url.searchParams.set('license', LICENSE);
    url.searchParams.set('format', 'json');

    try {
      const res  = await fetch(url);
      const data = await res.json();
      const img  = data && data.success && Array.isArray(data.images) && data.images[0];
      if (img && img.link) {
        return { link: img.link, loosened: !extra.trim || !extra.year };
      }
    } catch (err) {
      console.warn(`    ! request error: ${err.message}`);
    }
    await sleep(THROTTLE_MS);
  }
  return null;
}

async function downloadTo(localPath, link) {
  const res = await fetch(link);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(localPath, buf);
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!KEY) {
    console.error('ERROR: set your key first, e.g.\n  CARSXE_KEY=cxe_live_xxxxx node fetch-carsxe-images.js');
    process.exit(1);
  }
  if (!fs.existsSync(HTML_FILE)) {
    console.error(`ERROR: inventory.html not found at ${HTML_FILE}`);
    process.exit(1);
  }
  if (DOWNLOAD && !fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

  const map = {};
  let ok = 0, loose = 0, miss = 0;

  for (const t of TARGETS) {
    for (const year of t.years) {
      for (const trim of t.trims) {
        const key = `${year}|${t.siteModel}|${trim}`;
        process.stdout.write(`${key} ... `);

        const found = await fetchImage(t.make, t.model, year, trim);
        if (!found) { console.log('no image'); miss++; await sleep(THROTTLE_MS); continue; }

        let value = found.link;
        if (DOWNLOAD) {
          const file = `${slug(t.siteModel)}-${year}-${slug(trim)}.jpg`;
          try {
            await downloadTo(path.join(IMG_DIR, file), found.link);
            value = `vehicle-images/${file}`;
          } catch (err) {
            console.warn(`(download failed: ${err.message}, keeping remote URL) `);
          }
        }

        map[key] = value;
        console.log(found.loosened ? 'ok (loosened match)' : 'ok');
        found.loosened ? loose++ : ok++;
        await sleep(THROTTLE_MS);
      }
    }
  }

  const total = ok + loose + miss;
  console.log(`\nDone: ${ok} exact, ${loose} loosened, ${miss} missing  (of ${total})`);

  if (DRY_RUN) { console.log('--dry-run: inventory.html NOT modified.'); return; }

  // Build the replacement block.
  const lines = Object.keys(map).sort().map(
    (k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])}`
  );
  const block =
    '// CARSXE_IMAGES_START\n' +
    'var CARSXE_IMAGES = {\n' +
    lines.join(',\n') + (lines.length ? '\n' : '') +
    '};\n' +
    '// CARSXE_IMAGES_END';

  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const re = /\/\/ CARSXE_IMAGES_START[\s\S]*?\/\/ CARSXE_IMAGES_END/;
  if (!re.test(html)) {
    console.error('ERROR: could not find the CARSXE_IMAGES_START/END markers in inventory.html.');
    process.exit(1);
  }

  fs.writeFileSync(HTML_FILE + '.bak', html);          // safety backup
  fs.writeFileSync(HTML_FILE, html.replace(re, block));
  console.log(`Wrote ${Object.keys(map).length} images into inventory.html (backup at inventory.html.bak).`);
})();
