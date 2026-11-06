# Mercator Lab

**Live:** [corey.sciu.to/mercator-lab](https://corey.sciu.to/mercator-lab/)

Draw great-circle and rhumb-line routes on a Mercator map, and watch a globe unroll into one.

- **Routes** (`/`): a full-screen Mercator map that zooms and wraps east–west. Click two points, or search for
  a city (6,000+ of 100,000 people or more) or type coordinates (`42.36, -71.06`, `42.36N 71.06W`,
  `42°21′36″N 71°3′36″W`). Each route shows its distance in miles, kilometres and nautical miles and the course
  to steer; a rhumb line paired with its great circle shows how much longer it is.
- **Unroll the globe** (`/unroll/`): a 3D globe inside a cylinder. Project it, unroll it, try other cylinders,
  turn the globe or the cylinder, freeze a copy, and move a country to see why size-comparison maps bend its
  borders. The same routes ride along on the globe.

Routes live in the address (`#lines=gc:lon,lat,lon,lat;rh:…`), so a view can be bookmarked or shared, and the
link between the views carries them across.

## Files

| | |
|---|---|
| `geo.js` | Great-circle and rhumb-line math, typed-coordinate parsing, search, formatting. Pure; shared by both views. |
| `sphere.js` | Rotations and cylinder projections for Unroll the globe. Pure. |
| `lines.js` | Routes in the address. |
| `world.js` | Natural Earth 110m countries (world-atlas TopoJSON), inlined so nothing is fetched. |
| `cities.js` | The labeled cities and when each appears as you zoom; `cityAt` names a point. |
| `places.js` | Cities for search, from GeoNames (CC BY 4.0). Built from `cities15000.txt`, keeping 100,000+ people. |
| `index.html`, `routes.js` | Routes. |
| `help.html` | The help page. |
| `unroll/index.html`, `unroll/unroll.js` | Unroll the globe (three.js r128). |

## Development

No build step: plain HTML, CSS and JavaScript. Each push to `main` runs the tests in GitHub Actions and, if they
pass, publishes to GitHub Pages with a version stamp.

```bash
npm run serve                                     # http://localhost:8090
npm install && npx playwright install chromium   # first time only
npm test                                          # unit tests (node --test)
npm run test:e2e                                  # browser tests, desktop and phone, with accessibility checks
npm run screenshot                                # refreshes preview.png and the help page's picture
```
