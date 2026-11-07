// Rotation and cylinder math behind Unroll the globe: run with `node --test`.
const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(global, require('../geo.js'));  // sphere.js expects geo.js loaded first, as in the page
const S = require('../sphere.js');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('vec and lonlat are inverses', () => {
  for (const c of [[0, 0], [-71.06, 42.36], [151.21, -33.87], [179, 80]]) {
    const back = S.lonlat(S.vec(...c));
    near(back[0], c[0]); near(back[1], c[1]);
  }
});

test('d3R and euler round-trip', () => {
  const [l, p, g] = S.euler(S.d3R(30, -20, 45));
  near(l, 30); near(p, -20); near(g, 45);
});

test('Mercator heights invert and match psi', () => {
  for (const lat of [-60, -10, 0, 25, 70]) near(S.cylLat(S.cylH(rad(lat))), rad(lat), 1e-12);
  near(S.cylH(rad(45)), psi(rad(45)));
  near(S.MAXH, psi(rad(MAXLAT)));
});

test('says where the cylinder touches the globe', () => {
  const M = (G, C) => S.mmul(S.mT(C), G);
  assert.equal(S.touchLabel(S.ident()), 'Touches along the equator');
  assert.equal(S.touchLabel(M(S.d3R(40, 0, 0), S.ident())), 'Touches along the equator');      // spinning the Earth doesn't change it
  assert.match(S.touchLabel(M(S.ident(), S.d3R(0, 0, -90))), /^Touches along the \d+°[EW]? ?meridian$|^Touches along the 0° meridian$/);
  assert.equal(S.touchLabel(M(S.ident(), S.d3R(0, 0, -45))), 'Touches along a circle 45° off the equator');
});

test('orthonormalize leaves a rotation a rotation', () => {
  const M = S.orthonormalize(S.d3R(12, 34, 56).map((r) => r.map((x) => x * 1.001)));
  const I = S.mmul(M, S.mT(M));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(I[i][j], i === j ? 1 : 0, 1e-12);
});

test('Along route: the cylinder touches along the great circle, so the route lies on the map\'s center line', () => {
  const a = [-0.13, 51.51], b = [139.69, 35.69], G = S.d3R(30, 10, 5);
  const C = S.alongRoute(G, a, b), M = S.mmul(S.mT(C), G);
  near(S.mmul(C, S.mT(C))[0][0], 1, 1e-12);                       // a rotation
  assert.ok(S.onCylEquator(M, a, b, 1e-6));
  for (const t of [0.25, 0.5, 0.75]) near(S.lonlat(S.mv(M, S.vec(...gcInterp(a, b, t))))[1], 0, 1e-6);
  near(S.lonlat(S.mv(M, S.vec(...gcInterp(a, b, 0.5))))[0], 0, 1e-6);   // midpoint at the map's center
  assert.ok(S.lonlat(S.mv(M, S.vec(...a)))[0] < S.lonlat(S.mv(M, S.vec(...b)))[0]);  // a west of b
  assert.equal(S.alongRoute(G, a, a), null);
  assert.ok(!S.onCylEquator(S.mmul(S.mT(S.ident()), G), a, b));
});
