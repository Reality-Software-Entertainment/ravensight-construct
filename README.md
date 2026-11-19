# Ravensight for Construct 3

Player analytics for Construct 3 games: sessions, events, retention,
levels, purchases, errors, ads and attribution, remote config and
experiments, sent to [Ravensight](https://ravensight.io), from the event
sheet.

Preview: not yet verified inside Construct 3; tested with the addon's
runtime scripts under Node 24 against the Ravensight JavaScript SDK and a
fake server.

Version 0.2.0. What each Construct feature maps to, and what is degraded,
is in [docs/FEASIBILITY.md](docs/FEASIBILITY.md).

The addon is a plugin that bundles the Ravensight JavaScript SDK, so every
delivery rule (the saved queue, retries, signing, compression, error
capture, the identify hash, campaign links) is that SDK's.

## Install

There is no release download yet: build the addon from this repository,
[ravensight-construct](https://github.com/Reality-Software-Entertainment/ravensight-construct)
(tag `v0.2.0`), with Node 24.

1. In a clone of the repository: `npm install`, then `npm run build`. The
   addon lands in `dist/ravensight-0.2.0.c3addon`. It bundles the
   `ravensight` package npm installed (0.7.0 or later; Identify player,
   Reset identity and Set campaign link need 0.12.0 or newer); the first
   line of `addon/c3runtime/ravensight.js` names its version.
2. In Construct: Menu > View > Addon manager > Install new addon, and pick
   that file.
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
| Set tracking enabled | The player's choice. Off drops the queue and a stored account hash. Saved only with Consent set to Opt in. |
| Fetch remote config | This device's remote config. |
| Flush | Send now. |
| Submit feedback | Player feedback with a category and a 1 to 5 rating. |
| Reset device ID | A new random device ID. |
| Identify player | After your own sign-in: a salted hash of the account ID, once per session. See "Identify players who sign in". |
| Reset identity | On sign-out: forgets the account and switches to a new device ID. |
| Set campaign link | The `rs_link` value of the address the game was opened with, sent with the next session. See "Campaign links". |

## Conditions

`On session ready`, `On session failed`, `On config ready` (triggers),
`Is tracking enabled`, `Is session ready`, `Is identified`.

## Expressions

`DeviceId`, `StatusReason` (why no session is open), `ConfigString(key,
default)`, `ConfigNumber(key, default)`, `QueueLength`, `IdentifyRefusal`
(why the last Identify player was refused, or empty). Reading a config
value is what counts as seeing a running experiment.

See [example/README.md](example/README.md) for an event sheet.

## Worker mode

Construct runs games in a Web Worker by default, where there is no
`localStorage` and no page. The addon keeps the SDK's saved state in the
project's storage (`runtime.storage`), sends `game_started` itself and
flushes when the game is suspended. A worker has no quit event, so
`game_exited` is not sent in worker mode. With worker mode off, the SDK
uses the page as on any web page.

## Identify players who sign in

If your game has its own login, use **Identify player** once the player
signs in and **Reset identity** when they sign out. One person on two
devices, or before and after signing in, then counts as one player. Both
need the addon built with `ravensight` 0.12.0 or newer; with an older one
they do nothing and print one warning that names the version needed.

```
Login: On signed in
    Ravensight: Identify the player as Account.AnalyticsId

Login: On signed out
    Ravensight: Reset the player identity
```

- **What is sent:** a salted hash of the ID (`accountHash`, 64 hex
  characters, keyed with your game's own salt from the session answer) and
  the session token, once per session. The raw account ID, an email or a
  name is never sent and never stored; until the first session answer the
  ID is held in memory only.
- **Pass a random, high-entropy ID**, such as a random UUID or a random
  analytics ID you make once for each account and store with it, never a
  sequential database key, an email, a name or a handle. Your game's salt
  reaches every copy of the game, so anyone could hash 1, 2, 3 and onward
  and match a guessable ID; a random one cannot be guessed. The hash is
  still a pseudonymous identifier for the player: declare it in your game's
  privacy notice.
- **A refusal is known at once.** A value that is empty, over 256 bytes of
  UTF-8 or contains `@` is refused: nothing changes, one warning is printed
  (without the value), and `Ravensight.IdentifyRefusal` reads `empty`,
  `too_long` or `looks_like_email` until the next accepted call, which sets
  it back to empty. It reads `unsupported` when the bundled SDK is older
  than 0.12.0.
- **One event per identified session** on your usage balance. The same
  account again in the same session sends nothing; a refused or failed
  request is tried once more at the next session, never in a loop.
- **A different account** on the same device first resets the identity,
  which deletes the stored hash and switches to a fresh device ID (as
  Reset device ID does), so the next player is not linked to the last one.
  Reset device ID alone keeps the identity.
- The hash is stored as `ravensight_identity` beside the device ID, in the
  project's storage in worker mode and in the page's `localStorage` with
  worker mode off. It never enters the event queue and never delays an
  event. Without a key, or before an opt-in yes, it is held in memory only;
  Set tracking enabled to false deletes it. **Is identified** is true while
  an account is set.

## Campaign links

A Ravensight campaign link that points at a web page adds
`rs_link=<link id>` to the address it redirects to.

- **Worker mode off: nothing to do.** The bundled SDK reads `rs_link` from
  the page address once, when it starts, and sends it as `campaignLink`
  with the first session it opens (`ravensight` 0.8.0 or newer bundled).
- **Worker mode (Construct's default): pass it on.** The game runs in a
  worker, which cannot see the page address, so the SDK cannot read it.
  Add the Browser object and, on start of the first layout, use
  **Set campaign link** with `Browser.QueryParam("rs_link")`. An address
  without `rs_link` gives an empty value, which the action ignores quietly.
- **An export opened from a deep link** (an app, or a desktop build opened
  by a custom address): point the campaign link at your own https page that
  opens the game, read `rs_link` from the address the game was opened
  with, and pass it to **Set campaign link** the same way.

```
System: On start of layout
    Ravensight: Set campaign link to Browser.QueryParam("rs_link")
```

Set campaign link needs the addon built with `ravensight` 0.12.0 or newer.
It takes a link ID (24 hex characters, in any case), which then replaces a
link still waiting; anything else prints one warning and is ignored. The ID
goes lowercased, as `campaignLink`, on the session:

- **Sent once.** Use it before the first session opens if you can (start
  of the first layout); a later call goes with the next session the SDK
  opens. Only a session answer with a token clears it, so a failed attempt
  keeps it for the next one.
- **Same consent as everything else.** With Consent set to Opt in it goes
  with the first session after the player's yes. An opted out player or an
  object without a key sends nothing, and a playtest run never sends it.
- **Nothing is stored.** The ID is one your studio made, not personal data.
- The server keeps it only when it names a link of the same game. The
  player and the session are then counted on the Campaign links page, by
  link, and those players open in Player insights.

## Privacy

What is sent:

- A random device ID made on first launch and kept in the project's
  storage. It is not derived from hardware or an account.
- On each session: that ID, your game version, the platform from the export
  (`web`, `android`, `ios`, `windows`, `macos`, `linux`), the JavaScript
  SDK's name and version (sessions from Construct read as the JavaScript
  SDK), and your Distribution label if set. With worker mode off, the GPU
  name where the browser gives it without a prompt.
- A salted hash of your own account ID, only when your event sheet uses
  Identify player, once per session (see "Identify players who sign in").
- A campaign link ID, once, on the first session after the page address
  carried `rs_link` (worker mode off) or your event sheet used Set campaign
  link (see "Campaign links").
- The events your event sheets send, with their time and an `rs_event_id`.
- Automatic error captures (on by default), scrubbed on the device first:
  emails, tokens, keys, addresses, home folders and URL queries are removed.
- No advertising identifier, no names, no emails: Identify player refuses
  any value containing `@`.

Saved on the device: the device ID, unsent events (with the session they
belong to), the player's opt-in choice, whether attribution was sent, and
the account hash once your event sheet uses Identify player.

The player's choice: `Set tracking enabled` to false stops sending, drops
the queue and deletes a stored account hash. With Consent set to Opt out
(the default) the SDK does not save that choice: keep it in your own save
data and set it again at every start. With Consent set to Opt in, nothing
is sent until it is set to true, and the yes is saved.

## Develop

```
npm install
npm test        # builds addon/c3runtime, then runs the tests (Node 24)
npm run build   # builds dist/ravensight-<version>.c3addon
```

Install the local checks once per clone: `git config core.hooksPath .githooks`. The pre-push hook then runs this repository's tests before every push, with a time limit, and refuses the push if they fail. CI runs nightly and on demand, not on pushes or pull requests, so this hook is where a change is checked first.

## License

MIT. The bundled JavaScript SDK is MIT too. See [LICENSE](LICENSE).
