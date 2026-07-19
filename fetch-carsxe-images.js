#!/usr/bin/env node
/**
 * fetch-carsxe-images.js — one-time batch download of vehicle images from CarsXE.
 *
 * Usage (from the site root folder):
 *     CARSXE_KEY=your_key_here node fetch-carsxe-images.js
 * or on Windows (PowerShell):
 *     $env:CARSXE_KEY="your_key_here"; node fetch-carsxe-images.js
 *
 * What it does:
 *  - Makes ONE CarsXE API call per unique model below (55 total, within your 100-call cap).
 *  - Downloads the best front-3/4 image to vehicle-images/{make}-{model}.jpg
 *    (image downloads themselves do NOT count against the API cap — only the
 *    /images metadata call does).
 *  - Skips any model whose file already exists, so re-running only retries failures
 *    and never wastes calls.
 *  - Prints a summary of successes/failures at the end.
 *
 * SECURITY: do not hard-code the key in this file or commit it to the repo —
 * GitHub Pages repos are public. Pass it via the CARSXE_KEY env var each run.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const KEY = process.env.CARSXE_KEY;
if (!KEY) {
  console.error('ERROR: set the CARSXE_KEY environment variable first.');
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, 'vehicle-images');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// Priority order: index.html brand cards first, then inventory top-to-bottom.
// [make, modelFamily (used in filename), CarsXE model query, preferred year]
const MODELS = [
  // ── index.html brand cards (highest visibility) ──
  ['mazda', 'cx-5', 'CX-5', 2025],
  ['ram', '1500', '1500', 2025],
  ['kia', 'telluride', 'Telluride', 2025],
  ['hyundai', 'palisade', 'Palisade', 2025],
  ['nissan', 'rogue', 'Rogue', 2025],
  ['jeep', 'wrangler', 'Wrangler', 2025],
  ['dodge', 'charger', 'Charger', 2025],
  ['chrysler', 'pacifica', 'Pacifica', 2025],
  // ── inventory: Toyota (lead brand) ──
  ['toyota', 'corolla', 'Corolla', 2025],
  ['toyota', 'camry', 'Camry', 2025],
  ['toyota', 'crown', 'Crown', 2025],
  ['toyota', 'c-hr', 'C-HR', 2025],
  ['toyota', 'corolla-cross', 'Corolla Cross', 2025],
  ['toyota', 'rav4', 'RAV4', 2025],
  ['toyota', 'highlander', 'Highlander', 2025],
  ['toyota', 'grand-highlander', 'Grand Highlander', 2025],
  ['toyota', 'sequoia', 'Sequoia', 2025],
  ['toyota', 'tacoma', 'Tacoma', 2025],
  ['toyota', 'tundra', 'Tundra', 2025],
  // ── Mazda ──
  ['mazda', '3', 'Mazda3', 2025],
  ['mazda', 'cx-30', 'CX-30', 2025],
  ['mazda', 'cx-50', 'CX-50', 2025],
  ['mazda', 'cx-70', 'CX-70', 2025],
  ['mazda', 'cx-90', 'CX-90', 2025],
  // ── Kia ──
  ['kia', 'k4', 'K4', 2025],
  ['kia', 'k5', 'K5', 2025],
  ['kia', 'forte', 'Forte', 2024],
  ['kia', 'soul', 'Soul', 2025],
  ['kia', 'seltos', 'Seltos', 2025],
  ['kia', 'sportage', 'Sportage', 2025],
  ['kia', 'sorento', 'Sorento', 2025],
  ['kia', 'carnival', 'Carnival', 2025],
  // ── Hyundai ──
  ['hyundai', 'elantra', 'Elantra', 2025],
  ['hyundai', 'sonata', 'Sonata', 2025],
  ['hyundai', 'venue', 'Venue', 2025],
  ['hyundai', 'kona', 'Kona', 2025],
  ['hyundai', 'tucson', 'Tucson', 2025],
  ['hyundai', 'santa-fe', 'Santa Fe', 2025],
  // ── Nissan ──
  ['nissan', 'versa', 'Versa', 2025],
  ['nissan', 'sentra', 'Sentra', 2025],
  ['nissan', 'altima', 'Altima', 2025],
  ['nissan', 'maxima', 'Maxima', 2024],
  ['nissan', 'kicks', 'Kicks', 2025],
  ['nissan', 'murano', 'Murano', 2025],
  ['nissan', 'pathfinder', 'Pathfinder', 2025],
  ['nissan', 'armada', 'Armada', 2025],
  ['nissan', 'frontier', 'Frontier', 2025],
  // ── Jeep ──
  ['jeep', 'compass', 'Compass', 2025],
  ['jeep', 'cherokee', 'Cherokee', 2024],
  ['jeep', 'grand-cherokee', 'Grand Cherokee', 2025],
  ['jeep', 'gladiator', 'Gladiator', 2025],
  // ── Dodge ──
  ['dodge', 'challenger', 'Challenger', 2024],
  ['dodge', 'durango', 'Durango', 2025],
  ['dodge', 'hornet', 'Hornet', 2025],
  // ── Chrysler ──
  ['chrysler', 'voyager', 'Voyager', 2025],
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'askforisrael-image-fetch/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location)); // follow redirect
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let apiCalls = 0, ok = 0, skipped = 0;
  const failures = [];

  for (const [make, slug, modelQuery, year] of MODELS) {
    const outFile = path.join(OUT_DIR, `${make}-${slug}.jpg`);
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 5000) {
      skipped++;
      console.log(`SKIP  ${make}-${slug}.jpg (already downloaded)`);
      continue;
    }

    const apiURL = `https://api.carsxe.com/images?key=${KEY}` +
      `&make=${encodeURIComponent(make)}` +
      `&model=${encodeURIComponent(modelQuery)}` +
      `&year=${year}&angle=front&photoType=exterior&size=Large&format=json`;

    try {
      apiCalls++;
      const res = await get(apiURL);
      if (res.status !== 200) throw new Error(`API HTTP ${res.status}`);
      const data = JSON.parse(res.body.toString('utf8'));
      const images = data.images || data.data || [];
      if (!images.length) throw new Error('no images returned');

      // Prefer a landscape image with decent resolution
      const pick = images.find((i) => (i.width || 0) >= 800) || images[0];
      const imgURL = pick.link || pick.url || pick.thumbnailLink;
      if (!imgURL) throw new Error('no usable image URL in response');

      const img = await get(imgURL);
      if (img.status !== 200 || img.body.length < 5000) throw new Error(`image download HTTP ${img.status}`);
      fs.writeFileSync(outFile, img.body);
      ok++;
      console.log(`OK    ${make}-${slug}.jpg  (${Math.round(img.body.length / 1024)} KB)  [API calls used: ${apiCalls}]`);
    } catch (e) {
      failures.push([make, slug, e.message]);
      console.log(`FAIL  ${make}-${slug}: ${e.message}`);
    }
    await sleep(400); // be polite / avoid rate limiting
  }

  console.log('\n──────── SUMMARY ────────');
  console.log(`API calls used this run: ${apiCalls}`);
  console.log(`Downloaded: ${ok}   Skipped (already had): ${skipped}   Failed: ${failures.length}`);
  if (failures.length) {
    console.log('\nFailed models (re-run the script to retry just these):');
    failures.forEach(([m, s, msg]) => console.log(`  - ${m} ${s}: ${msg}`));
    console.log('\nTip: if a model keeps failing, try editing its year (e.g. 2024) or model');
    console.log('spelling in the MODELS list above, then re-run — existing files are skipped.');
  }
})();
