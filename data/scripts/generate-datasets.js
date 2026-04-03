'use strict';

/**
 * generate-datasets.js
 *
 * Generates data/datasets.js from the OSV4 CSV export.
 * Run from the repository root:  node data/scripts/generate-datasets.js
 *
 * Input:   data/osv4-3_telling_gr2026_tilburg-1.csv
 * Output:  data/datasets.js
 */

const fs   = require('fs');
const path = require('path');

// ── File paths ────────────────────────────────────────────────────────────────

const CSV_PATH     = path.join(__dirname, '..', 'osv4-3_telling_gr2026_tilburg-1.csv');
const OUTPUT_PATH  = path.join(__dirname, '..', 'datasets.js');

// ── Party colours ─────────────────────────────────────────────────────────────

const PARTY_COLORS = {
  'GROENLINKS / Partij van de Arbeid (PvdA)': '#C8142A',
  'D66':                                       '#1DB954',
  'Lijst Smolders Tilburg (LST)':              '#F4A200',
  'VVD':                                       '#003082',
  '50PLUS':                                    '#8B008B',
  'SP (Socialistische Partij)':                '#EE0000',
  'Partij voor de Dieren':                     '#218B3B',
  'CDA':                                       '#007B5E',
  'Lokaal Tilburg':                            '#2196F3',
  'ONS Tilburg':                               '#FF6B00',
  'VoorTilburg013':                            '#9C27B0',
  'Forum voor Democratie':                     '#1E3A6E',
  'Volt':                                      '#502379',
  'BBB':                                       '#8FB83B',
  'DENK':                                      '#1AB3A6',
};

// ── CSV parsing ───────────────────────────────────────────────────────────────

/**
 * Split a semicolon-delimited row, honouring double-quoted fields.
 * Quoted fields may contain "" (escaped quote) and semicolons.
 */
function splitRow(line) {
  const fields = [];
  let current  = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ';' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// ── Read & parse CSV ──────────────────────────────────────────────────────────

const raw   = fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
const lines = raw.split('\n').filter(l => l.trim() !== '').map(splitRow);

if (lines.length < MIN_EXPECTED_ROWS) {
  throw new Error(`CSV heeft te weinig regels: ${lines.length} (verwacht ≥ ${MIN_EXPECTED_ROWS})`);
}

// Row indices (0-based) within the CSV.
// The file contains: 1 header row + 2 metadata rows (Gebiednummer, Postcode)
// + 10 counting rows (opgeroepenen … minder stembiljetten) + 15 party rows = 28 rows total.
const ROW_HEADER      = 0;   // stembureau names
const ROW_POSTCODE    = 2;   // PC6 postcodes  (e.g. "5035 BR")
const ROW_GELDIG      = 7;   // geldige stembiljetten
const ROW_PARTIES_START = 13; // first party total row
const ROW_PARTIES_END   = 27; // last  party total row (15 parties total)

const MIN_EXPECTED_ROWS = 28; // minimum: 3 header/meta + 10 counting + 15 party rows

// Data columns start at index 5 (index 4 = grand total, 0-3 = metadata)
const DATA_COL_START = 5;

const headerRow   = lines[ROW_HEADER];
const postcodeRow = lines[ROW_POSTCODE];
const geldgeRow   = lines[ROW_GELDIG];

// Collect party names in order from the CSV
const partyNames = [];
for (let r = ROW_PARTIES_START; r <= ROW_PARTIES_END; r++) {
  const name = lines[r][1];
  if (name && PARTY_COLORS[name] !== undefined) {
    partyNames.push(name);
  } else if (name) {
    console.warn(`  Onbekende partij in CSV (geen kleur): "${name}"`);
    partyNames.push(name);
  }
}

console.log(`Partijen gevonden (${partyNames.length}):`, partyNames);

// ── Build per-stembureau data ─────────────────────────────────────────────────

const stembureaus = [];

for (let col = DATA_COL_START; col < headerRow.length; col++) {
  const rawName  = headerRow[col].trim();
  // Strip leading "Stembureau " prefix
  const naam = rawName.startsWith('Stembureau ')
    ? rawName.slice('Stembureau '.length)
    : rawName;

  const pc6Raw   = (postcodeRow[col] || '').trim();
  const pc6      = pc6Raw.replace(' ', '');  // e.g. "5035BR"
  const pc4      = pc6Raw.substring(0, 4);   // e.g. "5035"

  const totaal = parseInt(geldgeRow[col], 10) || 0;

  const votes = {};
  for (let r = ROW_PARTIES_START; r <= ROW_PARTIES_END; r++) {
    const party = lines[r][1];
    votes[party] = parseInt(lines[r][col], 10) || 0;
  }

  if (!pc4 || pc4.length < 4) {
    console.warn(`  Kolom ${col}: ongeldige postcode "${pc6Raw}" – overgeslagen`);
    continue;
  }

  stembureaus.push({ naam, pc6, pc4, totaal, votes });
}

console.log(`Stembureaus gelezen: ${stembureaus.length}`);

// ── Aggregate to PC4 ─────────────────────────────────────────────────────────

const pc4Map = {};

for (const s of stembureaus) {
  if (!pc4Map[s.pc4]) {
    const row = { postcode: s.pc4, totaal_stemmen: 0 };
    for (const p of partyNames) row[p] = 0;
    pc4Map[s.pc4] = row;
  }
  pc4Map[s.pc4].totaal_stemmen += s.totaal;
  for (const p of partyNames) {
    pc4Map[s.pc4][p] += s.votes[p] || 0;
  }
}

const pc4Rows = Object.values(pc4Map).sort((a, b) => a.postcode.localeCompare(b.postcode));
console.log(`PC4-postcodes: ${pc4Rows.length}`);

// ── Aggregate to PC6 ─────────────────────────────────────────────────────────

const pc6Map = {};

for (const s of stembureaus) {
  if (!pc6Map[s.pc6]) {
    const row = { postcode: s.pc6, namen: [], totaal_stemmen: 0 };
    for (const p of partyNames) row[p] = 0;
    pc6Map[s.pc6] = row;
  }
  pc6Map[s.pc6].namen.push(s.naam);
  pc6Map[s.pc6].totaal_stemmen += s.totaal;
  for (const p of partyNames) {
    pc6Map[s.pc6][p] += s.votes[p] || 0;
  }
}

// Replace the 'namen' list with a single 'naam' display string
for (const row of Object.values(pc6Map)) {
  row.naam = row.namen.length === 1
    ? row.namen[0]
    : `${row.postcode} (${row.namen.length} stembureaus)`;
  delete row.namen;
}

const pc6Rows = Object.values(pc6Map).sort((a, b) => a.postcode.localeCompare(b.postcode));
console.log(`PC6-postcodes (uniek): ${pc6Rows.length}`);

// ── Serialise to JS literal ───────────────────────────────────────────────────

function jsString(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function serializeRow(row) {
  const parts = [];
  for (const [k, v] of Object.entries(row)) {
    // Use quoted JS string for keys that are not valid bare identifiers
  const BARE_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
  const key   = BARE_IDENTIFIER.test(k) ? k : jsString(k);
    const value = typeof v === 'string' ? jsString(v) : v;
    parts.push(`${key}: ${value}`);
  }
  return `      { ${parts.join(', ')} }`;
}

function serializePartyColors(colors) {
  return Object.entries(colors)
    .map(([k, v]) => `      ${jsString(k)}: ${jsString(v)}`)
    .join(',\n');
}

function serializeDataset({ title, geojsonFile, keyType, rows }) {
  const rowsJs = rows.map(serializeRow).join(',\n');
  return `  {
    title: ${jsString(title)},
    geojsonFile: ${jsString(geojsonFile)},
    keyType: ${jsString(keyType)},
    valueLabel: 'stemmen',
    partyColors: {
${serializePartyColors(PARTY_COLORS)},
    },
    data: [
${rowsJs},
    ],
  }`;
}

// ── Compose output ────────────────────────────────────────────────────────────

const datasetsJs = `'use strict';

// AUTO-GENERATED by data/scripts/generate-datasets.js
// Source: data/osv4-3_telling_gr2026_tilburg-1.csv
// Do not edit manually — re-run the generate script instead.

export const datasets = [
${serializeDataset({
  title:      'GR2026 – cirkels per PC4',
  geojsonFile: 'data/pc4_tilburg_centered.geojson',
  keyType:    'pc4',
  rows:       pc4Rows,
})},
${serializeDataset({
  title:      'GR2026 – vormen per PC4',
  geojsonFile: 'data/pc4_tilburg_shapes.geojson',
  keyType:    'pc4',
  rows:       pc4Rows,
})},
${serializeDataset({
  title:      'GR2026 – cirkels per stembureau (PC6)',
  geojsonFile: 'data/pc6_tilburg_centered.geojson',
  keyType:    'pc6',
  rows:       pc6Rows,
})},
];
`;

fs.writeFileSync(OUTPUT_PATH, datasetsJs, 'utf8');
console.log(`\nGeschreven: ${OUTPUT_PATH}`);
