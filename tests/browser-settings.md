# Browser settings (2.5.4)

In Sine Configure:
- Sync intervals (seconds): Use custom browser sync intervals (default on).
- Active / Idle / Accelerated follow-up: 120 / 600 / 90 seconds initially.
- Folder visibility: Show folder tab search popup on hover (default off).

The interval fields are independent and editable. Supported range: integer
seconds from 60 through 86400. Fractions are rounded, out-of-range numbers are
clamped, invalid/empty input falls back to the relevant initial value.
Sine applies text fields when their edited value is committed.

The module writes these native preferences:
- services.sync.scheduler.activeInterval
- services.sync.scheduler.idleInterval
- services.sync.scheduler.immediateInterval
- zen.folders.search.enabled

The five mod control prefs (manageSyncIntervals, syncActiveInterval,
syncIdleInterval, syncImmediateInterval, folderPopup) are enrolled individually
with services.sync.prefs.sync.zen-safe-close.*. Both devices must have the mod
installed and Settings synchronization enabled. Sending these controls does
not install the mod or enable Sync/sign the user in on another device.
Native scheduler pref names and backup data are not enrolled in Sync.

## Ownership and native integration

Original user/default values and the last applied values are saved in
zen-safe-close-internal.browserSettings.v1 before native preferences change.
Release restores a value only if it still matches the module's last applied
value. Unknown or corrupt backup data fails before any native preference write
and is retained for diagnosis.

All browser windows share one ownership bag and backup. Closing one window
does not release another's policy. Final disable/uninstall restores preferences
on the next module-timer turn, allowing Sine hot reload to reacquire ownership.
Normal shutdown preserves settings for native Sync's early next-startup policy.
Private windows use the same process/profile policy; no browsing data is read.

If Sync is not ready, the module writes preferences and waits for the native
weave:service:ready notification, without forcing the Sync service to load.
Once ready it updates the three cached scheduler interval properties in
milliseconds, calls adjustSyncInterval(), then checkSyncStatus(). It does not
reset scheduler idle state, incoming-items state, scores or backoff, call sync()
directly, or reset native scheduling defaults.

The preference control names are in seconds; the runtime scheduler cache is in
milliseconds. Single-device scheduling, tab quick-write, triggered sync, offline
handling and server backoff remain native. A chosen interval is not a guarantee
of end-to-end delivery time to a second computer.

Sources checked:
- [Firefox Sync defaults](https://github.com/mozilla-firefox/firefox/blob/main/modules/libpref/init/all.js)
- [Sync scheduler](https://github.com/mozilla-firefox/firefox/blob/main/services/sync/modules/policies.sys.mjs)
- [Sync readiness API](https://github.com/mozilla-firefox/firefox/blob/main/services/sync/Weave.sys.mjs)
- [Preference synchronization controls](https://github.com/mozilla-firefox/firefox/blob/main/browser/app/profile/firefox.js)
- [Zen folder popup preference](https://github.com/zen-browser/desktop/blob/dev/prefs/zen/folders.yaml)

## Verification

Run node --check zen-safe-close.uc.js and node --test.
tests/browser-settings.test.cjs executes the shipped module and core config
parser against simulated preferences, windows, observers, timers and scheduler.
Coverage includes custom values, bounds/rounding/invalid input, ready/late Sync,
no forced Sync loading, live cache refresh without idle reset, independent
popup control, multi-window ownership, hot reload, shutdown/restart, external
changes, corrupt backup, disable/uninstall and Sine field defaults.

Live acceptance required on Windows and macOS:
1. Update to 2.5.4. Check Configure contains all fields and the popup switch.
2. Change each interval, commit the field, and inspect the corresponding native
   about:config value. Verify the runtime values through
   window.__zenSafeClose.status.browserSettings in the Browser Console.
3. Enable the popup, hover a collapsed folder, then turn it off while open.
   It should close and stay closed on hover; folder toggles must still work.
4. On two devices with Settings sync on and the mod installed, change each
   control on one device, sync both and confirm Configure/native values on the
   other. Repeat in the opposite direction.
5. Record original native values. Disable interval management: only interval
   values should restore. Disable the whole mod: popup and allowlist should also
   restore. Test with two windows and a Sine reload.
6. Restart with custom intervals enabled; ensure defaults remain consistent
   before/after Sync readiness. Test with Sync signed out.

No live two-device delivery, Sine Configure UI, native popup or Windows/macOS
scheduler verification is claimed by the simulated tests.
