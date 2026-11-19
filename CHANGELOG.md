# Changelog

## 0.2.0 - 2026-11-19

Identify needs a Ravensight server with `POST /identify` and
`identify.salt` on the session answer; until then identify sends nothing.
Identify player, Reset identity and Set campaign link call the bundled
JavaScript SDK, so they need the addon built with `ravensight` 0.12.0 or
newer; built with an older one they do nothing and print one warning that
names the version needed. Everything else still builds on 0.7.0 or newer.

### Added

- Identify players who sign in: the Identify player and Reset identity
  actions, the Is identified condition and the IdentifyRefusal expression.
  The account ID is checked on the event sheet's side (empty, over 256
  bytes of UTF-8 or containing `@` is refused at once); only a salted hash
  of it is sent, once per session, and it is kept in the project's storage
  in worker mode. Tested with the contract's vectors
  (`test/fixtures/identify-vectors.json`).
- Campaign links: with worker mode off the bundled SDK sends the page's
  `rs_link` with its first session (0.8.0 or newer); in worker mode, and
  for exports opened from a deep link, the Set campaign link action passes
  the link ID (for example `Browser.QueryParam("rs_link")`).

### Changed

- The README is marked preview and builds the addon from this repository;
  there is no release download. CI runs nightly on weekdays and on demand
  instead of on every push, and a pre-push hook in `.githooks` runs the
  tests first.
- `package-lock.json` is committed; CI and the pre-push hook install with
  `npm ci`, so a run is reproducible from the commit.
- Set tracking enabled's description and the README's privacy notes now say
  the player's choice is saved only with Consent set to Opt in (they said
  it was always saved), and that sessions read as the JavaScript SDK.

## 0.1.0 - 2026-11-06

### Added

- First release, version 0.1.0: a Construct 3 plugin (Addon SDK version 2)
  that bundles the Ravensight JavaScript SDK (0.7.0 or later).
- Actions for events, levels, deaths, purchases, errors, ads and ad revenue,
  attribution, the player's choice, remote config, flush, feedback and a
  device ID reset; triggers for session ready, session failed and config
  ready; expressions for the device ID, the status reason and config values.
- Worker mode: the SDK's saved state mirrored to `runtime.storage`,
  `game_started` from the addon and a flush on suspend.
- Platform names from the export type.
