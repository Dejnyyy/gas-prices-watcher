const fs = require('fs');
const path = require('path');
const { parseListing, joinFuels } = require('../../src/scrapers/mbenzin');

const n95Html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mbenzin-listing.html'), 'utf8');
const dieselHtml = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mbenzin-nafta.html'), 'utf8');

describe('parseListing', () => {
  test('parses Natural 95 stations with id, name, price', () => {
    const list = parseListing(n95Html, 'natural95');
    expect(list.length).toBeGreaterThan(20);
    const vs = list.find((s) => s.id === '18065');
    expect(vs).toMatchObject({ id: '18065', name: 'VS Petrol', natural95: 39.5 });
  });

  test('parses Diesel stations', () => {
    const list = parseListing(dieselHtml, 'diesel');
    const mol = list.find((s) => s.id === '18148');
    expect(mol).toMatchObject({ id: '18148', name: 'MOL', diesel: 37.5 });
  });
});

describe('joinFuels', () => {
  test('keeps only both-fuel stations and drops Tank ONO rows', () => {
    const joined = joinFuels(parseListing(n95Html, 'natural95'), parseListing(dieselHtml, 'diesel'));
    expect(joined.every((s) => s.natural95 != null && s.diesel != null)).toBe(true);
    expect(joined.some((s) => s.name === 'Tank ONO')).toBe(false);
    const vs = joined.find((s) => s.id === '18065');
    expect(vs).toMatchObject({ name: 'VS Petrol', natural95: 39.5, diesel: 42.5 });
  });
});
