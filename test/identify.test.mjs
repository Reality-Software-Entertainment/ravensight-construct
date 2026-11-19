// Identify player, Reset identity, Set campaign link, Is identified and
// IdentifyRefusal through the Construct glue.
//
// The bundled JavaScript SDK does the hashing, keeps the identity and reads
// the answers; the glue validates on the event sheet's side (so a refusal is
// known at once), buffers calls made before the client exists, keeps the
// identity in runtime.storage through its mirror in worker mode, and does
// nothing but warn once when the bundled SDK is older than 0.12.0.
//
// Tests with a stand-in client always run. Tests against the real SDK need
// identify or setCampaignLink (0.12.0 or newer) and skip with the reason when
// the installed SDK lacks them (npm has 0.11.0 today); reading rs_link from
// the page address needs 0.8.0 or newer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as SDK from 'ravensight';
import '../src/glue.js';

const require = createRequire(import.meta.url);
const Glue = globalThis.RavensightConstructGlue;
const SDK_VERSION = require('ravensight/package.json').version;
const VECTORS = JSON.parse(readFileSync(new URL('./fixtures/identify-vectors.json', import.meta.url), 'utf8'));
const SALT = VECTORS.salt;
const SEQ = VECTORS.sequence;
const KEY = 'gt_live_test';
const IDENTITY_KEY = 'ravensight_identity';
const LINK = '64b0000000000000000000a1';

function atLeast(version, floor) {
  const a = version.split('.').map((n) => parseInt(n, 10) || 0);
  const b = floor.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
const proto = SDK.Ravensight.prototype;
const NEEDS_IDENTIFY = typeof proto.identify === 'function' ? false : `the installed ravensight ${SDK_VERSION} has no identify(); it needs 0.12.0 or newer`;
const NEEDS_SET_LINK = typeof proto.setCampaignLink === 'function' ? false : `the installed ravensight ${SDK_VERSION} has no setCampaignLink(); it needs 0.12.0 or newer`;
const NEEDS_RS_LINK = atLeast(SDK_VERSION, '0.8.0') ? false : `the installed ravensight ${SDK_VERSION} does not read rs_link; it needs 0.8.0 or newer`;

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate, ms = 2000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

// --- a stand-in SDK, for what the glue does on its own ---------------------------

/** A JavaScript SDK module whose client records calls. `features` picks which 0.12.0 calls it has. */
function standInSDK(features = { identify: true, setCampaignLink: true }, version = '0.12.0') {
  const clients = [];
  class Ravensight {
    constructor(options) {
      this.options = options;
      this.calls = [];
      this.deviceId = 'dev-1';
      this.queue = [];
      this.identified = false;
      clients.push(this);
    }
    isEnabled() {
      return true;
    }
    isSessionValid() {
      return true;
    }
    track(...args) {
      this.calls.push(['track', ...args]);
    }
    init() {
      return Promise.resolve({ sessionReady: true });
    }
    flush() {
      return Promise.resolve();
    }
    dispose() {
      return Promise.resolve();
    }
  }
  if (features.identify) {
    Ravensight.prototype.identify = function (id) {
      this.calls.push(['identify', id]);
      if (this.refuseWith) return Promise.reject(Object.assign(new TypeError('refused'), { code: this.refuseWith }));
      this.identified = true;
      return Promise.resolve();
    };
    Ravensight.prototype.resetIdentity = function () {
      this.calls.push(['resetIdentity']);
      this.identified = false;
      return Promise.resolve();
    };
    Object.defineProperty(Ravensight.prototype, 'isIdentified', {
      get() {
        return this.identified;
      },
    });
  }
  if (features.setCampaignLink) {
    Ravensight.prototype.setCampaignLink = function (id) {
      this.calls.push(['setCampaignLink', id]);
      return true;
    };
  }
  return { module: { Ravensight, VERSION: version, microsFromRevenue: () => '1' }, clients };
}

function startStandIn(sdk, runtime = {}, props = {}) {
  const warnings = [];
  const rs = Glue.start(Object.assign({ ingestKey: 'gt_pub_test', captureErrors: false }, props), {
    SDK: sdk.module,
    runtime,
    page: false,
    warn: (m) => warnings.push(String(m)),
  });
  return { rs, warnings };
}

test('a bundled SDK older than 0.12.0: the actions do nothing, one warning each naming 0.12.0, Is identified is false', async () => {
  const sdk = standInSDK({ identify: false, setCampaignLink: false }, '0.11.0');
  const { rs, warnings } = startStandIn(sdk);
  await rs.ready;
  assert.equal(rs.identify('a1b2c3'), false);
  assert.equal(rs.identify('d4e5f6'), false);
  assert.equal(rs.resetIdentity(), false);
  assert.equal(rs.setCampaignLink(LINK), false);
  assert.equal(rs.setCampaignLink(LINK), false);
  await settle(10);
  assert.equal(rs.isIdentified(), false);
  assert.equal(rs.identifyRefusal(), 'unsupported');
  assert.equal(warnings.length, 2, warnings.join('\n'));
  assert.ok(warnings.every((w) => w.includes('0.12.0') && w.includes('0.11.0')), warnings.join('\n'));
  assert.deepEqual(sdk.clients[0].calls.filter((c) => c[0] !== 'track'), []);
  await rs.dispose();
});

test('the refuse vectors are refused on the glue side: IdentifyRefusal names the reason, nothing reaches the client, the value is never printed', async () => {
  const sdk = standInSDK();
  const { rs, warnings } = startStandIn(sdk);
  await rs.ready;
  for (const vector of VECTORS.refuse) {
    assert.equal(rs.identify(vector.accountId), false, vector.note);
    assert.equal(rs.identifyRefusal(), vector.reason, vector.note);
  }
  for (const value of [undefined, {}, [], true, NaN, Infinity, 1e21, 12.5]) {
    assert.equal(rs.identify(value), false, String(value));
    assert.equal(rs.identifyRefusal(), 'not_text', String(value));
  }
  await settle(10);
  assert.deepEqual(sdk.clients[0].calls.filter((c) => c[0] === 'identify'), []);
  assert.equal(rs.isIdentified(), false);
  assert.equal(warnings.length, VECTORS.refuse.length + 8, 'one warning per refusal');
  for (const vector of VECTORS.refuse) {
    if (typeof vector.accountId === 'string' && vector.accountId.trim()) {
      assert.equal(warnings.some((w) => w.includes(vector.accountId.trim())), false, 'never printed: ' + vector.note);
    }
  }
  await rs.dispose();
});

test('the accept vectors pass to the client exactly as given (a whole number as its digits), and IdentifyRefusal clears', async () => {
  const sdk = standInSDK();
  const { rs, warnings } = startStandIn(sdk);
  await rs.ready;
  rs.identify('');
  assert.equal(rs.identifyRefusal(), 'empty');
  for (const vector of VECTORS.accept) {
    assert.equal(rs.identify(vector.accountId), true, vector.note);
    assert.equal(rs.identifyRefusal(), '', vector.note);
  }
  await settle(10);
  const passed = sdk.clients[0].calls.filter((c) => c[0] === 'identify').map((c) => c[1]);
  assert.deepEqual(passed, VECTORS.accept.map((v) => (v.integer ? v.same_as : v.accountId)));
  assert.equal(rs.isIdentified(), true);
  assert.equal(warnings.length, 1, 'only the empty one warned');
  await rs.dispose();
});

test('calls before the client exists are buffered in order, and Is identified answers from them meanwhile', async () => {
  const sdk = standInSDK();
  let release;
  const gate = new Promise((r) => (release = r));
  const storage = {
    keys: async () => {
      await gate;
      return [];
    },
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  };
  const { rs } = startStandIn(sdk, { storage });
  assert.equal(rs.isIdentified(), false);
  rs.identify('a1b2c3');
  assert.equal(rs.isIdentified(), true, 'an accepted identify is waiting');
  rs.resetIdentity();
  assert.equal(rs.isIdentified(), false, 'then a reset is waiting');
  rs.identify('d4e5f6');
  rs.setCampaignLink(LINK);
  assert.equal(rs.isIdentified(), true);
  assert.equal(sdk.clients.length, 0, 'no client yet: the storage is still loading');
  release();
  await rs.ready;
  assert.deepEqual(sdk.clients[0].calls.filter((c) => c[0] !== 'track'), [['identify', 'a1b2c3'], ['resetIdentity'], ['identify', 'd4e5f6'], ['setCampaignLink', LINK]]);
  assert.equal(rs.isIdentified(), true, 'now the client says');
  await rs.dispose();
});

test('Set campaign link: a link id passes through, an empty value is ignored quietly, anything else warns and is ignored', async () => {
  const sdk = standInSDK();
  const { rs, warnings } = startStandIn(sdk);
  await rs.ready;
  assert.equal(rs.setCampaignLink(''), false, 'no rs_link on the address');
  assert.equal(warnings.length, 0, 'quietly');
  for (const bad of ['abc', ' ' + LINK, 'g'.repeat(24), LINK + '0', null, 12345]) assert.equal(rs.setCampaignLink(bad), false, String(bad));
  assert.equal(warnings.length, 6);
  assert.equal(rs.setCampaignLink(LINK.toUpperCase()), true);
  await settle(10);
  assert.deepEqual(sdk.clients[0].calls.filter((c) => c[0] === 'setCampaignLink'), [['setCampaignLink', LINK.toUpperCase()]]);
  await rs.dispose();
});

test('a refusal the SDK makes itself still lands in IdentifyRefusal', async () => {
  const sdk = standInSDK();
  const { rs } = startStandIn(sdk);
  await rs.ready;
  sdk.clients[0].refuseWith = 'disposed';
  assert.equal(rs.identify('a1b2c3'), true);
  await settle(10);
  assert.equal(rs.identifyRefusal(), 'disposed');
  await rs.dispose();
});

// --- the real SDK, through the glue, in worker mode --------------------------------

function fakeServer(salt = SALT) {
  // hold: a promise every session answer waits for, to keep "before any session" true.
  const state = { salt, sessions: [], identifies: [], identifyAnswers: [], offline: false, hold: null };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    if (state.offline) throw new TypeError('fetch failed');
    const headers = init.headers || {};
    if (url.endsWith('/settings')) return reply(200, { trackingEnabled: true });
    if (url.endsWith('/api/v1/session')) {
      if (state.hold) await state.hold;
      const token = 'S' + (state.sessions.length + 1);
      state.sessions.push({ token, body: JSON.parse(String(init.body)) });
      const answer = {
        token,
        expiresIn: 3600,
        origin: { session: 'ses_' + String(state.sessions.length).padStart(32, 'a'), build: '1.0.0', platform: 'web', stamp: 'o1.a.b' },
      };
      if (state.salt) answer.identify = { salt: state.salt };
      return reply(201, answer);
    }
    if (url.endsWith('/api/v1/identify')) {
      const text = String(init.body);
      state.identifies.push({ token: headers['X-Session-Token'], key: headers['X-API-Key'], text });
      const forced = state.identifyAnswers.shift();
      if (forced) return reply(forced.status, forced.body);
      const hash = JSON.parse(text).accountHash;
      return reply(200, { playerId: 'px_' + hash.slice(0, 32), linked: true, verified: false, repeat: false });
    }
    if (url.includes('/track/batch')) return reply(202, { accepted: 1 });
    return reply(404, { error: 'not_found' });
  };
  const sends = (from = 0) => state.identifies.slice(from).map((r) => ({ session: r.token, accountHash: JSON.parse(r.text).accountHash }));
  return { state, fetch, sends };
}

/** runtime.storage as Construct gives it: every call a promise. */
function asyncStorage() {
  const map = new Map();
  return {
    map,
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
    keys: async () => [...map.keys()],
  };
}

/** One launch of a project in worker mode (Construct's default): no page, runtime.storage. */
function launch(srv, storage, props = {}) {
  const warnings = [];
  const rs = Glue.start(Object.assign({ ingestKey: KEY, captureErrors: false, apiUrl: 'https://api.test' }, props), {
    SDK,
    runtime: { storage, platformInfo: { exportType: 'html5', os: 'Windows' }, projectVersion: '1.0.0', addEventListener() {}, removeEventListener() {} },
    page: false,
    warn: (m) => warnings.push(String(m)),
    extra: { fetch: srv.fetch, autoFlushMs: 0 },
  });
  return { rs, warnings };
}

const stored = (storage) => (storage.map.has(IDENTITY_KEY) ? JSON.parse(storage.map.get(IDENTITY_KEY)) : null);

test('worker mode: every accept vector goes as exactly { accountHash } with the key and session token, and reaches runtime.storage', { skip: NEEDS_IDENTIFY }, async () => {
  for (const vector of VECTORS.accept) {
    const srv = fakeServer();
    const storage = asyncStorage();
    const { rs } = launch(srv, storage);
    await rs.ready;
    await waitFor(() => srv.state.sessions.length === 1);
    assert.equal(rs.identify(vector.accountId), true, vector.note);
    await waitFor(() => srv.state.identifies.length === 1);
    await settle(20);
    const sent = srv.state.identifies[0];
    assert.equal(sent.text, JSON.stringify({ accountHash: vector.wire }), vector.note);
    assert.equal(sent.key, KEY);
    assert.equal(sent.token, 'S1');
    assert.deepEqual(stored(storage), { salt: SALT, accountHash: vector.wire }, vector.note);
    assert.equal(rs.isIdentified(), true);
    await rs.dispose();
  }
});

test('salts_differ: one account under two salts gives the two wires', { skip: NEEDS_IDENTIFY }, async () => {
  const d = VECTORS.salts_differ;
  for (const [salt, wire] of [[d.salt_a, d.wire_a], [d.salt_b, d.wire_b]]) {
    const srv = fakeServer(salt);
    const { rs } = launch(srv, asyncStorage());
    rs.identify(d.accountId);
    await waitFor(() => srv.state.identifies.length === 1);
    assert.equal(srv.sends()[0].accountHash, wire);
    await rs.dispose();
  }
});

test('worker mode: the refuse vectors send nothing, store nothing and keep the device id', { skip: NEEDS_IDENTIFY }, async () => {
  const srv = fakeServer();
  const storage = asyncStorage();
  const { rs } = launch(srv, storage);
  await rs.ready;
  await waitFor(() => srv.state.sessions.length === 1);
  const device = rs.deviceId();
  for (const vector of VECTORS.refuse) assert.equal(rs.identify(vector.accountId), false, vector.note);
  await settle();
  assert.equal(srv.state.identifies.length, 0);
  assert.equal(storage.map.has(IDENTITY_KEY), false);
  assert.equal(rs.deviceId(), device);
  assert.equal(rs.isIdentified(), false);
  await rs.dispose();
});

test('the contract sequence holds through the glue: relaunches read and write runtime.storage', { skip: NEEDS_IDENTIFY }, async () => {
  const srv = fakeServer();
  const storage = asyncStorage();
  let run = launch(srv, storage);
  let from = 0;
  let device = null;
  const begin = () => {
    from = srv.state.identifies.length;
    device = run.rs.deviceId();
  };
  const check = (i) => {
    const { step, expect } = SEQ[i];
    assert.deepEqual(srv.sends(from), expect.sends, step);
    if ('stored' in expect) assert.deepEqual(stored(storage), expect.stored, step);
    if (expect.device_changed !== undefined) assert.equal(run.rs.deviceId() !== device, expect.device_changed, step);
  };

  // 0: Identify player before any session opens (here even before the client
  // exists: the runtime's storage is still loading). Held in memory only.
  let release;
  srv.state.hold = new Promise((r) => (release = r));
  begin();
  run.rs.identify('u1');
  assert.equal(run.rs.isIdentified(), SEQ[0].expect.held_in_memory);
  await run.rs.ready;
  check(0);
  assert.equal(srv.state.sessions.length, 0, 'no session yet');
  assert.equal(run.rs.isIdentified(), true, 'held by the client');
  srv.state.hold = null;
  release();

  // 1: S1 answers with the salt: hashed, kept in runtime.storage, sent.
  await waitFor(() => srv.state.identifies.length === 1);
  await settle(20);
  check(1);
  for (const value of storage.map.values()) assert.equal(value.includes('"u1"'), false, 'the raw id is never stored');

  // 2: the same account again in S1.
  begin();
  run.rs.identify('u1');
  await settle();
  check(2);
  await run.rs.dispose();

  // 3: relaunch over the same runtime.storage: S2 sends the stored hash.
  run = launch(srv, storage);
  await run.rs.ready;
  begin();
  assert.equal(run.rs.isIdentified(), true, 'read back through the mirror');
  await waitFor(() => srv.state.identifies.length === from + 1);
  await settle(20);
  check(3);

  // 4: an email is refused.
  begin();
  assert.equal(run.rs.identify('player@example.com'), false);
  assert.equal(run.rs.identifyRefusal(), SEQ[4].expect.refused);
  await settle();
  check(4);

  // 5: another account: a fresh device id, session S3.
  begin();
  run.rs.identify('u2');
  await waitFor(() => srv.state.identifies.length === from + 1);
  await settle(20);
  check(5);
  assert.equal(run.rs.client.sessionToken, SEQ[5].expect.new_session);
  assert.equal(srv.state.sessions[2].body.deviceId, run.rs.deviceId());

  // 6: Reset identity: a fresh device id, kept in runtime.storage; its session is S4.
  begin();
  run.rs.resetIdentity();
  await settle(20);
  run.rs.track('tick', '');
  run.rs.flush();
  await waitFor(() => srv.state.sessions.length === 4);
  await settle();
  check(6);
  assert.equal(run.rs.client.sessionToken, SEQ[6].expect.new_session);
  assert.equal(run.rs.isIdentified(), false);
  assert.equal(storage.map.get('ravensight_device_id'), run.rs.deviceId());

  // 7: Reset identity again with nothing stored: nothing changes.
  begin();
  run.rs.resetIdentity();
  await settle();
  check(7);

  // 8: Identify player "u3" answered 429 needs_funds: kept, never retried in a loop.
  begin();
  srv.state.identifyAnswers.push({ status: 429, body: { error: 'quota_exceeded', reason: 'needs_funds' } });
  run.rs.identify('u3');
  await waitFor(() => srv.state.identifies.length === from + 1);
  await settle(20);
  check(8);
  run.rs.identify('u3');
  run.rs.track('tick', '');
  run.rs.flush();
  await settle();
  assert.equal(srv.state.identifies.length, from + 1, 'never in a loop');
  await run.rs.dispose();

  // 9: relaunch; S5 answers another game's salt: the stored identity is deleted, never sent.
  srv.state.salt = VECTORS.salts_differ.salt_b;
  run = launch(srv, storage);
  await run.rs.ready;
  begin();
  await waitFor(() => srv.state.sessions.length === 5);
  await settle();
  check(9);
  assert.equal(run.rs.isIdentified(), false);
  await run.rs.dispose();

  // 10: relaunch; Identify player "u4" and the session answer has no identify.salt.
  srv.state.salt = null;
  run = launch(srv, storage);
  run.rs.identify('u4');
  await run.rs.ready;
  begin();
  await waitFor(() => srv.state.sessions.length === 6);
  await settle();
  check(10);
  assert.equal(run.rs.isIdentified(), false, 'the held id is dropped');
  run.rs.identify('u4');
  await settle();
  check(10);

  // 11: the player opts out.
  begin();
  run.rs.setTrackingEnabled(false);
  await settle();
  check(11);
  await run.rs.dispose();
});

test('Set tracking enabled to false deletes the stored identity from runtime.storage', { skip: NEEDS_IDENTIFY }, async () => {
  const srv = fakeServer();
  const storage = asyncStorage();
  const { rs } = launch(srv, storage);
  rs.identify('u1');
  await waitFor(() => srv.state.identifies.length === 1);
  await settle(20);
  assert.ok(stored(storage));
  rs.setTrackingEnabled(false);
  await settle(20);
  assert.equal(storage.map.has(IDENTITY_KEY), false);
  await rs.dispose();
});

test('worker mode: Set campaign link goes, lowercased, with the next session, once, and never reaches runtime.storage', { skip: NEEDS_SET_LINK }, async () => {
  const srv = fakeServer();
  const storage = asyncStorage();
  const { rs } = launch(srv, storage);
  // The usual case: on start of the first layout, before the first session.
  assert.equal(rs.setCampaignLink(LINK.toUpperCase()), true);
  await rs.ready;
  await waitFor(() => srv.state.sessions.length === 1);
  assert.equal(srv.state.sessions[0].body.campaignLink, LINK);

  const later = 'abcdef0123456789abcdef01';
  assert.equal(rs.setCampaignLink(later), true);
  rs.resetDeviceId();
  await settle(20);
  rs.track('tick', '');
  rs.flush();
  await waitFor(() => srv.state.sessions.length === 2);
  assert.equal(srv.state.sessions[1].body.campaignLink, later, 'a link learned later goes with the next session');
  rs.resetDeviceId();
  await settle(20);
  rs.track('tick', '');
  rs.flush();
  await waitFor(() => srv.state.sessions.length === 3);
  assert.equal(srv.state.sessions[2].body.campaignLink, undefined, 'once');
  await settle(20);
  for (const value of storage.map.values()) assert.equal(value.toLowerCase().includes(LINK) || value.includes(later), false, 'never stored');
  await rs.dispose();
});

test('worker mode with opt-in consent: the link waits for the yes', { skip: NEEDS_SET_LINK }, async () => {
  const srv = fakeServer();
  const { rs } = launch(srv, asyncStorage(), { consent: 'opt_in' });
  rs.setCampaignLink(LINK);
  await rs.ready;
  await settle();
  assert.equal(srv.state.sessions.length, 0, 'nothing before the yes');
  rs.setTrackingEnabled(true);
  await waitFor(() => srv.state.sessions.length === 1);
  assert.equal(srv.state.sessions[0].body.campaignLink, LINK);
  await rs.dispose();
});

// --- where rs_link comes from on the web ----------------------------------------------

function withGlobals(t, values) {
  const saved = {};
  for (const [k, v] of Object.entries(values)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  t.after(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  });
}
const quiet = { addEventListener() {}, removeEventListener() {} };

test('page mode (worker off): the bundled SDK reads rs_link from the page address and sends it on the first session', { skip: NEEDS_RS_LINK }, async (t) => {
  withGlobals(t, {
    window: Object.assign({ location: { search: '?lang=en&rs_link=' + LINK.toUpperCase() } }, quiet),
    document: Object.assign({ visibilityState: 'visible', createElement: () => ({ getContext: () => null }) }, quiet),
  });
  const srv = fakeServer();
  const rs = Glue.start(
    { ingestKey: KEY, captureErrors: false, apiUrl: 'https://api.test' },
    { SDK, runtime: { platformInfo: { exportType: 'html5' } }, page: true, warn() {}, extra: { fetch: srv.fetch, autoFlushMs: 0 } },
  );
  await rs.ready;
  await waitFor(() => srv.state.sessions.length === 1);
  assert.equal(srv.state.sessions[0].body.campaignLink, LINK);
  await rs.dispose();
});

test('worker mode: there is no page, so rs_link is not read on its own; Set campaign link is how it gets there', async (t) => {
  // A worker has a location of its own (the worker script's), never the page's.
  withGlobals(t, { location: { search: '?rs_link=' + LINK } });
  const srv = fakeServer();
  const { rs } = launch(srv, asyncStorage());
  await rs.ready;
  await waitFor(() => srv.state.sessions.length === 1);
  assert.equal(srv.state.sessions[0].body.campaignLink, undefined);
  await rs.dispose();
});
