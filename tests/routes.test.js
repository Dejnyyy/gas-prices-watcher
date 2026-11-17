jest.mock('../src/db', () => ({
  addSubscriber: jest.fn(),
  getSubscriberByToken: jest.fn(),
  removeSubscriberByToken: jest.fn(),
  removeSubscriber: jest.fn(),
}));
jest.mock('../src/cron', () => ({ startCron: jest.fn() }));

const db = require('../src/db');
const { app } = require('../src/index');

let server;
let base;
beforeAll((done) => {
  server = app.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port; done(); });
});
afterAll((done) => { server.close(done); });
beforeEach(() => jest.clearAllMocks());

const post = (path, body, type = 'application/json') => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': type },
  body: type === 'application/json' ? JSON.stringify(body) : new URLSearchParams(body).toString(),
});

test('subscribe responds identically for new and existing addresses (no enumeration)', async () => {
  db.addSubscriber.mockResolvedValueOnce({ created: true }).mockResolvedValueOnce({ created: false });
  const a = await (await post('/api/subscribe', { email: 'x@y.cz', stations: ['makro'], fuels: ['diesel'] })).json();
  const b = await (await post('/api/subscribe', { email: 'x@y.cz', stations: ['makro'], fuels: ['diesel'] })).json();
  expect(a).toEqual({ ok: true });
  expect(b).toEqual({ ok: true });
  expect(db.addSubscriber).toHaveBeenCalledWith('x@y.cz', { stations: ['makro'], fuels: ['diesel'] });
});

test('subscribe rejects empty preference choices', async () => {
  const r = await post('/api/subscribe', { email: 'x@y.cz', stations: [], fuels: ['diesel'] });
  expect(r.status).toBe(400);
  expect(db.addSubscriber).not.toHaveBeenCalled();
});

test('legacy ?email= unsubscribe never deletes anything', async () => {
  const g = await fetch(base + '/unsubscribe?email=victim%40x.cz');
  expect(g.status).toBe(400);
  expect(await g.text()).toMatch(/nejnovějším e-mailu/);
  const p = await post('/unsubscribe', { email: 'victim@x.cz' }, 'application/x-www-form-urlencoded');
  expect(p.status).toBe(400);
  expect(db.removeSubscriber).not.toHaveBeenCalled();
  expect(db.removeSubscriberByToken).not.toHaveBeenCalled();
});

test('GET with token only confirms; POST with token unsubscribes', async () => {
  const token = 'b'.repeat(32);
  const g = await fetch(base + '/unsubscribe?token=' + token);
  expect(g.status).toBe(200);
  expect(db.removeSubscriberByToken).not.toHaveBeenCalled();
  db.getSubscriberByToken.mockResolvedValue({ token });
  const p = await fetch(base + '/unsubscribe?token=' + token, { method: 'POST' }); // RFC 8058 one-click
  expect(p.status).toBe(200);
  expect(db.removeSubscriberByToken).toHaveBeenCalledWith(token);
});

test('token-bearing pages are no-store', async () => {
  const token = 'c'.repeat(32);
  const u = await fetch(base + '/unsubscribe?token=' + token);
  expect(u.headers.get('cache-control')).toBe('no-store');
  const m = await fetch(base + '/manage.html?token=' + token);
  expect(m.headers.get('cache-control')).toBe('no-store');
  db.getSubscriberByToken.mockResolvedValue(null);
  const a = await fetch(base + '/api/subscription?token=' + token);
  expect(a.headers.get('cache-control')).toBe('no-store');
});

test('service worker never caches non-root navigations or tokenised URLs', () => {
  const sw = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  expect(sw).toMatch(/url\.pathname === '\/' && !url\.search/);
  expect(sw).toMatch(/no-store/);
  expect(sw).not.toMatch(/req\.mode === 'navigate' \? '\/' : req/);
});
