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
let circleLayer;
let geojsonData        = null;  // cached raw GeoJSON for re-use after dataset switch
let votingData         = {};    // { key: { party: value, … } }
let selectedParty      = null;
let selectedDatasetIdx = 0;

// ── Helpers for current dataset ─────────────────────────────────────────────

function currentDataset()    { return datasets[selectedDatasetIdx]; }
function currentPartyColors(){ return currentDataset().partyColors; }
function currentValueLabel() { return currentDataset().valueLabel; }
function isStembureau()      { return currentDataset().type === 'stembureau'; }

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
  currentDataset().data.forEach((row, i) => {
    // For stembureau datasets use index keys (multiple rows can share a postcode).
    // For choropleth datasets always key by postcode.
    const key = isStembureau() ? String(i) : String(row.postcode);
    if (key !== 'undefined') votingData[key] = row;
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

  // 2. Bundled real PC4 boundaries (sourced from georef-netherlands-postcode-pc4).
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

/** Blend white → partyColor proportionally to percentage / maxPercentage. */
function getColor(value, partyHex) {
  if (value === null || value === undefined) return '#cccccc';

  const values = Object.values(votingData)
    .map(d => getPercentage(d, selectedParty))
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

// ── Value helpers (percentage primary, votes secondary) ────────────────────

// ── Stembureau – circle radius ──────────────────────────────────────────────

/** Radius (px) scaled by √(votes / maxVotes) between MIN and MAX. */
function getCircleRadius(votes, maxVotes) {
  const MIN_R = 6, MAX_R = 28;
  if (!votes || !maxVotes) return MIN_R;
  return Math.round(MIN_R + (MAX_R - MIN_R) * Math.sqrt(votes / maxVotes));
}

// ── Stembureau – tooltip / sidebar ─────────────────────────────────────────

function buildStembureauTooltip(row) {
  let html = `<strong>${row.naam}</strong> <span style="opacity:.7">(${row.postcode})</span>`;
  html += `<br>Totaal: ${row.totaal_stemmen.toLocaleString('nl')} stemmen`;
  if (selectedParty && row[selectedParty] !== undefined) {
    const pct = getPercentage(row, selectedParty);
    html += `<br>${selectedParty}: <strong>${pct}%</strong>`
          + ` <span style="opacity:.7">(${row[selectedParty]} stemmen)</span>`;
  }
  return html;
}

function showStembureauInfoBox(row) {
  const box         = document.getElementById('info-box');
  const partyColors = currentPartyColors();

  let html = `<h3>${row.naam}</h3>`;
  html += `<p class="hint" style="margin-bottom:8px">${row.postcode} &nbsp;·&nbsp; `
        + `Totaal: <strong style="color:#e8edf2">${row.totaal_stemmen.toLocaleString('nl')}</strong> stemmen</p>`;

  if (selectedParty && row[selectedParty] !== undefined) {
    const col   = partyColors[selectedParty] ?? '#888888';
    const pct   = getPercentage(row, selectedParty);
    html += `<div class="party-highlight">
      <span class="color-dot" style="background:${col}"></span>
      ${selectedParty}: ${pct}% (${row[selectedParty]} stemmen)
    </div>`;
  }

  html += '<table>';
  for (const [party, col] of Object.entries(partyColors)) {
    if (row[party] === undefined) continue;
    const pct = getPercentage(row, party);
    const sel = party === selectedParty ? ' class="selected-party"' : '';
    html += `<tr${sel}>
      <td><span class="color-dot" style="background:${col}"></span></td>
      <td>${party}</td>
      <td>${pct}%</td>
      <td class="votes-cell">(${row[party]})</td>
    </tr>`;
  }
  html += '</table>';

  box.innerHTML = html;
}

// ── Stembureau – circle layer ───────────────────────────────────────────────

function renderStembureauLayer() {
  if (circleLayer) { map.removeLayer(circleLayer); circleLayer = null; }

  const ds = currentDataset();
  if (!ds.data || !ds.data.length) return;

  const maxVotes    = Math.max(...ds.data.map(d => d.totaal_stemmen || 0));
  const partyColors = currentPartyColors();

  circleLayer = L.featureGroup();

  ds.data.forEach(row => {
    if (row.lat == null || row.lng == null) return;

    const radius = getCircleRadius(row.totaal_stemmen, maxVotes);
    let fillColor;
    if (selectedParty) {
      const col = partyColors[selectedParty] ?? '#888888';
      fillColor = getColor(getPercentage(row, selectedParty), col);
    } else {
      fillColor = '#607d8b';
    }

    const circle = L.circleMarker([row.lat, row.lng], {
      radius,
      fillColor,
      fillOpacity: 0.85,
      color: '#ffffff',
      weight: 1.5,
    });

    circle.bindTooltip(buildStembureauTooltip(row), { sticky: true, direction: 'top', offset: [0, -radius] });

    circle.on({
      mouseover(e) {
        e.target.setStyle({ weight: 3, color: '#f0f0f0' });
        e.target.bringToFront();
        showStembureauInfoBox(row);
      },
      mouseout(e) {
        e.target.setStyle({ weight: 1.5, color: '#ffffff' });
        resetInfoBox();
      },
      click() {
        map.setView([row.lat, row.lng], 15);
      },
    });

    circleLayer.addLayer(circle);
  });

  circleLayer.addTo(map);
}

/** Return the percentage for a party in a data row, regardless of dataset type. */
function getPercentage(data, party) {
  if (!data || data[party] === undefined) return null;
  if (currentValueLabel() === '%') return data[party];
  return data.totaal_stemmen
    ? +(data[party] / data.totaal_stemmen * 100).toFixed(1)
    : null;
}

/** Return the absolute vote count for a party in a data row. */
function getVoteCount(data, party) {
  if (!data || data[party] === undefined) return null;
  if (currentValueLabel() !== '%') return data[party];
  return data.totaal_stemmen
    ? Math.round(data[party] * data.totaal_stemmen / 100)
    : null;
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
  const val         = data ? getPercentage(data, selectedParty) : null;
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
  let html = `<strong>${postcode}</strong>${hood ? ` – ${hood}` : ''}`;
  if (data && selectedParty && data[selectedParty] !== undefined) {
    const pct   = getPercentage(data, selectedParty);
    const votes = getVoteCount(data, selectedParty);
    html += `<br>${selectedParty}: <strong>${pct}%</strong>`;
    if (votes !== null) html += ` <span style="opacity:.7">(${votes} stemmen)</span>`;
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

  let html = `<h3>${postcode}${hood ? ` – ${hood}` : ''}</h3>`;

  if (!data) {
    html += '<p class="hint">Geen kiesdata beschikbaar voor dit gebied.</p>';
    box.innerHTML = html;
    return;
  }

  if (selectedParty && data[selectedParty] !== undefined) {
    const col   = partyColors[selectedParty] ?? '#888888';
    const pct   = getPercentage(data, selectedParty);
    const votes = getVoteCount(data, selectedParty);
    html += `<div class="party-highlight">
      <span class="color-dot" style="background:${col}"></span>
      ${selectedParty}: ${pct}%${votes !== null ? ` (${votes} stemmen)` : ''}
    </div>`;
  }

  html += '<table>';
  for (const [party, col] of Object.entries(partyColors)) {
    if (data[party] === undefined) continue;
    const pct   = getPercentage(data, party);
    const votes = getVoteCount(data, party);
    const sel = party === selectedParty ? ' class="selected-party"' : '';
    html += `<tr${sel}>
      <td><span class="color-dot" style="background:${col}"></span></td>
      <td>${party}</td>
      <td>${pct}%</td>
      <td class="votes-cell">${votes !== null ? `(${votes})` : ''}</td>
    </tr>`;
  }
  html += '</table>';

  box.innerHTML = html;
}

function resetInfoBox() {
  const box  = document.getElementById('info-box');
  const area = isStembureau() ? 'stembureau' : 'postcodegebied';
  box.innerHTML = selectedParty
    ? `<p class="hint">Beweeg over een ${area} voor details.</p>`
    : `<p class="hint">Selecteer een partij en beweeg over een ${area} voor details.</p>`;
}

// ── Map update ──────────────────────────────────────────────────────────────

function updateMapColors() {
  if (isStembureau()) {
    renderStembureauLayer();
    updateLegend();
    resetInfoBox();
    return;
  }

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
  const col = partyColors[selectedParty] ?? '#888888';
  document.getElementById('legend-gradient').style.background =
    `linear-gradient(to right, #ffffff, ${col})`;

  const values = Object.values(votingData)
    .map(d => getPercentage(d, selectedParty))
    .filter(v => typeof v === 'number');
  const max = values.length > 0 ? Math.max(...values) : 0;
  document.getElementById('legend-min').textContent = '0%';
  document.getElementById('legend-max').textContent = `${max}%`;
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

    if (isStembureau()) {
      // Hide choropleth layer; render circles instead
      if (geojsonLayer) map.removeLayer(geojsonLayer);
      renderStembureauLayer();
      updateLegend();
      resetInfoBox();
      const bounds = circleLayer ? circleLayer.getBounds() : null;
      if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    } else {
      // Remove circles; restore or recreate choropleth layer
      if (circleLayer) { map.removeLayer(circleLayer); circleLayer = null; }
      if (geojsonLayer) {
        geojsonLayer.addTo(map);
      } else if (geojsonData) {
        geojsonLayer = L.geoJSON(geojsonData, { style: styleFeature, onEachFeature }).addTo(map);
      }
      updateMapColors();
    }
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

  if (isStembureau()) {
    // Initial dataset is stembureau type – render circles immediately, skip GeoJSON load
    renderStembureauLayer();
    updateLegend();
    const bounds = circleLayer ? circleLayer.getBounds() : null;
    if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    document.getElementById('loading-msg').hidden = true;
    return;
  }

  try {
    const geojson = await fetchGeoJSON();
    geojsonData   = geojson;  // cache for re-use when switching back from stembureau

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
