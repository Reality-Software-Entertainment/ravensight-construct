// Ravensight for Construct 3: the glue between the addon's actions,
// conditions and expressions and the Ravensight JavaScript SDK.
//
// Construct runs a project's runtime in a Web Worker by default. A worker
// has fetch but no localStorage, no window and no page to hide, so the
// JavaScript SDK on its own would keep nothing between launches and send
// no game_started. This file gives it:
//
//   * a synchronous storage mirrored to the runtime's asynchronous
//     `runtime.storage`, loaded once before the client starts,
//   * game_started at start, and a flush when the runtime is suspended,
//   * a platform name from the runtime's platform info,
//   * every action the event sheet calls, buffered until the client exists,
//   * Identify player and Set campaign link checked on the event sheet's
//     side, so a refusal is known at once, and nothing but one warning when
//     the bundled SDK is older than 0.12.0. The hashing, the stored identity
//     and the campaign link rules are the JavaScript SDK's own code.
//
// When the runtime runs in the page (worker off), the JavaScript SDK uses
// the page itself: localStorage, page hide and its own automatic events.
//
// Plain script, no imports or exports: Construct loads it from
// c3runtime/main.js, and the tests load it under node. It sets
// globalThis.RavensightConstructGlue.
//
// MIT licensed, part of ravensight-construct.

(function () {
  'use strict';

  var VERSION = '0.1.0';
  var STORAGE_PREFIX = 'ravensight';
  var SEVERITIES = ['debug', 'info', 'warning', 'error', 'critical'];
  var AD_FORMATS = ['banner', 'interstitial', 'rewarded', 'native', 'app_open', 'other'];
  var AD_RESULTS = ['shown', 'clicked', 'failed', 'rewarded'];
  var CATEGORIES = ['bug', 'suggestion', 'complaint', 'praise', 'playtest', 'other'];
  /** identify() and setCampaignLink() are in the JavaScript SDK from this version. */
  var IDENTIFY_SDK = '0.12.0';
  var IDENTIFY_MAX_BYTES = 256;
  var LINK_ID = /^[0-9a-fA-F]{24}$/;

  /** UTF-8 bytes of a string, as the server and the SDK count them. */
  function utf8Length(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  /**
   * The account ID as identify() takes it, checked by the contract's rules:
   * text, or a whole number as its decimal digits; not empty; at most 256
   * bytes of UTF-8; no "@". Used exactly as given, never trimmed.
   * Returns { text } or { reason }.
   */
  function accountText(value) {
    var text;
    if (typeof value === 'string') text = value;
    else if (typeof value === 'number' && Number.isSafeInteger(value)) text = String(value);
    else return { reason: 'not_text' };
    if (text === '') return { reason: 'empty' };
    if (utf8Length(text) > IDENTIFY_MAX_BYTES) return { reason: 'too_long' };
    if (text.indexOf('@') >= 0) return { reason: 'looks_like_email' };
    return { text: text };
  }

  function hasPage() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
  }

  /**
   * A synchronous storage over an asynchronous one (getItem, setItem,
   * removeItem, keys, all returning promises). load() reads every key that
   * starts with "ravensight" once; after that reads are from memory and
   * every write goes to memory at once and to the asynchronous storage in
   * order, one write at a time per key, the latest value winning.
   */
  function mirrorStorage(target) {
    var map = new Map();
    var pending = new Map();
    var chain = Promise.resolve();

    function persist(key) {
      chain = chain.then(function () {
        if (!pending.has(key)) return undefined;
        var value = pending.get(key);
        pending.delete(key);
        var op = value === null ? target.removeItem(key) : target.setItem(key, value);
        return Promise.resolve(op).catch(function () {
          // The device is full or storage is gone: memory keeps the value.
        });
      });
    }

    return {
      load: function () {
        return Promise.resolve()
          .then(function () {
            return typeof target.keys === 'function' ? target.keys() : [];
          })
          .then(function (keys) {
            var wanted = (keys || []).filter(function (k) {
              return typeof k === 'string' && k.indexOf(STORAGE_PREFIX) === 0;
            });
            return Promise.all(
              wanted.map(function (k) {
                return Promise.resolve(target.getItem(k)).then(function (v) {
                  if (typeof v === 'string' && v !== '') map.set(k, v);
                });
              }),
            );
          })
          .catch(function () {
            // Unreadable storage: start empty, in memory.
          });
      },
      getItem: function (key) {
        return map.has(key) ? map.get(key) : null;
      },
      setItem: function (key, value) {
        var text = String(value);
        if (map.get(key) === text) return;
        map.set(key, text);
        var first = !pending.has(key);
        pending.set(key, text);
        if (first) persist(key);
      },
      removeItem: function (key) {
        if (!map.has(key)) return;
        map.delete(key);
        var first = !pending.has(key);
        pending.set(key, null);
        if (first) persist(key);
      },
      /** Resolves once every write so far has reached the target. */
      flushed: function () {
        return chain;
      },
    };
  }

  /**
   * The session's platform from the runtime's platform info: the export
   * (Android and iOS apps, desktop wrappers, the web) and the OS.
   */
  function platformName(info) {
    info = info || {};
    var exportType = String(info.exportType || '').toLowerCase();
    var os = String(info.os || '').toLowerCase();
    if (exportType === 'cordova' || exportType === 'html5' || exportType === 'preview' || exportType === 'nwjs' || exportType === '') {
      if (exportType === 'cordova' || exportType === 'nwjs') {
        if (os.indexOf('android') === 0) return 'android';
        if (os.indexOf('ios') === 0) return 'ios';
        if (os.indexOf('windows') === 0) return 'windows';
        if (os.indexOf('mac') === 0) return 'macos';
        if (os.indexOf('linux') === 0) return 'linux';
      }
      return 'web';
    }
    if (exportType.indexOf('windows') === 0) return 'windows';
    if (exportType.indexOf('macos') === 0) return 'macos';
    if (exportType.indexOf('linux') === 0) return 'linux';
    if (exportType.indexOf('xbox') === 0) return 'xbox';
    return exportType.replace(/[^a-z0-9_-]/g, '') || 'web';
  }

  function textOr(value, fallback) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
  }

  /**
   * Starts the SDK. props: { ingestKey, gameVersion, consent ('opt_in' or
   * 'opt_out'), captureErrors, distribution, apiUrl, debug }. env:
   *   SDK        the bundled JavaScript SDK module (Ravensight class and helpers)
   *   runtime    Construct's IRuntime: storage, platformInfo,
   *              addEventListener, projectVersion
   *   trigger    fn(name) for the trigger conditions: 'session_ready',
   *              'session_failed', 'config_ready'
   *   warn       fn(message), default console.warn
   *   extra      more JavaScript SDK options, for the tests
   * Returns the controller the actions, conditions and expressions call.
   */
  function start(props, env) {
    props = props || {};
    var SDK = env.SDK;
    var runtime = env.runtime || {};
    var trigger = env.trigger || function () {};
    var warn = env.warn || function (m) {
      if (typeof console !== 'undefined') console.warn(m);
    };
    var page = env.page === undefined ? hasPage() : env.page;
    var key = textOr(props.ingestKey, '');
    var client = null;
    var buffered = [];
    var lastReason = key ? 'starting' : 'no_key';
    var listeners = [];
    var disposed = false;
    var storage = null;
    var proto = (SDK && SDK.Ravensight && SDK.Ravensight.prototype) || {};
    var canIdentify = typeof proto.identify === 'function' && typeof proto.resetIdentity === 'function';
    var canSetLink = typeof proto.setCampaignLink === 'function';
    var bundled = (SDK && SDK.VERSION) || 'an older version';
    var warned = {};
    /** Why the last Identify player was refused, or '' when it was accepted. */
    var identifyRefusal = '';
    /** Before the client exists: true after a waiting identify, false after a waiting reset. */
    var waitingIdentified = false;

    function warnOnce(kind, action) {
      if (warned[kind]) return;
      warned[kind] = true;
      warn(
        'Ravensight: ' + action + ' needs the Ravensight JavaScript SDK ' + IDENTIFY_SDK + ' or newer, and this addon bundles ' +
          bundled + '. Nothing was sent. Rebuild the addon with a newer ravensight package.',
      );
    }

    var options = {
      ingestKey: key || null,
      optional: !key,
      gameVersion: textOr(props.gameVersion, textOr(runtime.projectVersion, '1.0.0')),
      consent: props.consent === 'opt_in' ? 'opt_in' : 'opt_out',
      captureErrors: props.captureErrors !== false,
      distribution: textOr(props.distribution, null),
      platform: platformName(runtime.platformInfo),
      debug: props.debug === true,
    };
    var apiUrl = textOr(props.apiUrl, '');
    if (apiUrl) options.apiUrl = apiUrl;
    var extra = env.extra || {};
    Object.keys(extra).forEach(function (k) {
      options[k] = extra[k];
    });

    function listen(type, fn) {
      if (typeof runtime.addEventListener !== 'function') return;
      try {
        runtime.addEventListener(type, fn);
        listeners.push([type, fn]);
      } catch (_err) {
        // Not an event this runtime has.
      }
    }

    function run(fn) {
      if (disposed) return;
      if (client) fn(client);
      else buffered.push(fn);
    }

    function begin() {
      if (disposed) return;
      options.onConfigReady = function () {
        trigger('config_ready');
      };
      client = new SDK.Ravensight(options);
      // In a worker there is no page: game_started is sent from here, and
      // a suspended runtime (tab hidden, app in the background) flushes.
      if (!page && options.autoEvents !== true && client.isEnabled()) client.track('game_started');
      listen('suspend', function () {
        if (client) void client.flush().catch(function () {});
      });
      var queued = buffered;
      buffered = [];
      queued.forEach(function (fn) {
        fn(client);
      });
      client.init().then(
        function (result) {
          lastReason = result && result.reason ? result.reason : '';
          trigger(result && result.sessionReady ? 'session_ready' : 'session_failed');
        },
        function (err) {
          lastReason = (err && err.code) || 'session_failed';
          trigger('session_failed');
        },
      );
    }

    var ready;
    if (!page && key) {
      // A worker: the runtime's storage, read before the client starts.
      options.autoEvents = false;
      if (runtime.storage && typeof runtime.storage.getItem === 'function') {
        storage = mirrorStorage(runtime.storage);
        options.storage = storage;
        ready = storage.load().then(begin);
      } else {
        ready = Promise.resolve().then(begin);
      }
    } else {
      ready = Promise.resolve().then(begin);
    }

    function jsonObject(text) {
      if (text == null || text === '') return {};
      try {
        var parsed = JSON.parse(String(text));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch (_err) {
        // Reported below.
      }
      return null;
    }

    function choose(list, value, fallback) {
      if (typeof value === 'number') return list[value] || fallback;
      return list.indexOf(String(value)) >= 0 ? String(value) : fallback;
    }

    var controller = {
      ready: ready,
      get client() {
        return client;
      },

      // --- actions --------------------------------------------------------
      track: function (name, jsonText) {
        var data = jsonObject(jsonText);
        if (data === null) {
          warn('Ravensight: event "' + name + '" not sent: its data is not a JSON object.');
          return false;
        }
        run(function (c) {
          c.track(String(name), data);
        });
        return true;
      },
      trackWithProperty: function (name, property, value) {
        var data = {};
        data[String(property)] = value;
        run(function (c) {
          c.track(String(name), data);
        });
      },
      level: function (kind, level, name) {
        var data = { rs_kind: kind, level: String(level) };
        run(function (c) {
          c.track(textOr(name, kind), data);
        });
      },
      purchase: function (amountMinor, currency, itemType, itemId) {
        run(function (c) {
          c.trackPurchase({ amount: Math.round(Number(amountMinor)), currency: String(currency), itemType: String(itemType), itemId: String(itemId) });
        });
      },
      trackError: function (severity, message) {
        var s = choose(SEVERITIES, severity, 'error');
        run(function (c) {
          c.trackError({ severity: s, message: String(message) });
        });
      },
      trackAd: function (network, format, result, placement) {
        var f = choose(AD_FORMATS, format, 'other');
        var r = choose(AD_RESULTS, result, 'shown');
        run(function (c) {
          c.trackAd(String(network), f, r, placement ? { placement: String(placement) } : {});
        });
      },
      /** revenue is the mediation callback's number in major units. */
      trackAdRevenue: function (network, format, placement, revenue, currency) {
        var micros = SDK.microsFromRevenue(Number(revenue));
        if (!micros) {
          warn('Ravensight: ad revenue not sent: ' + revenue + ' is not a revenue.');
          return false;
        }
        var f = choose(AD_FORMATS, format, 'other');
        run(function (c) {
          c.trackAdRevenue(String(network), f, placement ? String(placement) : null, micros, String(currency));
        });
        return true;
      },
      setAttribution: function (source, network, campaign, adset, creative) {
        var a = { source: String(source) };
        if (textOr(network, '')) a.network = String(network);
        if (textOr(campaign, '')) a.campaign = String(campaign);
        if (textOr(adset, '')) a.adset = String(adset);
        if (textOr(creative, '')) a.creative = String(creative);
        run(function (c) {
          c.setAttribution(a);
        });
      },
      setTrackingEnabled: function (on) {
        run(function (c) {
          c.setEnabled(Boolean(on));
        });
      },
      fetchConfig: function () {
        run(function (c) {
          void c.fetchConfig().catch(function () {});
        });
      },
      flush: function () {
        run(function (c) {
          void c.flush().catch(function () {});
        });
      },
      submitFeedback: function (message, category, rating) {
        var cat = choose(CATEGORIES, category, 'other');
        var stars = Number(rating);
        run(function (c) {
          void c.submitFeedback(String(message), cat, stars >= 1 && stars <= 5 ? Math.round(stars) : null).catch(function (err) {
            warn('Ravensight: feedback not sent (' + ((err && err.code) || 'failed') + ').');
          });
        });
      },
      resetDeviceId: function () {
        run(function (c) {
          void c.resetDeviceId().catch(function () {});
        });
      },
      /**
       * After the game's own sign-in. Returns true when the ID was handed to
       * the SDK; false, with IdentifyRefusal set and one warning that never
       * contains the value, when it was refused.
       */
      identify: function (accountId) {
        if (!canIdentify) {
          identifyRefusal = 'unsupported';
          warnOnce('identify', 'Identify player');
          return false;
        }
        var checked = accountText(accountId);
        if (checked.reason) {
          identifyRefusal = checked.reason;
          warn('Ravensight: Identify player refused (' + checked.reason + '). Pass a random ID stored with the account, never an email, a name or a sequential number.');
          return false;
        }
        identifyRefusal = '';
        if (!client) waitingIdentified = true;
        run(function (c) {
          c.identify(checked.text).catch(function (err) {
            identifyRefusal = (err && err.code) || 'refused';
          });
        });
        return true;
      },
      /** On sign-out: the SDK forgets the account and switches to a new device ID. */
      resetIdentity: function () {
        if (!canIdentify) {
          warnOnce('identify', 'Reset identity');
          return false;
        }
        if (!client) waitingIdentified = false;
        run(function (c) {
          void c.resetIdentity().catch(function () {});
        });
        return true;
      },
      /**
       * The rs_link value of the address the game was opened with. An empty
       * value (no rs_link there) is ignored quietly; anything else that is
       * not a link ID warns and is ignored.
       */
      setCampaignLink: function (linkId) {
        if (!canSetLink) {
          warnOnce('link', 'Set campaign link');
          return false;
        }
        if (linkId === '') return false;
        if (typeof linkId !== 'string' || !LINK_ID.test(linkId)) {
          warn('Ravensight: Set campaign link ignored: a link ID is 24 characters, 0-9 and a-f.');
          return false;
        }
        run(function (c) {
          c.setCampaignLink(linkId);
        });
        return true;
      },

      // --- conditions -----------------------------------------------------
      isTrackingEnabled: function () {
        return Boolean(client && client.isEnabled());
      },
      isSessionReady: function () {
        return Boolean(client && client.isSessionValid());
      },
      isIdentified: function () {
        if (!canIdentify) return false;
        if (!client) return waitingIdentified;
        return Boolean(client.isIdentified);
      },

      // --- expressions ----------------------------------------------------
      deviceId: function () {
        return (client && client.deviceId) || '';
      },
      statusReason: function () {
        return lastReason || '';
      },
      configString: function (k, fallback) {
        var f = String(fallback);
        return client ? client.getConfig(String(k), f) : f;
      },
      configNumber: function (k, fallback) {
        var f = Number(fallback);
        return client ? client.getConfig(String(k), f) : f;
      },
      queueLength: function () {
        return client ? client.queue.length : buffered.length;
      },
      identifyRefusal: function () {
        return identifyRefusal;
      },

      dispose: function () {
        if (disposed) return Promise.resolve();
        if (typeof runtime.removeEventListener === 'function') {
          listeners.forEach(function (pair) {
            try {
              runtime.removeEventListener(pair[0], pair[1]);
            } catch (_err) {
              // Already gone.
            }
          });
        }
        var c = client;
        disposed = true;
        return Promise.resolve(c ? c.dispose().catch(function () {}) : undefined).then(function () {
          return storage ? storage.flushed() : undefined;
        });
      },
    };
    return controller;
  }

  globalThis.RavensightConstructGlue = {
    VERSION: VERSION,
    start: start,
    mirrorStorage: mirrorStorage,
    platformName: platformName,
  };
})();
