# Mercator Lab

Draw great-circle and rhumb-line routes on a Mercator map, and watch a globe unroll into one. Two views:
Routes (`/`) and Unroll the globe (`/unroll/`). See README.md for the file layout.

## Conventions

- Static site, no build step and no framework unless there's a real need. GitHub Pages serves `main` at https://corey.sciu.to/mercator-lab/.
- Math lives in pure files (`geo.js`, `sphere.js`, `lines.js`) loaded as classic scripts and exported for Node with `module.exports`. Test it in `tests/*.test.js`; keep DOM and d3/three out of those files.
- Both views share `geo.js`, `world.js` and `lines.js`. Don't fork copies into a view.
- Routes travel in the address (`#lines=…`). Each view rewrites it whenever its routes change and points its link to the other view at the same routes.
- Keep `npm test` passing (unit tests, then `e2e/smoke.spec.js`).
- After visible UI changes, run `npm run screenshot` and commit the new `preview.png`. It's used for link previews and on https://corey.sciu.to/projects/.
- The repo's description, homepage URL and `corey-app` topic are what list it on the projects page. Keep the description to one plain sentence.
