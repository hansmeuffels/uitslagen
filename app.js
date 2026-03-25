'use strict';

import { datasets } from './data/datasets.js';

// ── Configuration ──────────────────────────────────────────────────────────

const TILBURG_CENTER = [51.5655, 5.0913];
const TILBURG_ZOOM   = 12;

/**
 * PC4 postal codes that belong to the municipality of Tilburg (incl. Udenhout,
 * Berkel-Enschot, Biezenmortel).  Used to filter the PDOK WFS response.
 */
const TILBURG_POSTCODES = [
  '5011','5012','5013','5014','5015','5016','5017','5018','5019',
  '5021','5022','5023','5024','5025','5026','5027','5028',
  '5031','5032','5033','5034','5035','5036','5037','5038',
  '5041','5042','5043','5044','5045','5046','5047','5048','5049',
  '5056','5057','5071','5074',
];

/** Human-readable neighbourhood names per PC4 (fallback for TK2023 dataset). */
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
  '5056': 'Berkel-Enschot',
  '5057': 'Berkel-Enschot',
  '5071': 'Udenhout',
  '5074': 'Biezenmortel',
};

// ── State ───────────────────────────────────────────────────────────────────

let map;
let geojsonLayer;
let votingData         = {};   // { postcode: { party: value, … } }
let selectedParty      = null;
let selectedDatasetIdx = 0;

// ── Helpers for current dataset ─────────────────────────────────────────────

function currentDataset()    { return datasets[selectedDatasetIdx]; }
function currentPartyColors(){ return currentDataset().partyColors; }
function currentValueLabel() { return currentDataset().valueLabel; }

// ── Map initialisation ──────────────────────────────────────────────────────

function initMap() {
  map = L.map('map', { center: TILBURG_CENTER, zoom: TILBURG_ZOOM });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
}

// ── Dataset loading ─────────────────────────────────────────────────────────

function loadDatasetData() {
  votingData = {};
  currentDataset().data.forEach(row => {
    if (row.postcode) {
      votingData[String(row.postcode)] = row;
    }
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

/** Blend white → partyColor proportionally to value / maxValue. */
function getColor(value, partyHex) {
  if (value === null || value === undefined) return '#cccccc';

  const values = Object.values(votingData)
    .map(d => d[selectedParty])
    .filter(v => typeof v === 'number');
  const maxVal = values.length > 0 ? Math.max(...values) : 40;

  const factor = Math.min(value / maxVal, 1);
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

function getNeighborhood(postcode) {
  return (votingData[postcode] && votingData[postcode].wijk)
    ? votingData[postcode].wijk
    : (NEIGHBORHOOD_NAMES[postcode] ?? '');
}

// ── Leaflet style / interaction ─────────────────────────────────────────────

function styleFeature(feature) {
  if (!selectedParty) {
    return { fillColor: '#b0bec5', weight: 1, color: '#607d8b', fillOpacity: 0.4 };
  }

  const pc          = getPostcode(feature);
  const data        = votingData[pc];
  const val         = data ? data[selectedParty] : null;
  const partyColors = currentPartyColors();
  const col         = partyColors[selectedParty] ?? '#888888';

  return {
    fillColor: getColor(val, col),
    weight:       1,
    color:        '#607d8b',
    fillOpacity:  0.85,
  };
}

function buildTooltip(postcode) {
  const data  = votingData[postcode];
  const hood  = getNeighborhood(postcode);
  const label = currentValueLabel();
  let html = `<strong>${postcode}</strong>${hood ? ` – ${hood}` : ''}`;
  if (data && selectedParty && data[selectedParty] !== undefined) {
    html += `<br>${selectedParty}: <strong>${data[selectedParty]} ${label}</strong>`;
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
  const box         = document.getElementById('info-box');
  const data        = votingData[postcode];
  const hood        = getNeighborhood(postcode);
  const partyColors = currentPartyColors();
  const label       = currentValueLabel();

  let html = `<h3>${postcode}${hood ? ` – ${hood}` : ''}</h3>`;

  if (!data) {
    html += '<p class="hint">Geen kiesdata beschikbaar voor dit gebied.</p>';
    box.innerHTML = html;
    return;
  }

  if (selectedParty && data[selectedParty] !== undefined) {
    const col = partyColors[selectedParty] ?? '#888888';
    html += `<div class="party-highlight">
      <span class="color-dot" style="background:${col}"></span>
      ${selectedParty}: ${data[selectedParty]} ${label}
    </div>`;
  }

  html += '<table>';
  for (const [party, col] of Object.entries(partyColors)) {
    if (data[party] === undefined) continue;
    const sel = party === selectedParty ? ' class="selected-party"' : '';
    html += `<tr${sel}>
      <td><span class="color-dot" style="background:${col}"></span></td>
      <td>${party}</td>
      <td>${data[party]} ${label}</td>
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

  const partyColors = currentPartyColors();
  const label       = currentValueLabel();
  const col = partyColors[selectedParty] ?? '#888888';
  document.getElementById('legend-gradient').style.background =
    `linear-gradient(to right, #ffffff, ${col})`;

  const values = Object.values(votingData)
    .map(d => d[selectedParty])
    .filter(v => typeof v === 'number');
  const max = values.length > 0 ? Math.max(...values) : 0;
  document.getElementById('legend-min').textContent = `0 ${label}`;
  document.getElementById('legend-max').textContent = `${max} ${label}`;
}

// ── Dataset select ──────────────────────────────────────────────────────────

function populateDatasetSelect() {
  const select = document.getElementById('dataset-select');

  datasets.forEach((ds, i) => {
    const opt = document.createElement('option');
    opt.value       = i;
    opt.textContent = ds.title;
    select.appendChild(opt);
  });

  select.addEventListener('change', e => {
    selectedDatasetIdx = Number(e.target.value);
    selectedParty = null;

    loadDatasetData();

    // Reset and repopulate party selector
    const partySelect = document.getElementById('party-select');
    partySelect.innerHTML = '<option value="">— selecteer een partij —</option>';
    populatePartySelect();

    updateMapColors();
  });
}

// ── Party select ────────────────────────────────────────────────────────────

function populatePartySelect() {
  const select      = document.getElementById('party-select');
  const partyColors = currentPartyColors();

  for (const party of Object.keys(partyColors)) {
    const opt = document.createElement('option');
    opt.value       = party;
    opt.textContent = party;
    select.appendChild(opt);
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

async function init() {
  initMap();
  loadDatasetData();
  populateDatasetSelect();
  populatePartySelect();

  document.getElementById('party-select').addEventListener('change', e => {
    selectedParty = e.target.value || null;
    updateMapColors();
  });

  try {
    const geojson = await fetchGeoJSON();

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
