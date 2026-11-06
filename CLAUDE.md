# Mercator Lab

A globe inside a cylinder that unrolls into a wall map, with great-circle and rhumb-line routes that follow
along. One view (`/`); `/unroll/` only redirects old links. See README.md for the file layout.

Follows the app standards in [csciuto/app-template STANDARDS.md](https://github.com/csciuto/app-template/blob/main/STANDARDS.md).
Commit and push freely once tests pass.

## Conventions

- Static site, no build step and no framework unless there's a real need. `.github/workflows/deploy.yml` runs every test on each push to `main`, stamps the version (`v1.<commits>`, replacing `dev` in each page's `.version`) and only then publishes to https://corey.sciu.to/mercator-lab/.
- Math lives in pure files (`geo.js`, `sphere.js`, `lines.js`) loaded as classic scripts and exported for Node with `module.exports`. Test it in `tests/*.test.js`; keep DOM and d3/three out of those files.
- One view, on purpose: it used to be two (a 2D Routes map and Unroll the globe) and they were merged. Add to
  this view rather than starting a second one.
- At Unroll the 3D stage is the wall map (the side map hides, clicks land on the sheet). Don't show the same map
  twice.
- Routes travel in the address (`#lines=…`); the app rewrites it whenever they change.
- Keep `npm run test:all` passing: unit tests (`npm test`), then browser tests at desktop and phone size with axe accessibility checks (`npm run test:e2e`). Tag desktop-only browser tests `@desktop`.
- Visible text: labels, not sentences. Explanations go on `help.html`.
- New pages need the footer line (help, contact, `.version`) and an entry in `e2e/a11y.spec.js`.
- After visible UI changes, run `npm run screenshot` and commit the new `preview.png` and `help-unroll.png`. It's used for link previews and on https://corey.sciu.to/projects/.
- The repo's description, homepage URL and `corey-app` topic are what list it on the projects page. Keep the description to one plain sentence.
