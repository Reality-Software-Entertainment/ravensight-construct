# Ravensight for Construct 3

Player analytics for Construct 3 games: sessions, events, retention,
levels, purchases, errors, ads and attribution, remote config and
experiments, sent to [Ravensight](https://ravensight.io), from the event
sheet.

Version 0.1.0. Beta: the glue is tested against the Ravensight JavaScript
SDK and a fake server, and the runtime scripts in a sandbox, but the addon
has not yet been loaded into Construct. See
[docs/FEASIBILITY.md](docs/FEASIBILITY.md).

The addon is a plugin that bundles the Ravensight JavaScript SDK, so every
delivery rule (the saved queue, retries, signing, compression, error
capture) is that SDK's.

## Install

1. Download `ravensight-0.1.0.c3addon` from the releases, or build it with
   `npm install && npm run build` (it lands in `dist/`).
2. In Construct: Menu > View > Addon manager > Install new addon.
3. Insert the **Ravensight** object (Web category) into your project. It is
   a single global object.
4. Set its **Ingest key** property to your game's key.

Without an ingest key the object is inert: no storage, no requests.

## Properties

| Property | Default | What it does |
|---|---|---|
| Ingest key | empty | Your game's publishable key (`gt_live_` or `gt_pub_`). |
| Game version | the project version | Sent on every session. |
| Consent | Opt out | Opt in: nothing is sent, and no device ID is made, until `Set tracking enabled` to true. |
| Capture errors | on | Automatic error capture, scrubbed on the device. |
| Distribution | empty | A short store label, such as `itch`. |
| API URL | empty | Empty for `https://api.ravensight.io`. |
| Debug | off | Log SDK activity to the console. |

## Actions

| Action | What it sends |
|---|---|
| Track event | An event with a JSON object of properties (or none). |
| Track event with a property | An event with one property. |
| Level start, Level complete, Death | An event with `rs_kind` and `level`, read by the Levels view without setup. |
| Purchase | A real-money purchase, amount in whole minor units (499 is 4.99). |
| Track error | An error the game reports, with a severity. |
| Track ad | An ad step without revenue (clicked, failed, rewarded). |
| Track ad revenue | A paid impression; revenue in major units, sent as micros. |
| Set attribution | Where the install came from, once per device. |
| Set tracking enabled | The player's choice, saved at once. |
| Fetch remote config | This device's remote config. |
| Flush | Send now. |
| Submit feedback | Player feedback with a category and a 1 to 5 rating. |
| Reset device ID | A new random device ID. |

## Conditions

`On session ready`, `On session failed`, `On config ready` (triggers),
`Is tracking enabled`, `Is session ready`.

## Expressions

`DeviceId`, `StatusReason` (why no session is open), `ConfigString(key,
default)`, `ConfigNumber(key, default)`, `QueueLength`. Reading a config
value is what counts as seeing a running experiment.

See [example/README.md](example/README.md) for an event sheet.

## Worker mode

Construct runs games in a Web Worker by default, where there is no
`localStorage` and no page. The addon keeps the SDK's saved state in the
project's storage (`runtime.storage`), sends `game_started` itself and
flushes when the game is suspended. A worker has no quit event, so
`game_exited` is not sent in worker mode. With worker mode off, the SDK
uses the page as on any web page.

## Privacy

What is sent:

- A random device ID made on first launch and kept in the project's
  storage. It is not derived from hardware or an account.
- On each session: that ID, your game version, the platform from the export
  (`web`, `android`, `ios`, `windows`, `macos`, `linux`), the SDK name and
  version, and your Distribution label if set. With worker mode off, the
  GPU name where the browser gives it without a prompt.
- The events your event sheets send, with their time and an `rs_event_id`.
- Automatic error captures (on by default), scrubbed on the device first:
  emails, tokens, keys, addresses, home folders and URL queries are removed.

Saved on the device: the device ID, unsent events (with the session they
belong to), the player's opt-in choice and whether attribution was sent.

The player's choice: `Set tracking enabled` to false stops sending, drops
the queue and is saved. With Consent set to Opt in, nothing is sent until
it is set to true.

## Building and testing

```
npm install
npm test        # builds addon/c3runtime, then runs the tests
npm run build   # builds dist/ravensight-<version>.c3addon
```

## License

MIT. The bundled JavaScript SDK is MIT too. See [LICENSE](LICENSE).
