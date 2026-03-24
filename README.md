# Verkiezingsuitslagen Tilburg

Een interactieve web-app die de uitslagen van de **Tweede Kamer­verkiezingen 2023** per postcode visualiseert op de kaart van Tilburg.

## Functionaliteit

| Kenmerk | Beschrijving |
|---|---|
| 🗺️ Kaart van Tilburg | Interactieve Leaflet-kaart op basis van OpenStreetMap |
| 📮 Postcodegebieden | PC4-gebieden worden live opgehaald via de PDOK CBS WFS-service |
| 🗳️ Partijkeuze | Dropdown met alle deelnemende partijen |
| 🌈 Choropleet | Kleurgradiënt per postcodegebied op basis van stempercentage |
| 📋 Detailpaneel | Hover-tooltip + zijbalk met complete uitslag per gebied |
| 📥 Brondata | CSV-bestand downloadbaar via de zijbalk |

## Starten

Serveer de map als statische website, bijv. via:

```bash
# Python 3
python3 -m http.server 8080
# Node.js (npx)
npx serve .
```

Open daarna <http://localhost:8080> in de browser.

> **Let op:** De postcodegebieden worden opgehaald van `service.pdok.nl`. Een internetverbinding is vereist.

## Brondata

Het bestand `data/verkiezingen_tilburg.csv` bevat het stempercentage per PC4-postcodegebied en per partij.
Kolommen: `postcode`, `wijk`, `totaal_stemmen`, `VVD`, `D66`, `PVV`, `CDA`, `SP`, `GL-PvdA`, `ChristenUnie`, `PvdD`, `NSC`, `BBB`, `DENK`, `Volt`, `Overig`.

## Technische stack

- [Leaflet.js](https://leafletjs.com/) – kaartbibliotheek
- [PapaParse](https://www.papaparse.com/) – CSV-parsing in de browser
- [PDOK CBS gebiedsindelingen WFS](https://www.pdok.nl/) – postcodegebied-geometrieën (PC4)
- OpenStreetMap – achtergrondtegels
