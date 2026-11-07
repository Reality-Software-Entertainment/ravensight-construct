const SDK = globalThis.SDK;
const PLUGIN_CLASS = SDK.Plugins.RealitySE_Ravensight;

PLUGIN_CLASS.Instance = class RavensightEditorInstance extends SDK.IInstanceBase {
  constructor(sdkType, inst) {
    super(sdkType, inst);
  }
  Release() {}
  OnCreate() {}
  OnPropertyChanged(_id, _value) {}
  LoadC2Property(_name, _valueString) {
    return false;
  }
};
