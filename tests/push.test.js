const { payloadForSubscriber, isValidPushEndpoint } = require('../src/push');

const changes = [
  { slug: 'tank-ono', name: 'Tank ONO', old: { natural95: 38.5, diesel: 42.9 }, new: { natural95: 37.9, diesel: 42.9 } },
];

test('payloadForSubscriber filters by fuel prefs', () => {
  expect(payloadForSubscriber(changes, { stations: ['tank-ono'], fuels: ['diesel'] })).toBeNull();
  const p = payloadForSubscriber(changes, { stations: ['tank-ono'], fuels: ['natural95'] }, { 'tank-ono': { natural95: 37.9, diesel: 42.9 } });
  expect(p.title).toBe('Tank ONO Teplice: Natural 95 ↓ 37,90 Kč (−0,60)');
});

test('isValidPushEndpoint keeps the SSRF allowlist', () => {
  expect(isValidPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
  expect(isValidPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
  expect(isValidPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
  expect(isValidPushEndpoint('https://169.254.169.254/latest')).toBe(false);
  expect(isValidPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
});
