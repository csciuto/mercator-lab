# Rhumb & Great Circle Plotter

**Live:** [corey.sciu.to/rhumb-great-circle](https://corey.sciu.to/rhumb-great-circle/)

Draw great-circle and rhumb-line routes on a Mercator world map and compare their distances.

## Development

No build step: plain HTML, CSS and JavaScript, published by GitHub Pages from `main`.

```bash
npm run serve                                     # http://localhost:8090
npm install && npx playwright install chromium   # first time only
npm test                                          # the app loads without JavaScript errors
npm run screenshot                                # refreshes preview.png, used for link previews
```
