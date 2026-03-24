'use strict';

// ── Configuration ──────────────────────────────────────────────────────────

const TILBURG_CENTER = [51.5655, 5.0913];
const TILBURG_ZOOM   = 12;

/**
 * PC4 postal codes that belong to the municipality of Tilburg (incl. Udenhout,
 * Berkel-Enschot).  Used to filter the PDOK WFS response.
 */
const TILBURG_POSTCODES = [
  '5011','5012','5013','5014','5015','5016','5017','5018','5019',
  '5021','5022','5023','5024','5025','5026','5027','5028',
  '5031','5032','5033','5034','5035','5036','5037','5038',
  '5041','5042','5043','5044','5045','5046','5047','5048','5049',
];

/** Official / widely-recognised party colours (hex). */
const PARTY_COLORS = {
  'VVD':          '#003082',
  'D66':          '#1DB954',
  'PVV':          '#003580',
  'CDA':          '#007B5E',
  'SP':           '#EE0000',
  'GL-PvdA':      '#C8142A',
  'ChristenUnie': '#4C9BE8',
  'PvdD':         '#218B3B',
  'NSC':          '#264FA2',
  'BBB':          '#8FB83B',
  'DENK':         '#1AB3A6',
  'Volt':         '#502379',
  'Overig':       '#888888',
};

/** Human-readable neighbourhood names per PC4. */
const NEIGHBORHOOD_NAMES = {
  '5011': 'Centrum',
  '5012': 'Binnenstad Oost',
  '5013': 'Trouwlaan',
  '5014': 'Wandelbos',
  '5015': 'Jeruzalem',
  '5016': 'Korvel',
  '5017': 'Oud-Noord',
  '5018': 'Groenewoud',
  '5019': 'Rosmolen',
  '5021': 'Quirijnstok',
  '5022': 'Broekhoven',
  '5023': 'Loven',
  '5024': 'Koolhoven',
  '5025': 'De Blaak',
  '5026': 'Warande',
  '5027': 'Noord',
  '5028': 'Noord',
  '5031': 'Reeshof West',
  '5032': 'Reeshof Noord',
  '5033': 'Reeshof Oost',
  '5034': 'Berkel-Enschot Noord',
  '5035': 'Tilburg Oost',
  '5036': 'Tilburg Oost',
  '5037': 'Tilburg Oost',
  '5038': 'Udenhout gebied',
  '5041': 'Udenhout',
  '5042': 'Berkel-Enschot',
  '5043': 'Tilburg',
  '5044': 'Tilburg',
  '5045': 'Tilburg',
  '5046': 'Stappegoor',
  '5047': 'Tilburg',
  '5048': 'Tilburg',
  '5049': 'Tilburg',
};

// ── State ───────────────────────────────────────────────────────────────────

let map;
let geojsonLayer;
let votingData   = {};   // { postcode: { VVD: 11, D66: 9, … } }
let selectedParty = null;

// ── Map initialisation ──────────────────────────────────────────────────────

function initMap() {
  map = L.map('map', { center: TILBURG_CENTER, zoom: TILBURG_ZOOM });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
}

// ── CSV loading ─────────────────────────────────────────────────────────────

function loadCSVData() {
  return new Promise((resolve, reject) => {
    Papa.parse('data/verkiezingen_tilburg.csv', {
      download:      true,
      header:        true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete(results) {
        results.data.forEach(row => {
          if (row.postcode) {
            votingData[String(row.postcode)] = row;
          }
        });
        resolve(votingData);
      },
      error: reject,
    });
  });
}

// ── PDOK WFS GeoJSON fetching ───────────────────────────────────────────────

async function fetchGeoJSON() {
  // 1. Try the PDOK CBS WFS service (accurate real-world boundaries).
  try {
    const pcList = TILBURG_POSTCODES.map(p => `'${p}'`).join(',');
    const url = new URL('https://service.pdok.nl/cbs/gebiedsindelingen/2022/wfs/v1_0');
    url.searchParams.set('SERVICE',      'WFS');
    url.searchParams.set('VERSION',      '2.0.0');
    url.searchParams.set('REQUEST',      'GetFeature');
    url.searchParams.set('TYPENAMES',    'postcode4gebied');
    url.searchParams.set('outputFormat', 'application/json');
    url.searchParams.set('srsName',      'EPSG:4326');
    url.searchParams.set('CQL_FILTER',   `postcode4naam IN (${pcList})`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        const data = await response.json();
        if (data.features && data.features.length > 0) return data;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (_) {
    // PDOK unreachable – fall through to the bundled fallback
  }

  // 2. Bundled approximate geometries (hexagonal tiles per PC4 centroid).
  const fallback = await fetch('data/tilburg_pc4_fallback.geojson');
  if (!fallback.ok) {
    throw new Error('Kon geen postcodegebieden laden (PDOK niet bereikbaar en fallback ontbreekt).');
  }
  return fallback.json();
}

// ── Colour helpers ──────────────────────────────────────────────────────────

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Blend white → partyColor proportionally to percentage / maxValue. */
function getColor(percentage, partyHex) {
  if (percentage === null || percentage === undefined) return '#cccccc';

  const values = Object.values(votingData)
    .map(d => d[selectedParty])
    .filter(v => typeof v === 'number');
  const maxVal = values.length > 0 ? Math.max(...values) : 40;

  const factor = Math.min(percentage / maxVal, 1);
  const [pr, pg, pb] = hexToRgb(partyHex);

  return rgbToHex(
    Math.round(255 + (pr - 255) * factor),
    Math.round(255 + (pg - 255) * factor),
    Math.round(255 + (pb - 255) * factor),
  );
}

// ── Feature helpers ─────────────────────────────────────────────────────────

function getPostcode(feature) {
  const p = feature.properties;
  return String(p.postcode4naam ?? p.pc4 ?? p.PC4 ?? p.postcode ?? '');
}

// ── Leaflet style / interaction ─────────────────────────────────────────────

function styleFeature(feature) {
  if (!selectedParty) {
    return { fillColor: '#b0bec5', weight: 1, color: '#607d8b', fillOpacity: 0.4 };
  }

  const pc   = getPostcode(feature);
  const data = votingData[pc];
  const pct  = data ? data[selectedParty] : null;
  const col  = PARTY_COLORS[selectedParty] ?? '#888888';

  return {
    fillColor: getColor(pct, col),
    weight:       1,
    color:        '#607d8b',
    fillOpacity:  0.85,
  };
}

function buildTooltip(postcode) {
  const data = votingData[postcode];
  const hood = NEIGHBORHOOD_NAMES[postcode] ?? '';
  let html = `<strong>${postcode}</strong>${hood ? ` – ${hood}` : ''}`;
  if (data && selectedParty && data[selectedParty] !== undefined) {
    html += `<br>${selectedParty}: <strong>${data[selectedParty]} %</strong>`;
  }
  return html;
}

function onEachFeature(feature, layer) {
  const pc = getPostcode(feature);

  layer.bindTooltip(buildTooltip(pc), { sticky: true, direction: 'top', offset: [0, -6] });

  layer.on({
    mouseover(e) {
      e.target.setStyle({ weight: 3, color: '#ffffff' });
      e.target.bringToFront();
      showInfoBox(pc);
    },
    mouseout(e) {
      geojsonLayer.resetStyle(e.target);
      resetInfoBox();
    },
    click(e) {
      map.fitBounds(e.target.getBounds(), { padding: [30, 30] });
    },
  });
}

// ── Sidebar content ─────────────────────────────────────────────────────────

function showInfoBox(postcode) {
  const box  = document.getElementById('info-box');
  const data = votingData[postcode];
  const hood = NEIGHBORHOOD_NAMES[postcode] ?? '';

  let html = `<h3>${postcode}${hood ? ` – ${hood}` : ''}</h3>`;

  if (!data) {
    html += '<p class="hint">Geen kiesdata beschikbaar voor dit gebied.</p>';
    box.innerHTML = html;
    return;
  }

  if (selectedParty && data[selectedParty] !== undefined) {
    const col = PARTY_COLORS[selectedParty] ?? '#888888';
    html += `<div class="party-highlight">
      <span class="color-dot" style="background:${col}"></span>
      ${selectedParty}: ${data[selectedParty]} %
    </div>`;
  }

  html += '<table>';
  for (const [party, col] of Object.entries(PARTY_COLORS)) {
    if (data[party] === undefined) continue;
    const sel = party === selectedParty ? ' class="selected-party"' : '';
    html += `<tr${sel}>
      <td><span class="color-dot" style="background:${col}"></span></td>
      <td>${party}</td>
      <td>${data[party]} %</td>
    </tr>`;
  }
  html += '</table>';

  box.innerHTML = html;
}

function resetInfoBox() {
  const box = document.getElementById('info-box');
  box.innerHTML = selectedParty
    ? '<p class="hint">Beweeg over een postcodegebied voor details.</p>'
    : '<p class="hint">Selecteer een partij en beweeg over een postcodegebied voor details.</p>';
}

// ── Map update ──────────────────────────────────────────────────────────────

function updateMapColors() {
  if (!geojsonLayer) return;

  geojsonLayer.setStyle(styleFeature);

  geojsonLayer.eachLayer(layer => {
    if (layer.feature) {
      const pc = getPostcode(layer.feature);
      layer.setTooltipContent(buildTooltip(pc));
    }
  });

  updateLegend();
  resetInfoBox();
}

function updateLegend() {
  const section = document.getElementById('legend-section');
  if (!selectedParty) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const col = PARTY_COLORS[selectedParty] ?? '#888888';
  document.getElementById('legend-gradient').style.background =
    `linear-gradient(to right, #ffffff, ${col})`;

  const values = Object.values(votingData)
    .map(d => d[selectedParty])
    .filter(v => typeof v === 'number');
  const max = values.length > 0 ? Math.max(...values) : 0;
  document.getElementById('legend-max').textContent = `${max} %`;
}

// ── Party select ────────────────────────────────────────────────────────────

function populatePartySelect() {
  const select = document.getElementById('party-select');

  for (const party of Object.keys(PARTY_COLORS)) {
    const opt = document.createElement('option');
    opt.value       = party;
    opt.textContent = party;
    select.appendChild(opt);
  }

  select.addEventListener('change', e => {
    selectedParty = e.target.value || null;
    updateMapColors();
  });
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

async function init() {
  initMap();
  populatePartySelect();

  try {
    const [, geojson] = await Promise.all([loadCSVData(), fetchGeoJSON()]);

    geojsonLayer = L.geoJSON(geojson, {
      style:          styleFeature,
      onEachFeature,
    }).addTo(map);

    if (geojsonLayer.getLayers().length > 0) {
      map.fitBounds(geojsonLayer.getBounds(), { padding: [20, 20] });
    }

    document.getElementById('loading-msg').hidden = true;

  } catch (err) {
    console.error('Initialisatiefout:', err);
    document.getElementById('loading-msg').hidden = true;
    const errorEl = document.getElementById('error-msg');
    errorEl.hidden = false;
    document.getElementById('error-text').textContent = `⚠️ ${err.message}`;
  }
}

document.addEventListener('DOMContentLoaded', init);
