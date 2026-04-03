const fs = require('fs');
const path = require('path');

const input = path.join(__dirname, '..', 'pc4 tilburg centered.csv');
const output = path.join(__dirname, '..', 'pc4_tilburg_centered.geojson');

const raw = fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, '').trim();
const lines = raw.split(/\r?\n/);
lines.shift();

const features = lines
  .map((line) => {
    if (!line.trim()) return null;

    const [Postcode, lat, long] = line.split(';');
    const latitude = parseFloat(lat);
    const longitude = parseFloat(long);

    if (!Postcode || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    if (latitude === 0 && longitude === 0) return null;

    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [longitude, latitude]
      },
      properties: {
        Postcode
      }
    };
  })
  .filter(Boolean);

const geojson = {
  type: 'FeatureCollection',
  features
};

fs.writeFileSync(output, JSON.stringify(geojson, null, 2) + '\n', 'utf8');
console.log(`Geschreven: ${output} (${features.length} features)`);