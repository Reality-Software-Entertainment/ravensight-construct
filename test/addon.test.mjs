// The addon package: every file listed exists, every ACE has its strings
// and its runtime function, and the runtime scripts register the plugin and
// call the glue when loaded the way Construct loads them (with fake base
// classes, since there is no Construct here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const addonDir = join(root, 'addon');
const read = (p) => readFileSync(join(addonDir, p), 'utf8');
const addon = JSON.parse(read('addon.json'));
const aces = JSON.parse(read('aces.json'));
const lang = JSON.parse(read('lang/en-US.json')).text.plugins[addon.id.toLowerCase()];

test('addon.json: SDK v2, a plugin, and every listed file exists', () => {
  assert.equal(addon['is-c3-addon'], true);
  assert.equal(addon['sdk-version'], 2);
  assert.equal(addon.type, 'plugin');
  assert.match(addon.version, /^\d+\.\d+\.\d+\.\d+$/);
  for (const file of addon['file-list']) assert.ok(existsSync(join(addonDir, file)), file + ' is listed but missing (run the build)');
  for (const file of addon['editor-scripts']) assert.ok(addon['file-list'].includes(file), file);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(addon.version.split('.').slice(0, 3).join('.'), pkg.version, 'the addon and package versions agree');
});

test('every ACE has strings, and every parameter has a name', () => {
  for (const [, group] of Object.entries(aces)) {
    for (const c of group.conditions) assert.ok(lang.conditions[c.id], 'condition strings: ' + c.id);
    for (const a of group.actions) {
      const strings = lang.actions[a.id];
      assert.ok(strings, 'action strings: ' + a.id);
      for (const p of a.params || []) {
        assert.ok(strings.params && strings.params[p.id], a.id + ' param ' + p.id);
        if (p.type === 'combo') for (const item of p.items) assert.ok(strings.params[p.id].items[item], a.id + ' combo item ' + item);
      }
      const placeholders = [...strings['display-text'].matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
      for (const n of placeholders) assert.ok(n < (a.params || []).length, a.id + ' display text {' + n + '}');
    }
    for (const e of group.expressions) {
      assert.equal(e.id, e.expressionName.toLowerCase(), 'expression ids are the lower-case name');
      assert.ok(lang.expressions[e.id], 'expression strings: ' + e.id);
    }
  }
  for (const id of ['ingest-key', 'game-version', 'consent', 'capture-errors', 'distribution', 'api-url', 'debug']) assert.ok(lang.properties[id], 'property ' + id);
});

test('no em or en dashes in the strings a user sees', () => {
  const text = read('lang/en-US.json') + readFileSync(join(root, 'README.md'), 'utf8');
  assert.equal(/[–—]/.test(text), false);
});

test('lang and aces.json name the same ACEs both ways, and every ACE has its words', () => {
  const ids = (kind) => Object.values(aces).flatMap((group) => group[kind].map((a) => a.id)).sort();
  assert.deepEqual(Object.keys(lang.conditions).sort(), ids('conditions'), 'conditions');
  assert.deepEqual(Object.keys(lang.actions).sort(), ids('actions'), 'actions');
  assert.deepEqual(Object.keys(lang.expressions).sort(), ids('expressions'), 'expressions');
  for (const kind of ['conditions', 'actions']) {
    for (const [id, words] of Object.entries(lang[kind])) {
      for (const field of ['list-name', 'display-text', 'description']) assert.ok(words[field], kind + ' ' + id + ' ' + field);
      for (const [p, w] of Object.entries(words.params || {})) assert.ok(w.name && w.desc, id + ' param ' + p);
    }
  }
  for (const [id, words] of Object.entries(lang.expressions)) assert.ok(words.description && words['translated-name'], 'expression ' + id);
});

/** The identify and campaign link ACEs of 0.2.0, as the event sheet sees them. */
const IDENTITY_ACES = {
  actions: [
    { id: 'identify', scriptName: 'Identify', params: [{ id: 'account-id', type: 'string' }], glue: 'identify' },
    { id: 'reset-identity', scriptName: 'ResetIdentity', params: [], glue: 'resetIdentity' },
    { id: 'set-campaign-link', scriptName: 'SetCampaignLink', params: [{ id: 'link-id', type: 'string' }], glue: 'setCampaignLink' },
  ],
  conditions: [{ id: 'is-identified', scriptName: 'IsIdentified', glue: 'isIdentified' }],
  expressions: [{ id: 'identifyrefusal', expressionName: 'IdentifyRefusal', returnType: 'string', glue: 'identifyRefusal' }],
};

test('identify and campaign link ACEs: one id, script name and parameter list in aces.json, lang and the runtime', () => {
  const group = aces.ravensight;
  const ctx = loadRuntime();
  const plugin = ctx.C3.Plugins[addon.id];
  for (const want of IDENTITY_ACES.actions) {
    const ace = group.actions.find((a) => a.id === want.id);
    assert.ok(ace, 'aces.json action ' + want.id);
    assert.equal(ace.scriptName, want.scriptName);
    assert.deepEqual((ace.params || []).map((p) => ({ id: p.id, type: p.type })), want.params, want.id + ' params');
    const words = lang.actions[want.id];
    assert.ok(words, 'lang action ' + want.id);
    assert.deepEqual(Object.keys(words.params || {}), want.params.map((p) => p.id), want.id + ' lang params');
    assert.equal(typeof plugin.Acts[want.scriptName], 'function', 'Acts.' + want.scriptName);
    assert.equal(plugin.Acts[want.scriptName].length, want.params.length, want.scriptName + ' takes its parameters');
  }
  for (const want of IDENTITY_ACES.conditions) {
    const ace = group.conditions.find((c) => c.id === want.id);
    assert.ok(ace, 'aces.json condition ' + want.id);
    assert.equal(ace.scriptName, want.scriptName);
    assert.equal(ace.isTrigger, undefined, 'a plain condition, not a trigger');
    assert.ok(lang.conditions[want.id], 'lang condition ' + want.id);
    assert.equal(typeof plugin.Cnds[want.scriptName], 'function', 'Cnds.' + want.scriptName);
  }
  for (const want of IDENTITY_ACES.expressions) {
    const ace = group.expressions.find((e) => e.id === want.id);
    assert.ok(ace, 'aces.json expression ' + want.id);
    assert.equal(ace.expressionName, want.expressionName);
    assert.equal(ace.returnType, want.returnType);
    assert.equal(lang.expressions[want.id]['translated-name'], want.expressionName);
    assert.equal(typeof plugin.Exps[want.expressionName], 'function', 'Exps.' + want.expressionName);
  }
});

test('identify and campaign link ACEs call their glue methods with the event sheet\'s values', () => {
  const ctx = loadRuntime();
  const calls = [];
  ctx.RavensightConstructGlue = {
    start() {
      return new Proxy({}, { get: (_t, name) => (...args) => (calls.push([name, ...args]), name === 'identifyRefusal' ? 'empty' : name === 'dispose' ? Promise.resolve() : true) });
    },
  };
  ctx.__runtime = {};
  ctx.__props = ['', '', 0, true, '', '', false];
  const plugin = ctx.C3.Plugins[addon.id];
  const inst = new plugin.Instance();
  plugin.Acts.Identify.call(inst, 'a1b2c3');
  plugin.Acts.ResetIdentity.call(inst);
  plugin.Acts.SetCampaignLink.call(inst, '64b0000000000000000000a1');
  assert.equal(plugin.Cnds.IsIdentified.call(inst), true);
  assert.equal(plugin.Exps.IdentifyRefusal.call(inst), 'empty');
  assert.deepEqual(calls, [
    ['identify', 'a1b2c3'],
    ['resetIdentity'],
    ['setCampaignLink', '64b0000000000000000000a1'],
    ['isIdentified'],
    ['identifyRefusal'],
  ]);
  for (const want of [...IDENTITY_ACES.actions, ...IDENTITY_ACES.conditions, ...IDENTITY_ACES.expressions]) {
    assert.ok(calls.some((c) => c[0] === want.glue), want.glue);
  }
});

test('one version everywhere it lives: addon.json, package.json, the glue, the README and the CHANGELOG', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const ctx = loadRuntime();
  assert.equal(addon.version, pkg.version + '.0', 'addon.json');
  assert.equal(ctx.RavensightConstructGlue.VERSION, pkg.version, 'the glue');
  assert.equal((/^Version (\d+\.\d+\.\d+)\./m.exec(readme) || [])[1], pkg.version, 'the README Version line');
  assert.match((/^## (.+)$/m.exec(changelog) || [])[1] || '', new RegExp('^' + pkg.version.replace(/\./g, '\\.') + ' - \\d{4}-\\d{2}-\\d{2}$'), 'the newest CHANGELOG entry');
  assert.ok(readme.includes('ravensight-' + pkg.version + '.c3addon'), 'the README names the file the build makes');
});

test('runtime scripts with the bundled SDK: Identify player and Is identified on an inert object (no key, no request)', async () => {
  const warnings = [];
  const ctx = loadRuntime({ warn: (m) => warnings.push(String(m)) });
  ctx.__runtime = {};
  ctx.__props = ['', '', 0, false, '', '', false];
  const plugin = ctx.C3.Plugins[addon.id];
  const inst = new plugin.Instance();
  await new Promise((r) => setTimeout(r, 20));
  const bundled = ctx.RavensightSDK;
  const hasIdentify = typeof bundled.Ravensight.prototype.identify === 'function';
  plugin.Acts.Identify.call(inst, 'a1b2c3');
  plugin.Acts.Identify.call(inst, 'a1b2c3');
  plugin.Acts.SetCampaignLink.call(inst, '64b0000000000000000000a1');
  await new Promise((r) => setTimeout(r, 20));
  if (hasIdentify) {
    assert.equal(plugin.Cnds.IsIdentified.call(inst), true, 'held in memory: no key, so nothing is stored or sent');
    assert.equal(plugin.Exps.IdentifyRefusal.call(inst), '');
    assert.equal(warnings.filter((w) => w.includes('0.12.0')).length, 0);
  } else {
    // An addon built on an older SDK: nothing happens, one warning per call kind naming the version needed.
    assert.equal(plugin.Cnds.IsIdentified.call(inst), false);
    assert.equal(plugin.Exps.IdentifyRefusal.call(inst), 'unsupported');
    assert.equal(warnings.filter((w) => w.includes('0.12.0')).length, 2, warnings.join('\n'));
  }
  plugin.Acts.Identify.call(inst, 'player@example.com');
  assert.equal(plugin.Exps.IdentifyRefusal.call(inst), hasIdentify ? 'looks_like_email' : 'unsupported');
  assert.equal(warnings.some((w) => w.includes('player@example.com')), false, 'a refused value is never printed');
  inst._release();
});

/** Loads the runtime scripts the way main.js orders them, each in its own scope. */
function loadRuntime(consoleOverride) {
  const C3 = { Plugins: {} };
  let context = null;
  class ISDKPluginBase {}
  class ISDKObjectTypeBase {}
  class ISDKInstanceBase {
    constructor() {
      this.runtime = context.__runtime;
      this.triggered = [];
    }
    _getInitProperties() {
      return context.__props;
    }
    _trigger(fn) {
      this.triggered.push(fn);
    }
    _release() {
      this.released = true;
    }
  }
  const sandboxConsole = consoleOverride ? Object.assign({ log() {}, info() {}, error() {}, debug() {} }, consoleOverride) : console;
  context = vm.createContext({ C3, ISDKPluginBase, ISDKObjectTypeBase, ISDKInstanceBase, console: sandboxConsole, setTimeout, clearTimeout, Promise, JSON, Map, Object, Array, String, Number, Boolean, Math });
  context.globalThis = context;
  const order = [...read('c3runtime/main.js').matchAll(/import '\.\/([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(order.slice(0, 3), ['ravensight.js', 'glue.js', 'plugin.js'], 'the SDK and the glue load first');
  for (const file of order) {
    vm.runInContext('(function () {\n' + read('c3runtime/' + file) + '\n})();', context, { filename: file });
  }
  return context;
}

test('runtime scripts: the plugin registers, and every ACE has its runtime function', () => {
  const ctx = loadRuntime();
  const plugin = ctx.C3.Plugins[addon.id];
  assert.equal(typeof plugin, 'function');
  assert.equal(typeof plugin.Type, 'function');
  assert.equal(typeof plugin.Instance, 'function');
  assert.equal(typeof ctx.RavensightSDK.Ravensight, 'function', 'the bundled SDK');
  assert.equal(typeof ctx.RavensightConstructGlue.start, 'function', 'the glue');
  for (const [, group] of Object.entries(aces)) {
    for (const c of group.conditions) assert.equal(typeof plugin.Cnds[c.scriptName], 'function', 'Cnds.' + c.scriptName);
    for (const a of group.actions) {
      assert.equal(typeof plugin.Acts[a.scriptName], 'function', 'Acts.' + a.scriptName);
      assert.equal(plugin.Acts[a.scriptName].length, (a.params || []).length, a.scriptName + ' takes its parameters');
    }
    for (const e of group.expressions) {
      assert.equal(typeof plugin.Exps[e.expressionName], 'function', 'Exps.' + e.expressionName);
      assert.equal(plugin.Exps[e.expressionName].length, (e.params || []).length, e.expressionName + ' takes its parameters');
    }
  }
});

test('runtime instance: properties reach the glue, actions and expressions call it, triggers fire', async () => {
  const ctx = loadRuntime();
  const calls = [];
  let started = null;
  ctx.RavensightConstructGlue = {
    start(props, env) {
      started = { props, env };
      return new Proxy({}, { get: (_t, name) => (...args) => (calls.push([name, ...args]), name === 'deviceId' ? 'dev-1' : name === 'dispose' ? Promise.resolve() : true) });
    },
  };
  ctx.__runtime = { tag: 'runtime' };
  ctx.__props = ['gt_pub_x', '3.0.0', 1, false, 'itch', 'https://api.test', true];
  const plugin = ctx.C3.Plugins[addon.id];
  const inst = new plugin.Instance();
  assert.deepEqual(JSON.parse(JSON.stringify(started.props)), { ingestKey: 'gt_pub_x', gameVersion: '3.0.0', consent: 'opt_in', captureErrors: false, distribution: 'itch', apiUrl: 'https://api.test', debug: true });
  assert.equal(started.env.runtime.tag, 'runtime');
  assert.equal(started.env.SDK, ctx.RavensightSDK);

  plugin.Acts.Track.call(inst, 'boss', '{"hp":0}');
  plugin.Acts.Death.call(inst, 'forest');
  plugin.Acts.TrackAdRevenue.call(inst, 'admob', 2, 'end', 0.0015, 'USD');
  assert.deepEqual(calls.slice(0, 3), [
    ['track', 'boss', '{"hp":0}'],
    ['level', 'death', 'forest'],
    ['trackAdRevenue', 'admob', 2, 'end', 0.0015, 'USD'],
  ]);
  assert.equal(plugin.Exps.DeviceId.call(inst), 'dev-1');

  started.env.trigger('session_ready');
  started.env.trigger('nothing');
  assert.equal(inst.triggered.length, 1);
  assert.equal(inst.triggered[0], plugin.Cnds.OnSessionReady);
  inst._release();
  assert.equal(inst.released, true);
  assert.ok(calls.some((c) => c[0] === 'dispose'));
});
