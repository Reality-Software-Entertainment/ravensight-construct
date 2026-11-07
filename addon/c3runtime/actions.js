const C3 = globalThis.C3;

C3.Plugins.RealitySE_Ravensight.Acts = {
  Track(name, dataJson) {
    this._rs.track(name, dataJson);
  },
  TrackWithProperty(name, property, value) {
    this._rs.trackWithProperty(name, property, value);
  },
  LevelStart(level) {
    this._rs.level('level_start', level);
  },
  LevelComplete(level) {
    this._rs.level('level_complete', level);
  },
  Death(level) {
    this._rs.level('death', level);
  },
  Purchase(amount, currency, itemType, itemId) {
    this._rs.purchase(amount, currency, itemType, itemId);
  },
  TrackError(severity, message) {
    this._rs.trackError(severity, message);
  },
  TrackAd(network, format, result, placement) {
    this._rs.trackAd(network, format, result, placement);
  },
  TrackAdRevenue(network, format, placement, revenue, currency) {
    this._rs.trackAdRevenue(network, format, placement, revenue, currency);
  },
  SetAttribution(source, network, campaign, adset, creative) {
    this._rs.setAttribution(source, network, campaign, adset, creative);
  },
  SetTrackingEnabled(enabled) {
    this._rs.setTrackingEnabled(enabled);
  },
  FetchConfig() {
    this._rs.fetchConfig();
  },
  Flush() {
    this._rs.flush();
  },
  SubmitFeedback(message, category, rating) {
    this._rs.submitFeedback(message, category, rating);
  },
  ResetDeviceId() {
    this._rs.resetDeviceId();
  },
};
