// The one Ravensight object of a project: starts the SDK from the plugin's
// properties and fires the trigger conditions.
const C3 = globalThis.C3;

const TRIGGERS = {
  session_ready: 'OnSessionReady',
  session_failed: 'OnSessionFailed',
  config_ready: 'OnConfigReady',
};

C3.Plugins.RealitySE_Ravensight.Instance = class RavensightInstance extends globalThis.ISDKInstanceBase {
  constructor() {
    super();
    const props = this._getInitProperties() || [];
    this._rs = globalThis.RavensightConstructGlue.start(
      {
        ingestKey: props[0],
        gameVersion: props[1],
        consent: props[2] === 1 ? 'opt_in' : 'opt_out',
        captureErrors: props[3] !== false,
        distribution: props[4],
        apiUrl: props[5],
        debug: props[6] === true,
      },
      {
        SDK: globalThis.RavensightSDK,
        runtime: this.runtime,
        trigger: (name) => {
          const cnd = TRIGGERS[name];
          if (cnd) this._trigger(C3.Plugins.RealitySE_Ravensight.Cnds[cnd]);
        },
      },
    );
  }

  _release() {
    if (this._rs) void this._rs.dispose();
    this._rs = null;
    super._release();
  }
};
