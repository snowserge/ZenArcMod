# Pinned-tab sync removal regression (2.5.1)

## Finding

The mod has no personal tab names/URLs and does not call `pinTab`, `unpinTab`,
or a session-state replacement API. However, its broad `removeTab`/`removeTabs`
wrappers prevented native removal of pinned copies as well as user closes.
An incoming sync deletion could therefore keep the old pin instead of removing
it. That stale copy can survive into saved sessions and later sync cycles.
This is a confirmed interception bug in a simulated call path, and a plausible
contributor to the reported re-pinning after sync/restart. The user's exact
multi-device sequence has not been reproduced in a live browser.

Checked against Zen 1.23.4b, revision
`541ee55196395ee8082862b83c84c90ab41d9f6d`:

- [ZenWindowSync](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/sessionstore/ZenWindowSync.sys.mjs):
  `on_TabUnpinned` delegates to `on_TabClose` when syncing only pinned tabs;
  `on_TabClose` synchronously removes same-ID copies from other windows.
- [ZenSpacesSyncApplier](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/sync/ZenSpacesSyncApplier.sys.mjs):
  `applyBatch` accepts tombstones (`record.deleted`, `record.id`), awaits startup,
  and `#deleteTabs` removes the matching tab through `gBrowser.removeTab`.

## Change

Share native sync hooks between windows. Authorize only the tab IDs supplied to
`on_TabClose` or to explicit incoming tombstones, for the lifetime of that call
or promise. Reference counts handle concurrent/nested removals. Single and bulk
close wrappers pass matching tabs to native removal. Ordinary close commands,
gestures and unrelated pinned tabs retain protection. No persisted list is added.
The adapter neither generates sync records nor changes their pin state.

Do not use a general startup/session-restoring flag as a bypass: the cloud
applier awaits asynchronous work, during which unrelated user closes can occur.
Unsupported native modules are reported through `__zenSafeClose.status.nativeSync`
without disabling close protection. Hooks restore on the last window unload;
in-flight authorizations survive Sine hot reload until the operation settles.

## Automated verification

`node --test tests/native-sync.test.cjs` executes the actual shipped core and
adapter, with simulated browser objects and native module entry points. Covers:
old interception versus fixed tombstone removal; same-ID copies in two windows;
pending batches and unrelated pins; mixed bulk removal; ordinary close protection;
close commands during sync; throws/rejections; overlapping batches and duplicate
records; shared hook teardown; unavailable modules; hot reload during a batch.
The remaining folder, session and gesture regression suites also run.

## Live verification still required

1. Update **all participating computers** to 2.5.1 and restart Zen. Leave native
   sync enabled; do not reset sync or delete session/profile data.
2. Unpin a disposable test pin on computer A. Trigger sync on A then B. Confirm
   it remains ordinary (or is absent on B if only pinned tabs sync).
3. Restart A and B, sync again, and confirm it does not return as a pin.
4. Repeat with two synced windows, loaded and unloaded pins, a nested folder,
   and session memory enabled/disabled. Closing a separate pin by shortcut or
   gesture must still unload/keep it.
5. Repeat a remote deletion while another local pin is closed normally. Only
   the remotely deleted ID may bypass low-level protection.

No live account-to-account sync, remote server reconciliation, actual Gecko
event routing or ARM macOS/Windows restart scenario is covered by the simulated
tests. The fix cannot retroactively determine the intended state of stale
records already stored by native sync.
