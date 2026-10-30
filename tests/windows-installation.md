# Windows installation and diagnosis (2.5.2)

## Install/update

1. In Zen, open Help > About Zen and record the version; use a disposable profile
   for acceptance testing. Locate the actual profile via about:support > Profile
   Folder > Open Folder, rather than assuming an AppData path.
2. Install [Sine](https://github.com/CosmoCreeper/Sine) following its current
   installer instructions. Enable JavaScript mods from unofficial sources.
3. Install `snowserge/ZenArcMod` through Sine's custom repository field. Enable
   mod updates and restart **all** Zen windows. Check the card reports 2.5.2.
   Before this PR is merged/released, the default repository install still
   supplies main; test the PR script in a disposable profile's existing
   `chrome/sine-mods/zen-safe-close/zen-safe-close.uc.js` after closing Zen.
   Keep a backup outside that folder and do not let Sine auto-update the test copy.
4. Remove/disable old AutoConfig or userChrome copies and other gesture mods.
   Disable Gesturefy. Do not install a second copy of this script.
5. In Configure, enable gestures and **Always show loaded tabs in collapsed
   folders** (the latter is off by default). Keep
   `zen.urlbar.replace-newtab` enabled. Node.js is needed only for development tests.

## Cause and upstream API comparison

Firefox's [nsAppShellService.cpp](https://github.com/mozilla-firefox/firefox/blob/main/xpfe/appshell/nsAppShellService.cpp)
creates its hidden window under XP_MACOSX only; GetHiddenDOMWindow fails when
that window does not exist. The old script read
`Services.appShell.hiddenDOMWindow` outside a try/catch in native sync, session
memory and gestures. On Windows that first exception aborts the rest of this
single script, including the folder and gesture modules. This is a source-level
cause; it has not been reproduced in an interactive Windows Zen session here.

Ownership now uses a shared bag discovered through
`Services.wm.getEnumerator("navigator:browser")`. Every participating window
keeps a reference, including across same-window hot reloads. Session policy
cleanup uses Firefox's Timer.sys.mjs module timers, so it survives the releasing
window closing. No OS sniffing or per-window preference backup is introduced.

Compared against Zen dev commit
[46eb9b9ac6de8195f1842add3e2381977f66f703](https://github.com/zen-browser/desktop/tree/46eb9b9ac6de8195f1842add3e2381977f66f703):
[ZenFolders.mjs](https://github.com/zen-browser/desktop/blob/46eb9b9ac6de8195f1842add3e2381977f66f703/src/zen/folders/ZenFolders.mjs)
still provides animateCollapse/Expand/Select/Unload/UnloadAll, and ZenFolder.mjs
still provides activeTabs, groupContainer and groupStartElement. No missing-method
Windows workaround is justified. The existing hooks and collapsed flags are kept.

Current [Firefox Tabbrowser.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/main/browser/components/tabbrowser/Tabbrowser.sys.mjs)
still provides runBeforeUnloadForTabs, prepareDiscardBrowser and
discardBrowser(tab, { forceDiscard, renderDiscarded }). The existing
object/legacy signature adapter is retained. Gesture DR uses closePinned for
protected pins and native removeTab for ordinary tabs.

The previous [active-folder regression fix](folder-regression.md) is retained:
visual opacity/filter belong to the child .tab-stack; outer row height/opacity
remain available to Zen's animation. This change adds no row min-height override.

## Diagnose in the Browser Console

Enable browser chrome debugging in Developer Tools settings if needed, then
open the **Browser Console** (Ctrl+Shift+J), not a website's Web Console.
Select the main browser window's execution context. Run:

```js
({
  main: window.__zenSafeClose?.status,
  gestures: window.__zenSafeCloseGestures?.status,
  folders: window.__zenSafeCloseLoadedFolders?.status
})
```

Expected: main.version is 2.5.2, main.installed is true, gestures.enabled is true,
and folders.active is true when its option is enabled. Missing globals usually
mean the script did not load or stopped early; inspect the first exception,
especially older hiddenDOMWindow/NS_ERROR_FAILURE errors or "Another copy is
active". Confirm the installed script, restart all windows and retry with other
mods disabled. If main.configErrors is nonempty, correct the gesture strings.

If gesture status exists but there is no trail/command, record the page type,
whether right-click still works, enabled gesture settings and console errors.
Do not assume the hidden-window fix resolves every native input-routing issue.

## Manual acceptance (pending)

- Right-button Down creates one tab; Down then Right closes an ordinary tab.
  DR on a protected pin unloads it to the native empty screen and keeps the pin.
  Plain right-click and small jitter preserve the native menu; Escape, blur,
  tab switch and releasing outside the window cancel a stroke.
- Repeat on HTTPS, about:preferences, about:config, PDF, file and extension pages.
  Check mixed-DPI displays, fullscreen and a second Zen window.
- With the folder option on, create multiple collapsed folders and a nested one
  with loaded/unloaded tabs. Loaded rows remain visible independent of selection;
  unloaded rows hide. Discard/restore changes only the relevant rows.
- With one selected child, repeatedly expand/collapse in Roomy, Cosy and Compact.
  Repeat with the option off, opacity 1 and 0.4, and on ARM macOS. Header icon and
  layout must agree; selection and pending state must not change.
- Disable/re-enable the option and mod. Open two windows, close the first, open
  a third, and repeat gestures and folder checks. Disable the final gesture
  owner and confirm the previous ui.context_menus.after_mouseup value returns.
- Repeat with the normal theme/mod set only after the isolated profile passes.

Record OS/architecture, Zen/Sine/mod versions, density, settings, first console
error and minimal steps. Redact page URLs, profile paths and account information.
Never upload a complete profile or session files.

## Automated checks and limits

Run `node --check zen-safe-close.uc.js` and `node --test` with Node 18+.
The workflow runs the same suite on Windows, macOS and Linux with Node 22.
Fixtures make hiddenDOMWindow throw, exercise shared ownership/cleanup,
session policy, gestures and folder toggling with an active child.

These are simulated browser-object tests. A Windows CI pass does **not** verify
Zen rendering, native mouse events, Sine installation, mixed-DPI behavior or
beforeunload dialogs. No interactive Windows Zen or ARM macOS acceptance run is
claimed for this change.
