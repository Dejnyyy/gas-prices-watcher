const { buildMessage, buildSubject, recipientsFor } = require('../src/notifier');

const changes = [
  { slug: 'tank-ono', name: 'Tank ONO', old: { natural95: 38.5, diesel: 42.9 }, new: { natural95: 37.9, diesel: 42.9 } },
];
const latest = { 'tank-ono': { natural95: 37.9, diesel: 42.9 } };
const base = 'https://beno.dejny.eu';
const token = 'a'.repeat(32);
const ONO = ['tank-ono'];

test('buildSubject is the change itself', () => {
  expect(buildSubject(changes)).toBe('Tank ONO: Natural 95 ↓ 37,90 Kč (−0,60)');
});

test('returns null when nothing matches the fuel prefs', () => {
  expect(buildMessage(changes, { email: 'a@b.cz', token, stations: ONO, fuels: ['diesel'] }, { baseUrl: base, latest })).toBeNull();
});

test('html starts with the change and carries manage + unsubscribe links, no comparison line', () => {
  const m = buildMessage(changes, { email: 'a@b.cz', token, stations: ONO, fuels: ['natural95', 'diesel'] }, { baseUrl: base, latest });
  expect(m.subject).toBe('Tank ONO: Natural 95 ↓ 37,90 Kč (−0,60)');
  const firstRow = m.html.indexOf('Tank ONO');
  expect(firstRow).toBeGreaterThan(0);
  expect(firstRow).toBeLessThan(m.html.indexOf('Aktuální ceny'));
  expect(m.html).toContain('−0,60');
  expect(m.html).toContain('42,90'); // current diesel price in the overview
  expect(m.html).toContain('#15803d'); // green for a drop
  expect(m.html).toContain(base + '/manage.html?token=' + token);
  expect(m.html).toContain(base + '/unsubscribe?token=' + token);
  expect(m.headers['List-Unsubscribe']).toBe('<' + base + '/unsubscribe?token=' + token + '>');
  expect(m.text).toMatch(/Tank ONO · Natural 95: 38,50 → 37,90 Kč \(−0,60\)/);
  expect(m.html + m.text).not.toMatch(/Makr|levnější/);
});

test('html escapes the recipient address', () => {
  const m = buildMessage(changes, { email: '<x>@b.cz', token }, { baseUrl: base, latest });
  expect(m.html).not.toContain('<x>@b.cz');
  expect(m.html).toContain('&lt;x&gt;@b.cz');
});

test('owner gets everything and is not duplicated if subscribed', () => {
  expect(recipientsFor([], 'me@x.cz')[0]).toMatchObject({ email: 'me@x.cz', stations: ONO, fuels: ['natural95', 'diesel'] });
  const subs = [{ email: 'Me@x.cz', token, stations: ONO, fuels: ['diesel'] }];
  expect(recipientsFor(subs, 'me@x.cz')).toEqual(subs);
});
