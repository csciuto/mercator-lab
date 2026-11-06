# Rhumb & Great Circle Plotter

Draw great-circle and rhumb-line routes on a Mercator world map and compare their distances.

## Conventions

- Static site, no build step and no framework unless there's a real need. GitHub Pages serves `main` at https://corey.sciu.to/rhumb-great-circle/.
- Keep `index.html` at the repo root. If the app moves (e.g. into `docs/`), update the repo's homepage URL, the `og:` tags, and `APP`/`PREVIEW` in `e2e/smoke.spec.js` to match.
- Keep `e2e/smoke.spec.js` passing (`npm test`). Update its `READY` selector to an element that only appears once the app has rendered.
- After visible UI changes, run `npm run screenshot` and commit the new `preview.png`. It's used for link previews and on https://corey.sciu.to/projects/.
- The repo's description, homepage URL and `corey-app` topic are what list it on the projects page. Keep the description to one plain sentence.
