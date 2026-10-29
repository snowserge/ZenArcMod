# ZenArcMod

Sine JavaScript mod for Zen Browser. No Node.js is required to install or run it.

## Features

- Close ordinary tabs normally. Keep pinned tabs and discard their contents.
- Show Zen's existing native empty screen after closing a pinned tab, without creating a blank tab row.
- Preserve sidebar scroll and clear the address-bar focus on that empty screen.
- Hide the close X independently of the minus/unload button.
- Sepia or grayscale for unloaded pinned tabs, including pinned tabs inside folders.
- Configurable visual scope: pinned only by default; all tabs optionally.
- Optional loaded-tab visibility: keep all loaded tabs visible in every collapsed folder, including nested folders, independently of the selected tab.
- Optional session memory: remember which existing tabs were loaded and resume those pages in the background after restart.
- Live tab density: Roomy (native), Cosy (32px plus margins), Compact (28px).
- Right-button gestures on all tab content, including websites, settings, system pages and PDFs: Down = new tab; Down then Right = close/unload.
- A teal mouse trail that grows with travelled distance, with configurable color and maximum width.
- Live settings in Sine's Configure dialog, shared between windows.

## Install

1. Install Sine: https://github.com/CosmoCreeper/Sine
2. In Sine settings, enable JavaScript mods from unofficial sources.
3. Enter `snowserge/ZenArcMod` in the custom repository installation field and select Install.
4. Restart Zen once, then open Configure on the ZenArcMod card.

Keep `zen.urlbar.replace-newtab` enabled for the native empty-screen behavior.
Disable Gesturefy (and any other mouse gesture extension) before enabling this mod's gestures, so one stroke runs one command. No extension is required.

## Migrate from the manually installed mod

1. Back up the existing `chrome/sine-mods/zen-safe-close` folder and `chrome/sine-mods/mods.json`.
2. Disable the existing ZenArcMod entry and restart Zen so its old hooks are removed.
3. Install this repository through Sine. It uses the same stable mod ID, `zen-safe-close`.
4. Restart Zen and confirm the card shows version 2.4.1 and a Configure button.
5. Enable updates for the mod in Sine. Existing `zen-safe-close.*` preferences remain in the browser profile.

Do not run an older AutoConfig/userChrome copy alongside the Sine mod.

## Settings

Settings are declared in `preferences.json`. They persist in Firefox preferences under `zen-safe-close.*`.
Checkboxes and dropdowns apply immediately; text fields apply when Sine commits the field value.
Roomy restores native tab dimensions. Density applies to ordinary and pinned tab rows, including folder children, but leaves Essentials tiles and folder headers at native dimensions.
Sepia's default scope remains pinned tabs only, independently of density.
Disabling pinned protection restores Zen's native close behavior.

Under **Folder visibility**, enable **Always show loaded tabs in collapsed folders**
to keep every loaded tab visible in all folders. It is off by default and applies
immediately. Collapsed folders hide unloaded tabs; expanded folders show their
normal contents. Restoring/unloading a tab updates its visibility automatically.
The option does not load or unload tabs. While enabled it uses immediate folder
layout rather than native collapse animations, and keeps folder collapsed flags
unchanged. Folder toggles preserve the clicked header position; wheel, keyboard
or pointer input immediately cancels the event-driven header anchoring. Turning the
option off restores native visibility based on current selection.
The overall workspace pinned-section toggle remains native. See
[folder visibility verification](tests/loaded-folder-visibility.md) for checks.

Under **Session restore**, enable **Remember loaded tabs across browser restarts**
(`zen-safe-close.rememberLoadedTabs`). It is off by default. Enabling it records
the current loaded/unloaded state, enables native previous-session startup and
on-demand tab restore, then reloads only previously loaded restored tabs on
subsequent launches. It does not create duplicate tabs or change selection.
The policy applies to pinned and ordinary tabs and is independent of folder
visibility. Enable **Always show loaded tabs in collapsed folders** as well if
you want all remembered rows visible together while pages restore in the background.
Their visibility no longer waits for their turn in the network restore queue.
Turning session memory off restores the saved startup/restore preferences
(unless externally changed) and removes markers on open tabs. Private windows
are excluded. Pages load again; this does not preserve their live JavaScript
heap or guarantee unsaved application data. See [session-memory verification](tests/session-memory.md).

## Compatibility and limits

- Uses privileged Zen and Firefox internals; browser updates may require adjustments.
- Zen 1.23.4b was the user's development environment. A complete cross-platform compatibility matrix has not been verified.
- Split View and Glance tabs are protected from removal but are not automatically discarded by this mod.
- If Zen's native empty screen is unavailable, the mod keeps the pinned tab and reports an error instead of creating an ordinary blank tab.
- A cancelled beforeunload prompt keeps the pinned tab loaded; it may already have switched to the empty screen.
- Gestures start over the active tab content, including the native empty screen, not the toolbar or tab sidebar. Only the two configured commands are supported. Native dialogs, other application windows and detached picture-in-picture windows are outside this scope.
- While gestures are enabled, the mod defers right-click menus until mouse-up on macOS/Linux; Windows already does this. The previous preference is restored when the last participating browser window disables/unloads the module.
- Disable Gesturefy first. Keeping both enabled can execute duplicate commands.
- Native remote-frame event routing, PDF viewers, fullscreen, mixed-DPI displays and OS context menus still require the live checks in [gesture verification](tests/gesture-verification.md).
- Density can conflict with other mods that override tab layout. Test tab dragging and sidebar layout with your theme.
- Automated tests use simulated browser objects; actual rendering and native input need verification in Zen.

## Development

Runtime files are `theme.json`, `preferences.json`, and `zen-safe-close.uc.js`.
There is no build step or runtime dependency on Node.js.
For development checks, run `node --check zen-safe-close.uc.js` and
`node --test tests/*.test.cjs` (Node.js 18+).
These tests execute the visual, folder, session and gesture modules with simulated browser objects.
They cover CSS ownership, recognition, tab commands, cancellation, trail drawing
and cleanup; they do not test Gecko rendering or native input.
See [folder regression notes](tests/folder-regression.md) for the cause, upstream
references, and manual browser checks.
Do not publish a complete browser profile, personal `mods.json`, backup files, cookies, or session data.

## License

MIT; see LICENSE.txt.


For releases, advance both `version` and the explicit UTC `updatedAt` in
`theme.json`; Sine detects updates by date. Keep the script version in sync.
