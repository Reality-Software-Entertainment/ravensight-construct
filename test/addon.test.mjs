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

/** Loads the runtime scripts the way main.js orders them, each in its own scope. */
function loadRuntime() {
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
  context = vm.createContext({ C3, ISDKPluginBase, ISDKObjectTypeBase, ISDKInstanceBase, console, setTimeout, clearTimeout, Promise, JSON, Map, Object, Array, String, Number, Boolean, Math });
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
