// Typed coordinates, city search, naming points, and the rhumb line's extra distance: run with `node --test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');
const { PLACES } = require('../places.js');
const { cityAt } = require('../cities.js');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const same = (got, want) => { assert.ok(got, 'parsed'); near(got[0], want[0]); near(got[1], want[1]); };

test('coordinates in the usual ways people write them', () => {
  same(G.parseCoord('42.36, -71.06'), [-71.06, 42.36]);
  same(G.parseCoord('42.36N 71.06W'), [-71.06, 42.36]);
  same(G.parseCoord('42.36 -71.06'), [-71.06, 42.36]);
  same(G.parseCoord('71.06W 42.36N'), [-71.06, 42.36]);                 // longitude first, said so by the letters
  same(G.parseCoord('42°21′36″N 71°3′36″W'), [-71.06, 42.36]);
  same(G.parseCoord("33 52' S, 151 12' E"), [151.2, -33 - 52 / 60]);
});

test('things that are not coordinates', () => {
  for (const s of ['boston', '1 2 3', '95, 10', '10, 190', '42N 71N', '']) assert.equal(G.parseCoord(s), null, s);
});

test('search: names that start with the query first, biggest first, accents ignored', () => {
  const r = G.searchPlaces(PLACES, 'bost');
  assert.equal(r[0][0], 'Boston');
  assert.equal(r[0][1], 'MA, US');
  assert.equal(G.searchPlaces(PLACES, 'sao paulo')[0][0], 'São Paulo');
  assert.ok(G.searchPlaces(PLACES, 'a').length <= 8);
  assert.deepEqual(G.searchPlaces(PLACES, '  '), []);
});

test('a route has both distances, and the rhumb line is never shorter', () => {
  const r = G.routeStats([-71.06, 42.36], [12.5, 41.9]);                  // Boston to Rome
  assert.ok(Math.abs(r.gc - 6586) < 10, String(r.gc));
  assert.ok(r.rh > r.gc && r.extraPct > 4 && r.extraPct < 5.5, String(r.extraPct));
  assert.ok(Math.abs(G.routeStats([0, 0], [30, 0]).extraPct) < 1e-9);    // along the equator they agree
  assert.ok(G.routeStats([-0.13, 51.51], [139.69, 35.69]).extraPct > 15); // London to Tokyo
});

test('a click names the nearest city within reach, or nothing', () => {
  assert.equal(G.nearestPlace(PLACES, [-71.0, 42.3], 50)[0].includes('Boston'), true);
  assert.equal(G.nearestPlace(PLACES, [-40, 30], 50), null);              // mid-Atlantic
});

test('points are named from the labeled cities, then the search list', () => {
  assert.equal(cityAt([-71.06, 42.36]), 'Boston');
  assert.equal(cityAt([-71.05, 42.33]), undefined);
  assert.equal(cityAt([-71.05, 42.33], PLACES), 'South Boston');
});
