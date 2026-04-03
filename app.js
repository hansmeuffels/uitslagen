'use strict';

import { datasets } from './data/datasets.js';

// ── Configuration ──────────────────────────────────────────────────────────

const TILBURG_CENTER = [51.5655, 5.0913];
const TILBURG_ZOOM   = 12;

/** Human-readable neighbourhood names per PC4 (fallback when data has no wijk). */
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
let geojsonData        = null;  // GeoJSON for the current dataset
let geojsonCache       = {};    // cache by geojsonFile path
let votingData         = {};    // { key: { party: value, … } }
let selectedParty      = null;
let selectedDatasetIdx = 0;

// ── Helpers for current dataset ─────────────────────────────────────────────

function currentDataset()    { return datasets[selectedDatasetIdx]; }
function currentPartyColors(){ return currentDataset().partyColors; }
function currentValueLabel() { return currentDataset().valueLabel; }

/** True when the loaded GeoJSON uses Point geometry (circle rendering). */
function isCircleDataset() {
  return geojsonData
    && geojsonData.features.length > 0
    && geojsonData.features[0].geometry.type === 'Point';
}

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
    const key = String(row.postcode);
    if (key && key !== 'undefined') votingData[key] = row;
  });
}

// ── GeoJSON fetching (with per-file cache) ──────────────────────────────────

async function fetchGeoJSON() {
  const file = currentDataset().geojsonFile;
  if (geojsonCache[file]) return geojsonCache[file];

  const res = await fetch(file);
  if (!res.ok) throw new Error(`Kon ${file} niet laden (${res.status})`);
  const data = await res.json();
  geojsonCache[file] = data;
  return data;
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

// ── Circle radius ───────────────────────────────────────────────────────────

/** Radius (px) scaled by √(votes / maxVotes) between MIN and MAX. */
function getCircleRadius(votes, maxVotes) {
  const MIN_R = 6, MAX_R = 28;
  if (!votes || !maxVotes) return MIN_R;
  return Math.round(MIN_R + (MAX_R - MIN_R) * Math.sqrt(votes / maxVotes));
}

// ── Value helpers ────────────────────────────────────────────────────────────

/** Return the percentage for a party in a data row. */
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

/**
 * Extract the voting-data lookup key from a GeoJSON feature.
 * For keyType 'pc4': uses postcode4naam or Postcode property (4 digits).
 * For keyType 'pc6': concatenates Postcode + WijkLetters (e.g. "5035BR").
 */
function getPostcodeKey(feature) {
  const ds = currentDataset();
  const p  = feature.properties;
  if (ds.keyType === 'pc6') {
    return String(p.Postcode ?? '') + String(p.WijkLetters ?? '');
  }
  return String(p.postcode4naam ?? p.Postcode ?? '');
}

/** Return a display label for a data key (neighbourhood or stembureau name). */
function getLabel(key) {
  const row = votingData[key];
  if (row && row.naam) return row.naam;   // PC6: stembureau name
  if (row && row.wijk) return row.wijk;   // explicit neighbourhood name
  return NEIGHBORHOOD_NAMES[key] ?? '';   // PC4 fallback
}

// ── Choropleth (polygon) style ───────────────────────────────────────────────

function styleFeature(feature) {
  if (!selectedParty) {
    return { fillColor: '#b0bec5', weight: 1, color: '#607d8b', fillOpacity: 0.4 };
  }

  const key         = getPostcodeKey(feature);
  const data        = votingData[key];
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

// ── Tooltip / sidebar ────────────────────────────────────────────────────────

function buildTooltip(key) {
  const data  = votingData[key];
  const label = getLabel(key);
  let html = `<strong>${key}</strong>${label ? ` – ${label}` : ''}`;
  if (data && selectedParty && data[selectedParty] !== undefined) {
    const pct   = getPercentage(data, selectedParty);
    const votes = getVoteCount(data, selectedParty);
    html += `<br>${selectedParty}: <strong>${pct}%</strong>`;
    if (votes !== null) html += ` <span style="opacity:.7">(${votes} stemmen)</span>`;
  }
  return html;
}

function showInfoBox(key) {
  const box         = document.getElementById('info-box');
  const data        = votingData[key];
  const label       = getLabel(key);
  const partyColors = currentPartyColors();

  let html = `<h3>${key}${label ? ` – ${label}` : ''}</h3>`;

  if (!data) {
    html += '<p class="hint">Geen kiesdata beschikbaar voor dit gebied.</p>';
    box.innerHTML = html;
    return;
  }

  html += `<p class="hint" style="margin-bottom:8px">Totaal: <strong style="color:#e8edf2">${data.totaal_stemmen.toLocaleString('nl')}</strong> stemmen</p>`;

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
    const sel   = party === selectedParty ? ' class="selected-party"' : '';
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
  const area = currentDataset().keyType === 'pc6' ? 'stembureau' : 'postcodegebied';
  box.innerHTML = selectedParty
    ? `<p class="hint">Beweeg over een ${area} voor details.</p>`
    : `<p class="hint">Selecteer een partij en beweeg over een ${area} voor details.</p>`;
}

// ── Feature interaction ──────────────────────────────────────────────────────

function onEachFeature(feature, layer) {
  const key     = getPostcodeKey(feature);
  const isPoint = feature.geometry.type === 'Point';
  const radius  = isPoint && layer.getRadius ? layer.getRadius() : 6;

  layer.bindTooltip(buildTooltip(key), {
    sticky:    true,
    direction: 'top',
    offset:    [0, isPoint ? -radius : -6],
  });

  layer.on({
    mouseover(e) {
      e.target.setStyle({ weight: 3, color: isPoint ? '#f0f0f0' : '#ffffff' });
      e.target.bringToFront();
      showInfoBox(key);
    },
    mouseout(e) {
      if (isPoint) {
        e.target.setStyle({ weight: 1.5, color: '#ffffff' });
      } else {
        geojsonLayer.resetStyle(e.target);
      }
      resetInfoBox();
    },
    click(e) {
      if (isPoint) {
        map.setView(e.target.getLatLng(), 15);
      } else {
        map.fitBounds(e.target.getBounds(), { padding: [30, 30] });
      }
    },
  });
}

// ── Layer rendering ──────────────────────────────────────────────────────────

function renderLayer() {
  if (geojsonLayer) { map.removeLayer(geojsonLayer); geojsonLayer = null; }
  if (!geojsonData)  return;

  if (isCircleDataset()) {
    // Circles (Point GeoJSON): only show features with matching vote data
    const filteredData = {
      ...geojsonData,
      features: geojsonData.features.filter(f => votingData[getPostcodeKey(f)] !== undefined),
    };

    const maxVotes = Math.max(
      ...Object.values(votingData).map(d => d.totaal_stemmen || 0), 1
    );

    geojsonLayer = L.geoJSON(filteredData, {
      pointToLayer(feature, latlng) {
        const key    = getPostcodeKey(feature);
        const row    = votingData[key];
        const radius = getCircleRadius(row ? row.totaal_stemmen : 0, maxVotes);

        let fillColor;
        if (selectedParty && row) {
          const col = currentPartyColors()[selectedParty] ?? '#888888';
          fillColor = getColor(getPercentage(row, selectedParty), col);
        } else {
          fillColor = '#607d8b';
        }

        return L.circleMarker(latlng, {
          radius,
          fillColor,
          fillOpacity: 0.85,
          color:       '#ffffff',
          weight:      1.5,
        });
      },
      onEachFeature,
    }).addTo(map);

  } else {
    // Choropleth (Polygon GeoJSON)
    geojsonLayer = L.geoJSON(geojsonData, {
      style:         styleFeature,
      onEachFeature,
    }).addTo(map);
  }
}

// ── Map update ───────────────────────────────────────────────────────────────

function updateMapColors() {
  if (!geojsonLayer) return;

  if (isCircleDataset()) {
    // Update each circle's fill colour without rebuilding the layer
    const partyColors = currentPartyColors();
    geojsonLayer.eachLayer(layer => {
      if (!layer.feature) return;
      const key = getPostcodeKey(layer.feature);
      const row = votingData[key];
      let fillColor;
      if (selectedParty && row) {
        const col = partyColors[selectedParty] ?? '#888888';
        fillColor = getColor(getPercentage(row, selectedParty), col);
      } else {
        fillColor = '#607d8b';
      }
      layer.setStyle({ fillColor });
      layer.setTooltipContent(buildTooltip(key));
    });

  } else {
    geojsonLayer.setStyle(styleFeature);

    geojsonLayer.eachLayer(layer => {
      if (layer.feature) {
        const key = getPostcodeKey(layer.feature);
        layer.setTooltipContent(buildTooltip(key));
      }
    });
  }

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
    const opt       = document.createElement('option');
    opt.value       = i;
    opt.textContent = ds.title;
    select.appendChild(opt);
  });

  select.addEventListener('change', async e => {
    selectedDatasetIdx = Number(e.target.value);
    selectedParty      = null;

    loadDatasetData();

    // Reset and repopulate party selector
    const partySelect = document.getElementById('party-select');
    partySelect.innerHTML = '<option value="">— selecteer een partij —</option>';
    populatePartySelect();

    // Load GeoJSON for the new dataset (uses cache when available)
    try {
      geojsonData = await fetchGeoJSON();
    } catch (err) {
      console.error('GeoJSON laadfoute bij wisselen dataset:', err);
      geojsonData = null;
    }

    renderLayer();
    updateLegend();
    resetInfoBox();

    if (geojsonLayer) {
      const bounds = geojsonLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    }
  });
}

// ── Party select ────────────────────────────────────────────────────────────

function populatePartySelect() {
  const select      = document.getElementById('party-select');
  const partyColors = currentPartyColors();

  for (const party of Object.keys(partyColors)) {
    const opt       = document.createElement('option');
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
    geojsonData = await fetchGeoJSON();

    renderLayer();

    if (geojsonLayer) {
      const bounds = geojsonLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
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
