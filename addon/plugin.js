// Editor side of the Ravensight plugin: one global object, its properties
// and the runtime module that holds the SDK.
const SDK = globalThis.SDK;

const PLUGIN_ID = 'RealitySE_Ravensight';
const PLUGIN_CATEGORY = 'web';

const PLUGIN_CLASS = (SDK.Plugins.RealitySE_Ravensight = class RavensightPlugin extends SDK.IPluginBase {
  constructor() {
    super(PLUGIN_ID);
    SDK.Lang.PushContext('plugins.' + PLUGIN_ID.toLowerCase());

    this._info.SetName(globalThis.lang('.name'));
    this._info.SetDescription(globalThis.lang('.description'));
    this._info.SetCategory(PLUGIN_CATEGORY);
    this._info.SetAuthor('Reality Software Entertainment');
    this._info.SetHelpUrl(globalThis.lang('.help-url'));
    this._info.SetIsSingleGlobal(true);
    this._info.SetRuntimeModuleMainScript('c3runtime/main.js');

    SDK.Lang.PushContext('.properties');
    // The order here is the order of _getInitProperties() at runtime.
    this._info.SetProperties([
      new SDK.PluginProperty('text', 'ingest-key', ''),
      new SDK.PluginProperty('text', 'game-version', ''),
      new SDK.PluginProperty('combo', 'consent', { initialValue: 'opt-out', items: ['opt-out', 'opt-in'] }),
      new SDK.PluginProperty('check', 'capture-errors', true),
      new SDK.PluginProperty('text', 'distribution', ''),
      new SDK.PluginProperty('text', 'api-url', ''),
      new SDK.PluginProperty('check', 'debug', false),
    ]);
    SDK.Lang.PopContext();

    SDK.Lang.PopContext();
  }
});

PLUGIN_CLASS.Register(PLUGIN_ID, PLUGIN_CLASS);
