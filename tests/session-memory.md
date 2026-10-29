# Remember loaded tabs across restarts (2.4.0)

Enable **Configure → Session restore → Remember loaded tabs across browser
restarts**. Default: off. On initial live enable it records current state;
it does not revive stale markers from an earlier disabled session.

The next restart uses native session restore to bring back existing windows,
folders and tabs. Each eligible tab has a custom SessionStore string value,
`zen-safe-close.loaded.v1`, containing only "1" (loaded) or "0" (pending).
No URL list or second copy of the session is maintained. Markers follow tab
identity through native session data, including duplicate URLs and reordered
tabs. The native empty-screen placeholder, Glance and private windows are
excluded.

After SessionStore's startup promise, saved-loaded pending tabs enter a
background restore queue, using the existing browser's reload method.
Firefox's lazy-browser reload adapter waits for SSTabRestoring and reloads the
saved history entry. No tab is selected or created. There are two outstanding
restore slots; completion, removal, an error or a 20-second timeout frees a
slot. A timeout does not stop the underlying network request, so this is not a
hard cap on simultaneous page network activity.

## Session policy

While enabled, the module manages:

- `browser.startup.page = 3` (restore previous session);
- `browser.sessionstore.restore_on_demand = true`;
- `browser.sessionstore.restore_pinned_tabs_on_demand = true`.

The previous user/default values are saved in a small internal preference,
`zen-safe-close-internal.sessionRestorePolicy`. Policy stays set across normal
window shutdown and application restart, because SessionStore reads it before
Sine's window script runs. Turning the option/mod off or removing the module
restores originals after the final regular-window owner releases them, unless
the current value was externally changed. Same-turn hot reload reacquires
ownership before restoration. Private windows never acquire ownership.

The browser's selected tab and active Split View may restore independently of
on-demand preferences. Native session exclusion/clearing, containers, site
authentication, memory-pressure unloading and browser restore settings still
apply. Native session restore handles history, scroll and form state; restarting
does not preserve page RAM, live JavaScript execution or arbitrary unsaved
application data. This is clean-session restart support, not a guarantee of
crash durability or a way to recover a deleted session.

## Lifecycle

- Do not overwrite previous loaded intent with startup's temporary pending state.
- Busy/ready window events pause tracking while native state is being replaced.
- Completion records loaded state; explicit discard records unloaded state and
  cancels any queued restoration intention.
- A failed/timed-out startup reload retains its saved intention for a later
  restart without automatically retrying in a loop.
- Closed tabs are dropped from queues. Preference changes, removal and quit
  cancel timers and callbacks. Normal quit snapshots current flags before
  teardown while retaining intentions for unfinished startup restores.
- Combine this option with **Always show loaded tabs in collapsed folders** to
  show restored loaded rows throughout the sidebar.

## Sources checked

- [Firefox SessionStore API](https://firefox-source-docs.mozilla.org/browser/components/sessionstore/docs/api.html):
  custom tab values and the all-windows-restored promise.
- [Firefox SessionStore source](https://github.com/mozilla-firefox/firefox/blob/main/browser/components/sessionstore/SessionStore.sys.mjs):
  restoring extData and the on-demand restore queue.
- [Firefox Tabbrowser source](https://github.com/mozilla-firefox/firefox/blob/main/browser/components/tabbrowser/Tabbrowser.sys.mjs):
  lazy-browser reload/SSTabRestoring handling.
- [Zen 1.23.4b session patches](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/browser/components/sessionstore/SessionStore-sys-mjs.patch):
  native folder/workspace restoration remains responsible for session layout.

## Verification

`node --check zen-safe-close.uc.js`

`node --test tests/*.test.cjs`

Session-memory tests execute the shipped module with simulated SessionStore,
tab identities, pending mutations, preferences, startup promise, events and
timers. Cases cover disabled/private behavior, startup gating, background
queueing, explicit discard, completion/errors/timeouts, policy backup across
restart, multiple windows, hot reload, disabling and teardown. An end-to-end
simulation records a session and feeds its markers into a new browser instance
with reordered tabs.

No actual Zen restart/SessionStore disk round-trip, page loading or cross-platform
integration has been verified here. Live acceptance on macOS and Windows:

1. Enable the option. Load a few pinned and ordinary tabs in three folders and
   different workspaces; unload others. Include two tabs with the same URL.
2. Quit Zen normally and start it again. Confirm the same tabs/folders return,
   remembered loaded tabs load in the background, sleeping tabs stay pending,
   no duplicate tabs appear and selected tab/workspace remain native.
3. With loaded-folder visibility enabled, confirm loaded rows reappear in every
   collapsed folder after restoring. Repeat two consecutive restarts.
4. During restore, unload a queued tab, close one, switch tabs and disable the
   option. Confirm queued actions do not override newer explicit discards.
5. Check multiple windows, a private window, PDF/system pages, offline/reload
   failures and a slow page. Verify no private markers or URL list are written
   by the mod.
6. Disable the option and confirm original startup/on-demand preferences return.
   Check Sine hot reload, full browser quit and removal, then a normal restart.

## Immediate row presentation (2.4.1)

Session memory exposes saved-loaded intent before page reload completion.
With loaded-folder visibility enabled, all remembered rows remain visible
while queued, loading or timed out; native pending flags are not falsified.
These rows are not treated as unloaded by the sepia/grayscale effect. Explicit
discard clears intent and hides its row immediately. Disabling memory returns
visibility to actual pending state.

This stabilizes the sidebar without making independent websites finish at the
same instant. The two-slot background queue is retained; page content, favicons
and network/authentication can still take different amounts of time.
Integration tests exercise both shipped modules together, not just isolated
URL/pending predicates. Real restart/network/rendering checks are still required.
