const { buildMessage, buildSubject, recipientsFor, cheaperNote } = require('../src/notifier');

const changes = [
  { slug: 'tank-ono', name: 'Tank ONO', old: { natural95: 38.5, diesel: 42.9 }, new: { natural95: 37.9, diesel: 42.9 } },
  { slug: 'makro', name: 'Makro', old: { natural95: 37.9, diesel: 42.9 }, new: { natural95: 37.9, diesel: 42.5 } },
];
const latest = { 'tank-ono': { natural95: 37.9, diesel: 42.9 }, makro: { natural95: 37.9, diesel: 42.5 } };
const base = 'https://beno.dejny.eu';
const token = 'a'.repeat(32);

test('buildSubject (all prefs) is the compact two-station headline', () => {
  expect(buildSubject(changes)).toBe('ONO: N95 37,90 ↓0,60 · Makro: Nafta 42,50 ↓0,40');
});

test('message is filtered to the subscriber prefs', () => {
  const m = buildMessage(changes, { email: 'a@b.cz', token, stations: ['makro'], fuels: ['diesel', 'natural95'] }, { baseUrl: base, latest });
  expect(m.subject).toBe('Makro Trmice: Nafta ↓ 42,50 Kč (−0,40)');
  expect(m.html).toContain('42,90');
  expect(m.html).toContain('42,50');
  expect(m.html).not.toContain('Tank ONO Teplice</div>'); // no change row for ONO
});

test('returns null when nothing matches the prefs', () => {
  expect(buildMessage(changes, { email: 'a@b.cz', token, stations: ['tank-ono'], fuels: ['diesel'] }, { baseUrl: base, latest })).toBeNull();
});

test('html starts with the change table and carries manage + unsubscribe links', () => {
  const m = buildMessage(changes, { email: 'a@b.cz', token, stations: ['tank-ono', 'makro'], fuels: ['natural95', 'diesel'] }, { baseUrl: base, latest });
  const firstRow = m.html.indexOf('Tank ONO Teplice');
  expect(firstRow).toBeGreaterThan(0);
  expect(firstRow).toBeLessThan(m.html.indexOf('Aktuální ceny'));
  expect(m.html).toContain('−0,60');
  expect(m.html).toContain('#15803d'); // green for a drop
  expect(m.html).toContain(base + '/manage.html?token=' + token);
  expect(m.html).toContain(base + '/unsubscribe?token=' + token);
  expect(m.headers['List-Unsubscribe']).toBe('<' + base + '/unsubscribe?token=' + token + '>');
  expect(m.text).toMatch(/Tank ONO Teplice · Natural 95: 38,50 → 37,90 Kč \(−0,60\)/);
});

test('html escapes the recipient address', () => {
  const m = buildMessage(changes, { email: '<x>@b.cz', token }, { baseUrl: base, latest });
  expect(m.html).not.toContain('<x>@b.cz');
  expect(m.html).toContain('&lt;x&gt;@b.cz');
});

test('owner gets everything and is not duplicated if subscribed', () => {
  expect(recipientsFor([], 'me@x.cz')[0]).toMatchObject({ email: 'me@x.cz', stations: ['tank-ono', 'makro'] });
  const subs = [{ email: 'Me@x.cz', token, stations: ['makro'], fuels: ['diesel'] }];
  expect(recipientsFor(subs, 'me@x.cz')).toEqual(subs);
});

test('cheaperNote names the cheaper station per fuel', () => {
  expect(cheaperNote(latest, { stations: ['tank-ono', 'makro'], fuels: ['natural95', 'diesel'] }))
    .toBe('Natural 95 stojí stejně, nafta je levnější v Makru o 0,40 Kč.');
  expect(cheaperNote(latest, { stations: ['tank-ono', 'makro'], fuels: ['diesel'] }))
    .toBe('Nafta je levnější v Makru o 0,40 Kč.');
});
