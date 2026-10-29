# All-page gestures (2.2.0)

Hold the right mouse button over the active tab content. Down opens a new tab
using Zen's native new-tab command; Down then Right closes an ordinary tab or
passes a protected pinned tab to the existing unload/empty-screen handler.
The native empty screen can open a tab, but closing that screen is a no-op.
Configured directions and distance thresholds remain available in Sine.

The HTML canvas is attached to browser chrome, clipped to the tab panel and
ignores pointer input. Its backing resolution uses devicePixelRatio; points
use screen coordinates converted into window CSS coordinates. A filled teal
ribbon grows by travelled distance up to the configured width, independent
of mouse-event frequency. Sampling queues are bounded and paint once per
animation frame. Rendering failures leave command recognition operational.
No Gesturefy code is included.

## Implementation references

- [Gesturefy's feature description](https://github.com/Robbendebiene/Gesturefy#features)
  and the supplied photo informed the growing-trail behavior.
- [Firefox's context-menu preference](https://github.com/mozilla-firefox/firefox/blob/main/modules/libpref/init/StaticPrefList.yaml)
  documents `ui.context_menus.after_mouseup`: macOS/Linux need deferred menus;
  Windows always uses mouse-up. The mod shares ownership across browser
  windows, saves/restores the previous user preference, and respects a newer
  external change on release.
- [Privileged browser-chrome mouse-gesture example](https://github.com/xiaoxiaoflood/firefox-scripts/blob/master/chrome/mouseGestures.uc.js)
  confirms the use of chrome input listeners and the mouse-up context-menu
  setting. Page-element commands in that project need an actor; our two tab
  commands use the existing parent-process APIs.

## Automated verification

`node --check zen-safe-close.uc.js`

`node --test tests/*.test.cjs`

Gesture tests execute the shipped module with simulated browser input,
preferences, timers, canvas and tab commands. URL cases check the absence of
the former restricted-page gate; they do not emulate remote browser processes.
Tests cover pinned/ordinary/empty-screen routing, invalid strokes, jitter,
ordinary right-click menus, cancellation, untrusted/modified input,
navigation before command execution, growing/capped trail width, Retina
backing dimensions, preference ownership across windows and cleanup.

## Live acceptance checks (macOS and Windows; Linux when available)

1. Disable Gesturefy and other gesture extensions first. Install 2.2.0 and
   restart Zen. Keep only ZenArcMod enabled for the initial check.
2. On HTTPS, settings/about:preferences, about:config, about:addons, the new-tab
   screen, a PDF, a local file, a restricted Mozilla page, and extension options,
   try D and DR. Test both pinned and unpinned tabs where applicable.
3. Try cross-origin embedded frames, crossing frame boundaries mid-stroke,
   an editable field, a page with context-menu handlers and browser fullscreen.
   Check that each stroke executes once. Page handlers must not steal it.
4. Confirm native blank-screen landing after pinned unload, ordinary closing,
   and no accidental window close from the native empty screen.
5. Compare the trail with the reference: thin beginning, smooth round corner,
   wider head. Test fast/slow strokes, multiple page zoom levels, Retina,
   Windows display scaling and moving Zen between monitors.
6. A stationary right-click or sub-threshold jitter should open the normal
   context menu. A gesture should not. Ctrl/Alt/Meta/Shift and multiple buttons
   should not run commands. DL should not execute its D prefix.
7. Escape, tab selection, page navigation, lost mouse buttons, leaving the
   window, blur and resize must cancel without a stray command or canvas.
8. Open two browser windows. Disable gestures in one/configure shared prefs,
   close windows, disable/re-enable the mod and verify the menu preference
   returns to its previous state when the final owner releases it.
9. Turn the trail off; both commands should still work. Change its color/width
   and gesture mappings. Test a Sine hot reload and a complete restart.

The preview PNG was rendered with the actual trail drawing code through a
Canvas 2D adapter, not captured from Zen. No live Gecko/native input results
are claimed: the earlier disposable headless Zen failed at startup on this
host. A native-input check on each platform remains necessary before treating
the complete browser integration as verified.
