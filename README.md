# Mercator Lab

**Live:** [corey.sciu.to/mercator-lab](https://corey.sciu.to/mercator-lab/)

Turn a globe inside a cylinder, unroll it into a wall map, and draw great-circle and rhumb-line routes that
follow along.

- **Routes:** search a city (6,000+ of 100,000 people or more) or type coordinates (`42.36, -71.06`,
  `42.36N 71.06W`, `42°21′36″N 71°3′36″W`), or click the globe or the wall map. Each route shows its distance in
  miles, kilometres and nautical miles and the course to steer; a rhumb line paired with its great circle shows
  how much longer it is.
- **Globe and cylinder:** turn either one, or both. Tilt the cylinder for transverse, oblique or polar Mercator,
  or switch to other cylindrical projections. Set how see-through the globe is.
- **Wall map:** **On globe → Project → Unroll.** Before Unroll the wall map shows beside the 3D view; at Unroll
  the cylinder lies flat and becomes it.
- **Compare:** freeze a projection as copy A, and move a country to see why size-comparison maps bend its
  borders.

Routes live in the address (`#lines=gc:lon,lat,lon,lat;rh:…`), so a view can be bookmarked or shared. Old
`/unroll/` links redirect to the app.

## Files

| | |
|---|---|
| `geo.js` | Great-circle and rhumb-line math, typed-coordinate parsing, search, formatting. Pure. |
| `sphere.js` | Rotations and cylinder projections. Pure. |
| `lines.js` | Routes in the address. |
| `world.js` | Natural Earth 110m countries (world-atlas TopoJSON), inlined so nothing is fetched. |
| `cities.js` | The labeled cities and when each appears as you zoom; `cityAt` names a point. |
| `places.js` | Cities for search, from GeoNames (CC BY 4.0). Built from `cities15000.txt`, keeping 100,000+ people. |
| `index.html`, `app.js` | The app (three.js r128). |
| `help.html` | The help page. |
| `unroll/index.html` | Redirect for old links. |

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
