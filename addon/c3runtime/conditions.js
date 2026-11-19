const C3 = globalThis.C3;

C3.Plugins.RealitySE_Ravensight.Cnds = {
  OnSessionReady() {
    return true;
  },
  OnSessionFailed() {
    return true;
  },
  OnConfigReady() {
    return true;
  },
  IsTrackingEnabled() {
    return this._rs.isTrackingEnabled();
  },
  IsSessionReady() {
    return this._rs.isSessionReady();
  },
  IsIdentified() {
    return this._rs.isIdentified();
  },
};
