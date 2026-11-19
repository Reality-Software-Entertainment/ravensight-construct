# Construct 3: feasibility against the SDK contract

Checked on 2026-11-06 against the Construct 3 Addon SDK (version 2) and
scripting reference (`IRuntime`, `runtime.storage`, `runtime.platformInfo`,
the `suspend` event, worker mode); identify and campaign links added on
2026-11-19. Construct has no command line, so the
addon has not been loaded into Construct here. The glue is tested under Node
24 and later against the real Ravensight JavaScript SDK and a fake server,
and the runtime scripts are loaded in a sandbox with stand-in base classes.
"Documented" below means the Construct manual says so.

## The shape: a plugin that bundles the JavaScript SDK

The addon is a single-global plugin. Its runtime module loads, in order, the
Ravensight JavaScript SDK (bundled from the `ravensight` npm package by
`scripts/build.mjs`, with its version and hash in the file header), the
glue (`src/glue.js`), then the plugin's classes, conditions, actions and
expressions. Every delivery rule is the JavaScript SDK's own code.

Construct runs a project's runtime in a Web Worker by default ("Use worker"
Auto). The two modes differ:

| Mode | Storage | Lifecycle |
|---|---|---|
| Worker (default) | No `localStorage`. The glue mirrors the SDK's keys (those starting `ravensight`) to `runtime.storage`, read once before the client starts, written through in order | No page. The glue sends `game_started` and flushes on the runtime's `suspend` event |
| Page (worker off) | The browser's `localStorage`, as the JavaScript SDK does itself | The JavaScript SDK's page hide, `game_started` and `game_exited` |

## Verdicts

| Contract need | Construct API | Verdict |
|---|---|---|
| HTTP with custom headers and a body | `fetch` in the worker and the page (documented). | Possible, tested. |
| Persistent storage | `runtime.storage`: asynchronous `getItem`, `setItem`, `removeItem`, `keys` over IndexedDB (documented). | Possible: a synchronous mirror, loaded before the client starts. Actions called before it loads are buffered and replayed in order. A write reaches IndexedDB a moment after it reaches memory, so a hard kill in between can lose the last change. |
| gzip | `CompressionStream` (documented in workers in current browsers). | Possible, tested: a batch of 1,024 bytes or more goes compressed. Desktop wrappers inherit the browser engine's support. |
| HMAC-SHA256 | The JavaScript SDK's own. | Possible. |
| Random bytes | `crypto.getRandomValues` in workers. | Possible. |
| Quit hook | None in the worker; the page has `pagehide`. | Degraded in worker mode: no `game_exited`. A session ends when its token expires. |
| Background hook | `runtime` `suspend` and `resume` events. | Possible: a flush on suspend. No 30-minute background session split in worker mode. |
| Device fields | `runtime.platformInfo`: export type and OS. No model or GPU in the worker. | The platform comes from the export (`android`, `ios`, `windows`, `macos`, `linux`, `xbox`, `web`). In page mode the JavaScript SDK reads the GPU where the browser allows. |
| Error capture | The JavaScript SDK's window, fetch and XHR hooks. | Page mode: as the JavaScript SDK. Worker mode: only what the worker sees (its own fetch and errors); not verified inside Construct. |
| Remote config and exposure | Expressions `ConfigString` and `ConfigNumber`. | Possible, tested: the first read tags later events and sends one `rs_exposure`. |
| Ads | No mediation API in Construct; ad plugins report revenue as a number. | `Track ad revenue` converts the number to micros with the SDK's decimal helper, never a float multiply. |
| Identify (Identify player, Reset identity, Is identified, IdentifyRefusal) | The bundled SDK's `identify`, `resetIdentity` and `isIdentified` (0.12.0 or newer). | Possible, tested in worker mode with the contract's vectors: `POST /identify` as exactly `{ accountHash }`, the identity kept in `runtime.storage` across relaunches. The glue checks the account ID on the event sheet's side so a refusal is known at once. With an older bundled SDK the actions warn once and do nothing. |
| Campaign links | Page mode: the page address. Worker mode: no page address in the worker; the Browser object's `QueryParam` on the event sheet. Deep link exports: the address the game was opened with. | Page mode: automatic (bundled SDK 0.8.0 or newer), tested. Worker mode and deep links: the Set campaign link action (0.12.0 or newer), tested in worker mode; `Browser.QueryParam` in a worker is the Construct manual's, not verified here. |
| SDK name on the session | The JavaScript SDK sends `js/<version>`. | Degraded: sessions read as the JavaScript SDK. |
| Packaging | A `.c3addon` (a zip of `addon/`), SDK version 2, runtime module `c3runtime/main.js`. | Built by `npm run build`. Loading it in Construct is an owner step. |

## Contract items degraded

1. Worker mode sends no `game_exited`, and has no background session split.
2. Worker mode writes storage a moment after memory; a hard kill in between can lose the last change.
3. No device model, and no GPU in worker mode.
4. Sessions name the JavaScript SDK, not Construct.
5. Worker-mode error capture is unverified inside Construct.
6. Worker mode does not read `rs_link` on its own: the event sheet passes `Browser.QueryParam("rs_link")` to Set campaign link.

## Before release

1. Install `dist/ravensight-0.2.0.c3addon` in Construct (Menu > View >
   Addon manager), add the object to a project, and check the properties,
   every action, condition and expression appear with their strings.
2. Preview with worker mode on and off against a staging key: a session, a
   batch, `On session ready`, `ConfigNumber`, an opt-out that survives a
   reload, and offline then reload with the origin.
3. Export to web, Android (Cordova) and Windows (WebView2) and repeat the
   session check.
4. Built with `ravensight` 0.12.0 or newer, against a server that offers
   identify: Identify player after a sign-in, Is identified, the hash kept
   across a reload; and open a web export from a campaign link with worker
   mode on (Set campaign link with `Browser.QueryParam("rs_link")`) and off,
   and confirm the link is counted.
