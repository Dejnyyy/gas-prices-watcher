const { buildEmailHtml, buildSubject } = require('../src/notifier');

test('buildSubject includes date', () => {
  const subject = buildSubject(new Date('2026-04-17T14:32:00'));
  expect(subject).toContain('17.4.2026');
  expect(subject).toContain('14:32');
});

test('buildEmailHtml shows old and new prices with diff', () => {
  const oldPrices = { natural95: 35.90, diesel: 34.50, lpg: 18.20 };
  const newPrices = { natural95: 36.10, diesel: 34.50, lpg: 17.90 };
  const html = buildEmailHtml(oldPrices, newPrices, 'https://tankono.bagros.eu', 'test@example.com');

  expect(html).toContain('36.10');
  expect(html).toContain('35.90');
  expect(html).toContain('+0.20');
  expect(html).toContain('-0.30');
  expect(html).toContain('unsubscribe');
  expect(html).toContain('test@example.com');
});

test('buildEmailHtml shows dash for unchanged price', () => {
  const prices = { natural95: 34.50, diesel: 34.50, lpg: 18.20 };
  const html = buildEmailHtml(prices, prices, 'https://tankono.bagros.eu', 'test@example.com');
  expect(html).toContain('—');
});
