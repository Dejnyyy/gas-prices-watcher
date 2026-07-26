const { buildDigestHtml, buildSubject } = require('../src/notifier');

const changes = [
  { slug: 'tank-ono', name: 'Tank ONO', old: { natural95: 39.9, diesel: 38.9 }, new: { natural95: 39.5, diesel: 38.9 } },
  { slug: 'mbenzin-18065', name: 'VS Petrol', old: { natural95: 40.2, diesel: 39.9 }, new: { natural95: 40.5, diesel: 39.9 } },
];

test('buildSubject summarizes each changed station with direction', () => {
  const subject = buildSubject(changes);
  expect(subject).toContain('Tank ONO');
  expect(subject).toContain('VS Petrol');
  expect(subject).toMatch(/↓\s?0,40/);
  expect(subject).toMatch(/↑\s?0,30/);
});

test('buildSubject falls back when empty', () => {
  expect(buildSubject([])).toContain('změna cen');
});

test('buildDigestHtml renders a block per station and the unsubscribe link', () => {
  const html = buildDigestHtml(changes, 'https://beno.dejny.eu', 'a@b.cz');
  expect(html).toContain('Tank ONO');
  expect(html).toContain('VS Petrol');
  expect(html).toContain('39,50'); // new Tank ONO N95
  expect(html).toContain('/unsubscribe?email=a%40b.cz');
});
