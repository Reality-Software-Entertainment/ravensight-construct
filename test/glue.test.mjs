// The Construct glue under node, in worker mode (no page), against the real
// Ravensight JavaScript SDK and a fake server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SDK from 'ravensight';
import { gunzipSync } from 'node:zlib';
import '../src/glue.js';

const Glue = globalThis.RavensightConstructGlue;
const ORIGIN = { session: 'ses_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', build: '1.0.0', platform: 'web', stamp: 'o1.a.b' };
const CONFIG = { values: { jump: 7, title: 'Hi' }, experiments: [{ key: 'jump_test', variant: 'high' }], etag: '"' + 'a'.repeat(64) + '"' };

/** The request body as text, gunzipped when it was sent compressed. */
function bodyText(init) {
  const encoding = init.headers && (init.headers['Content-Encoding'] || init.headers['content-encoding']);
  if (encoding === 'gzip') return gunzipSync(Buffer.from(init.body)).toString('utf8');
  return String(init.body);
}

function server(state = {}) {
  const seen = [];
  const fetch = async (url, init = {}) => {
    seen.push({ url, init });
    if (state.offline) throw new TypeError('fetch failed');
    const reply = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/settings')) return reply(200, { trackingEnabled: true });
    if (url.includes('/session')) return reply(201, { token: 'tok', expiresIn: 3600, origin: state.origin || ORIGIN });
    if (url.includes('/ingest/config')) return reply(200, CONFIG);
    if (url.includes('/track/batch')) return reply(202, { accepted: JSON.parse(bodyText(init)).events.length });
    if (url.includes('/feedback')) return reply(201, { ok: true });
    return reply(404, {});
  };
  const events = () =>
    seen.filter((r) => r.url.includes('/track/batch')).flatMap((r) => JSON.parse(bodyText(r.init)).events);
  return { fetch, seen, events };
}

/** runtime.storage as Construct gives it: every call a promise. */
function asyncStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
    keys: async () => [...map.keys()],
  };
}

function fakeRuntime(storage, platformInfo = { exportType: 'html5', os: 'Windows' }) {
  const handlers = new Map();
  return {
    storage,
    platformInfo,
    projectVersion: '2.1.0',
    handlers,
    addEventListener(type, fn) {
      handlers.set(type, (handlers.get(type) || []).concat(fn));
    },
    removeEventListener(type, fn) {
      handlers.set(type, (handlers.get(type) || []).filter((f) => f !== fn));
    },
    emit(type) {
      for (const fn of handlers.get(type) || []) fn();
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

function start(srv, runtime, props = {}, extra = {}) {
  const triggers = [];
  const warnings = [];
  const rs = Glue.start(
    Object.assign({ ingestKey: 'gt_pub_test', captureErrors: false, apiUrl: 'https://api.test' }, props),
    { SDK, runtime, page: false, trigger: (n) => triggers.push(n), warn: (m) => warnings.push(m), extra: Object.assign({ fetch: srv.fetch, autoFlushMs: 0 }, extra) },
  );
  return { rs, triggers, warnings };
}

test('platform names from the runtime platform info', () => {
  assert.equal(Glue.platformName({ exportType: 'html5', os: 'Android' }), 'web');
  assert.equal(Glue.platformName({ exportType: 'preview' }), 'web');
  assert.equal(Glue.platformName({ exportType: 'cordova', os: 'Android 14' }), 'android');
  assert.equal(Glue.platformName({ exportType: 'cordova', os: 'iOS' }), 'ios');
  assert.equal(Glue.platformName({ exportType: 'nwjs', os: 'macOS' }), 'macos');
  assert.equal(Glue.platformName({ exportType: 'windows-webview2' }), 'windows');
  assert.equal(Glue.platformName({ exportType: 'macos-wkwebview' }), 'macos');
  assert.equal(Glue.platformName({ exportType: 'linux-cef' }), 'linux');
  assert.equal(Glue.platformName({ exportType: 'xbox-uwp' }), 'xbox');
  assert.equal(Glue.platformName(undefined), 'web');
});

test('mirrorStorage: loads only ravensight keys, writes through in order, the latest value wins', async () => {
  const target = asyncStorage({ ravensight_device_id: 'abc', other_game_key: 'x' });
  const writes = [];
  const slow = Object.assign({}, target, {
    setItem: async (k, v) => {
      writes.push([k, v]);
      await new Promise((r) => setTimeout(r, 5));
      target.map.set(k, v);
    },
  });
  const mirror = Glue.mirrorStorage(slow);
  await mirror.load();
  assert.equal(mirror.getItem('ravensight_device_id'), 'abc');
  assert.equal(mirror.getItem('other_game_key'), null, 'other keys are never read');
  mirror.setItem('ravensight_queue_x', '1');
  mirror.setItem('ravensight_queue_x', '2');
  mirror.setItem('ravensight_queue_x', '3');
  assert.equal(mirror.getItem('ravensight_queue_x'), '3', 'reads see the write at once');
  await mirror.flushed();
  assert.deepEqual(writes, [['ravensight_queue_x', '3']], 'one write, the latest value');
  mirror.removeItem('ravensight_queue_x');
  await mirror.flushed();
  assert.equal(target.map.has('ravensight_queue_x'), false);
});

test('mirrorStorage: an unreadable storage starts empty, a failed write keeps memory', async () => {
  const broken = {
    keys: async () => {
      throw new Error('no');
    },
    getItem: async () => null,
    setItem: async () => {
      throw new Error('full');
    },
    removeItem: async () => undefined,
  };
  const mirror = Glue.mirrorStorage(broken);
  await mirror.load();
  mirror.setItem('ravensight_a', 'b');
  await mirror.flushed();
  assert.equal(mirror.getItem('ravensight_a'), 'b');
});

test('worker mode: storage loaded first, game_started, actions buffered until the client exists, session_ready', async () => {
  const srv = server();
  const storage = asyncStorage();
  const runtime = fakeRuntime(storage);
  const { rs, triggers } = start(srv, runtime);
  rs.level('level_start', 'forest_1');
  rs.trackWithProperty('coins', 'amount', 5);
  assert.equal(rs.client, null, 'not yet: the storage is still loading');
  assert.equal(rs.queueLength(), 2, 'buffered');
  await rs.ready;
  await settle();
  assert.ok(triggers.includes('session_ready'));
  assert.ok(!triggers.includes('session_failed'));
  const session = JSON.parse(srv.seen.find((r) => r.url.endsWith('/session')).init.body);
  assert.equal(session.platform, 'web');
  assert.equal(session.gameVersion, '2.1.0', 'the project version when none is set');
  rs.flush();
  await settle();
  assert.deepEqual(srv.events().map((e) => e.event), ['game_started', 'level_start', 'coins']);
  assert.equal(srv.events()[1].data.rs_kind, 'level_start');
  assert.equal(srv.events()[2].data.amount, 5);
  assert.ok(rs.deviceId(), 'a device id');
  assert.ok([...storage.map.keys()].includes('ravensight_device_id'), 'kept in runtime.storage');
  await rs.dispose();
});

test('suspend flushes; dispose removes the listener', async () => {
  const srv = server();
  const runtime = fakeRuntime(asyncStorage());
  const { rs } = start(srv, runtime);
  await rs.ready;
  await settle();
  rs.track('pickup', '{"item":"key"}');
  runtime.emit('suspend');
  await settle();
  assert.ok(srv.events().some((e) => e.event === 'pickup'));
  await rs.dispose();
  assert.equal(runtime.handlers.get('suspend').length, 0);
});

test('track with JSON: an object is sent; anything else warns and sends nothing', async () => {
  const srv = server();
  const { rs, warnings } = start(srv, fakeRuntime(asyncStorage()));
  await rs.ready;
  assert.equal(rs.track('a', '{"x":1}'), true);
  assert.equal(rs.track('b', ''), true, 'empty is no properties');
  assert.equal(rs.track('c', '[1,2]'), false);
  assert.equal(rs.track('d', 'not json'), false);
  assert.equal(warnings.length, 2);
  rs.flush();
  await settle();
  assert.deepEqual(srv.events().map((e) => e.event).filter((n) => n !== 'game_started'), ['a', 'b']);
  await rs.dispose();
});

test('typed actions: purchase, error, ads with micros from a double, attribution, feedback', async () => {
  const srv = server();
  const { rs, warnings } = start(srv, fakeRuntime(asyncStorage()));
  await rs.ready;
  await settle();
  rs.purchase(499, 'usd', 'gems', 'small');
  rs.trackError(2, 'shop failed');
  rs.trackAd('admob', 2, 1, 'level_end');
  assert.equal(rs.trackAdRevenue('admob', 'rewarded', 'level_end', 0.0015, 'USD'), true);
  assert.equal(rs.trackAdRevenue('admob', 'rewarded', '', -1, 'USD'), false);
  rs.setAttribution('organic', '', 'spring', '', '');
  rs.submitFeedback('fun', 3, 5);
  rs.flush();
  await settle();
  assert.ok(srv.seen.some((r) => r.url.includes('/track/batch') && r.init.headers['Content-Encoding'] === 'gzip'), 'a big batch goes gzip compressed');
  const byName = Object.fromEntries(srv.events().map((e) => [e.event + (e.data.rs_ad_result || ''), e.data]));
  assert.equal(String(byName.purchase.rs_amount), '499');
  assert.equal(byName.purchase.rs_currency, 'USD');
  assert.equal(byName.error.rs_severity, 'warning', 'combo index 2');
  assert.equal(byName.rs_adclicked.rs_ad_format, 'rewarded');
  assert.equal(byName.rs_adshown.rs_revenue_micros, '1500');
  assert.equal(byName.rs_attribution.rs_campaign, 'spring');
  assert.equal('rs_attr_network' in byName.rs_attribution, false, 'empty fields are omitted');
  assert.equal(warnings.length, 1);
  const feedback = srv.seen.find((r) => r.url.includes('/feedback'));
  assert.ok(feedback, 'feedback sent');
  assert.equal(JSON.parse(bodyText(feedback.init)).category, 'praise');
  await rs.dispose();
});

test('remote config: a read tags later events with the experiment', async () => {
  const srv = server();
  const { rs, triggers } = start(srv, fakeRuntime(asyncStorage()));
  await rs.ready;
  await settle();
  rs.fetchConfig();
  await settle();
  assert.ok(triggers.includes('config_ready'));
  assert.equal(rs.configNumber('jump', 1), 7);
  assert.equal(rs.configString('title', 'x'), 'Hi');
  assert.equal(rs.configString('jump', 'x'), 'x', 'a number is not a text');
  rs.track('jumped', '');
  rs.flush();
  await settle();
  const jumped = srv.events().find((e) => e.event === 'jumped');
  assert.equal(jumped.data.rs_exp_jump_test, 'high');
  assert.ok(srv.events().some((e) => e.event === 'rs_exposure'));
  await rs.dispose();
});

test('offline in a worker: the queue reaches runtime.storage and the next launch sends it under its origin', async () => {
  const state = {};
  const srv = server(state);
  const storage = asyncStorage();
  const first = start(srv, fakeRuntime(storage));
  await first.rs.ready;
  await settle();
  first.rs.flush();
  await settle();
  state.offline = true;
  first.rs.track('pickup', '{"item":"key"}');
  first.rs.flush();
  await settle();
  await first.rs.dispose();
  const key = [...storage.map.keys()].find((k) => k.startsWith('ravensight_queue_'));
  assert.ok(key, 'saved through the mirror');
  const doc = JSON.parse(storage.map.get(key));
  assert.equal(doc.version, 2);
  assert.equal(doc.groups[0].origin.stamp, ORIGIN.stamp);

  const srv2 = server({ origin: Object.assign({}, ORIGIN, { session: 'ses_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }) });
  const second = start(srv2, fakeRuntime(storage));
  await second.rs.ready;
  await settle();
  second.rs.flush();
  await settle();
  const pickup = srv2.events().find((e) => e.event === 'pickup');
  assert.ok(pickup, 'sent on the next launch');
  assert.equal(pickup.origin.stamp, ORIGIN.stamp);
  await second.rs.dispose();
});

test('opt-out: saved to runtime.storage and honoured on the next launch before any request', async () => {
  const srv = server();
  const storage = asyncStorage();
  const first = start(srv, fakeRuntime(storage), { consent: 'opt_in' });
  await first.rs.ready;
  await settle();
  assert.equal(srv.seen.length, 0, 'opt_in: nothing before the yes');
  assert.equal(first.rs.isTrackingEnabled(), false);
  first.rs.setTrackingEnabled(true);
  await settle();
  assert.ok(srv.seen.length > 0);
  first.rs.setTrackingEnabled(false);
  await first.rs.dispose();
  const srv2 = server();
  const second = start(srv2, fakeRuntime(storage), { consent: 'opt_in' });
  await second.rs.ready;
  await settle();
  assert.equal(srv2.seen.length, 0);
  await second.rs.dispose();
});

test('no key: inert, no storage read, StatusReason no_key', async () => {
  const srv = server();
  const storage = asyncStorage({ ravensight_device_id: 'x' });
  let reads = 0;
  storage.keys = async () => {
    reads += 1;
    return [];
  };
  const { rs, triggers } = start(srv, fakeRuntime(storage), { ingestKey: '' });
  rs.track('x', '');
  await rs.ready;
  await settle();
  assert.equal(srv.seen.length, 0);
  assert.equal(reads, 0);
  assert.equal(rs.statusReason(), 'no_key');
  assert.deepEqual(triggers, ['session_failed']);
  await rs.dispose();
});
