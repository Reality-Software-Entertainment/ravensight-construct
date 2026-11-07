# Changelog

## Unreleased

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
