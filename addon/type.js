const SDK = globalThis.SDK;
const PLUGIN_CLASS = SDK.Plugins.RealitySE_Ravensight;

PLUGIN_CLASS.Type = class RavensightType extends SDK.ITypeBase {
  constructor(sdkPlugin, iObjectType) {
    super(sdkPlugin, iObjectType);
  }
};
