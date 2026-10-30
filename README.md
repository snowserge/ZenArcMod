# ZenArcMod

Sine JavaScript mod for Zen Browser. No Node.js is required to install or run it.

## Features

- Close ordinary tabs normally. Keep pinned tabs and discard their contents.
- Allow Zen's native sync to remove stale pinned copies when a tab is unpinned or deleted elsewhere.
- Show Zen's existing native empty screen after closing a pinned tab, without creating a blank tab row.
- Preserve sidebar scroll and clear the address-bar focus on that empty screen.
- Hide the close X independently of the minus/unload button.
- Sepia or grayscale for unloaded pinned tabs, including pinned tabs inside folders.
- Configurable visual scope: pinned only by default; all tabs optionally.
- Optional loaded-tab visibility: keep all loaded tabs visible in every collapsed folder, including nested folders, independently of the selected tab.
- At startup, collapse folders without loaded tabs (configurable, enabled by default).
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

For Windows installation, diagnostics and the manual acceptance checklist, see
[Windows guide](tests/windows-installation.md). Version 2.5.2 removes a macOS-only
hidden-window dependency that could stop initialization before folder visibility
and gestures were registered.

## Migrate from the manually installed mod

1. Back up the existing `chrome/sine-mods/zen-safe-close` folder and `chrome/sine-mods/mods.json`.
2. Disable the existing ZenArcMod entry and restart Zen so its old hooks are removed.
3. Install this repository through Sine. It uses the same stable mod ID, `zen-safe-close`.
4. Restart Zen and confirm the card shows version 2.5.6 and a Configure button.
5. Enable updates for the mod in Sine. Existing `zen-safe-close.*` preferences remain in the browser profile.

Do not run an older AutoConfig/userChrome copy alongside the Sine mod.

## Settings

Settings are declared in `preferences.json`. They persist in Firefox preferences under `zen-safe-close.*`.
Checkboxes and dropdowns apply immediately; text fields apply when Sine commits the field value.
Roomy restores native tab dimensions. Density applies to ordinary and pinned tab rows, including folder children, but leaves Essentials tiles and folder headers at native dimensions.
Sepia's default scope remains pinned tabs only, independently of density.
Disabling pinned protection restores Zen's native close behavior.
There is no built-in list of personal tabs or URLs, and the mod never pins tabs.
Session memory marks existing tabs as loaded/unloaded; it does not recreate or
re-pin them. Version 2.5.1 corrects a close-protection conflict with native sync:
Zen's explicit removal of a matching tab copy now bypasses pinned protection.
Other pinned tabs remain protected while sync is running. Update the mod on
every computer, restart Zen, then repeat Unpin and sync. This allows subsequent
native removals; it does not rewrite remote sync data or guarantee automatic
cleanup of already-stale copies. See [native sync verification](tests/native-sync.md).

Under **Folder visibility**, enable **Always show loaded tabs in collapsed folders**
to keep every loaded tab visible in all folders. It is off by default and applies
immediately. Collapsed folders hide unloaded tabs; expanded folders show their
normal contents. Restoring/unloading a tab updates its visibility automatically.
The option does not load or unload tabs. Folder toggles animate entering/leaving
rows over 180ms while keeping loaded tabs visible and collapsed flags unchanged.
Rapid toggles continue from the current visual height. Reduced-motion and Zen's
animation-disable setting use immediate layout. Folder toggles preserve the
clicked header position; wheel, keyboard or pointer input cancels header anchoring.
Turning the option off restores native visibility based on current selection.
**Collapse folders without loaded tabs at startup** is enabled by default.
After native session restoration it collapses folders containing only sleeping
tabs or placeholders, including empty nested branches. Remembered tabs queued
for restoration count as loaded, so their folders retain their previous state.
This is a one-shot startup rule; manually reopened folders stay open afterwards.
Disabling the checkbox restores native behavior on the next startup. See
[startup-folder verification](tests/startup-folders.md).

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

Under **Sync intervals (seconds)**, **Use custom browser sync intervals** is on by
default. Active = 120, idle = 600 and accelerated follow-up = 90 seconds.
Each field accepts a custom value from 60 to 86400 seconds; fractional values
are rounded and invalid/empty fields use the documented default. Changes apply
to the running native scheduler when Sync is ready, without restarting Zen.
This adjusts background scheduling; native change-triggered sync, server backoff,
account/offline checks and the single-device policy remain native.

Under **Folder visibility**, **Show folder tab search popup on hover** controls
`zen.folders.search.enabled`. It is off by default. Turning it off also closes
an existing hover popup; it does not affect folder expansion or loaded-tab
visibility.

These five mod controls are included in Firefox's preference-sync allowlist.
With Settings sync enabled and ZenArcMod installed on both computers, custom
intervals, their enable switch and the popup choice can travel between them.
Native scheduler preferences themselves are not added to that allowlist.
Each profile independently backs up its previous native values. Disabling
custom intervals restores only the three scheduler preferences; disabling or
uninstalling the mod also restores its previous popup and allowlist values,
while preserving newer external changes. Backups survive browser shutdown and
same-turn Sine hot reloads. See [browser-settings verification](tests/browser-settings.md).

Version 2.5.5 fixes folder-layout handoff during Sine updates without restarting
Zen: the outgoing copy cancels its own effects and defers native restoration.
An active replacement takes ownership before native animations start. Actual
disable/removal still restores native layout. Late hidden/margin writes from an
older copy are reconciled by the replacement. See
[hot-reload regression checks](tests/folder-reload.md).

Version 2.5.6 keeps the animation container vertical when a collapsed folder has
no loaded tabs. Previously that temporary flex container could use the default
row direction, squeezing sleeping tabs side by side. A real Firefox layout check
now reproduces the old rule and verifies collapse, rapid reversal and reopening
with zero, one and two loaded tabs. See
[empty-folder animation checks](tests/empty-folder-animation.md).

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
These tests execute close protection and the visual, folder, session, sync and gesture modules with simulated browser objects.
They cover CSS ownership, recognition, tab commands, cancellation, trail drawing
and cleanup; they do not test Gecko rendering or native input.
See [folder regression notes](tests/folder-regression.md) for the cause, upstream
references, and manual browser checks.
Do not publish a complete browser profile, personal `mods.json`, backup files, cookies, or session data.

## License

MIT; see LICENSE.txt.


For releases, advance both `version` and the explicit UTC `updatedAt` in
`theme.json`; Sine detects updates by date. Keep the script version in sync.
