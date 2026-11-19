const C3 = globalThis.C3;

C3.Plugins.RealitySE_Ravensight.Exps = {
  DeviceId() {
    return this._rs.deviceId();
  },
  StatusReason() {
    return this._rs.statusReason();
  },
  ConfigString(key, fallback) {
    return this._rs.configString(key, fallback);
  },
  ConfigNumber(key, fallback) {
    return this._rs.configNumber(key, fallback);
  },
  QueueLength() {
    return this._rs.queueLength();
  },
  IdentifyRefusal() {
    return this._rs.identifyRefusal();
  },
};
