# Mercator Lab

**Live:** [corey.sciu.to/mercator-lab](https://corey.sciu.to/mercator-lab/)

Draw great-circle and rhumb-line routes on a Mercator map, and watch a globe unroll into one.

- **Routes** (`/`): a full-screen Mercator map that zooms and wraps east–west. Click two points (or two of the
  120 labeled cities) for a great circle or a rhumb line, with distance in miles, kilometres and nautical miles
  and the course to steer.
- **Unroll the globe** (`/unroll/`): a 3D globe inside a cylinder. Project it, unroll it, try other cylinders,
  turn the globe or the cylinder, freeze a copy, and move a country to see why size-comparison maps bend its
  borders. The same routes ride along on the globe.

Routes live in the address (`#lines=gc:lon,lat,lon,lat;rh:…`), so a view can be bookmarked or shared, and the
link between the views carries them across.

## Files

| | |
|---|---|
| `geo.js` | Great-circle and rhumb-line math, formatting. Pure; shared by both views. |
| `sphere.js` | Rotations and cylinder projections for Unroll the globe. Pure. |
| `lines.js` | Routes in the address. |
| `world.js` | Natural Earth 110m countries (world-atlas TopoJSON), inlined so nothing is fetched. |
| `cities.js` | The labeled cities and when each appears as you zoom. |
| `index.html`, `routes.js` | Routes. |
| `unroll/index.html`, `unroll/unroll.js` | Unroll the globe (three.js r128). |

## Development

No build step: plain HTML, CSS and JavaScript, published by GitHub Pages from `main`.

```bash
npm run serve                                     # http://localhost:8090
npm install && npx playwright install chromium   # first time only
npm test                                          # unit tests (node --test) then the browser tests
npm run screenshot                                # refreshes preview.png, used for link previews
```
