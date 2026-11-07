# Mercator Lab

**Live:** [corey.sciu.to/mercator-lab](https://corey.sciu.to/mercator-lab/)

Built with [Claude Code](https://claude.com/claude-code).

A globe inside a Mercator cylinder: project the map onto it, unroll it into a wall map, and draw routes that
follow along.

- **Steps:** Globe → Project → Unroll.
- **Routes:** From and To take a city (6,000+ of 100,000 people or more) or coordinates (`42.36, -71.06`,
  `42.36N 71.06W`), or a click on the globe or map. Each route is drawn as a great circle and a rhumb line, with
  both distances and the rhumb line's extra.
- **Globe and cylinder:** turn either one, or both. Normal, transverse and oblique presets. Globe opacity.
- **Freeze:** keep a copy of the map on the cylinder to compare cylinder positions.

Routes live in the address (`#routes=lon,lat,lon,lat;…`). Older `#lines=` links and `/unroll/` links still open.

## Files

| | |
|---|---|
| `geo.js` | Great-circle and rhumb-line math, typed-coordinate parsing, search, formatting. Pure. |
| `sphere.js` | Rotations, the Mercator cylinder, where it touches the globe. Pure. |
| `lines.js` | Routes in the address. |
| `world.js` | Natural Earth 110m countries (world-atlas TopoJSON), inlined so nothing is fetched. |
| `cities.js` | The labeled cities and when each appears as you zoom; `cityAt` names a point. |
| `places.js` | Cities for search, from GeoNames (CC BY 4.0). Built from `cities15000.txt`, keeping 100,000+ people. |
| `index.html`, `app.js` | The app (three.js r128): the 3D scene, routes, controls. |
| `search.js` | The From and To boxes. |
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
