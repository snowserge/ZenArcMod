# ZenArcMod

Sine JavaScript mod for Zen Browser. No Node.js is required to install or run it.

## Features

- Close ordinary tabs normally. Keep pinned tabs and discard their contents.
- Show Zen's existing native empty screen after closing a pinned tab, without creating a blank tab row.
- Preserve sidebar scroll and clear the address-bar focus on that empty screen.
- Hide the close X independently of the minus/unload button.
- Sepia or grayscale for unloaded pinned tabs, including pinned tabs inside folders.
- Configurable visual scope: pinned only by default; all tabs optionally.
- Live tab density: Roomy (native), Cosy (32px plus margins), Compact (28px).
- Supplemental right-button gestures on system and other restricted pages: Down = new tab; Down then Right = close.
- Live settings in Sine's Configure dialog, shared between windows.

## Install

1. Install Sine: https://github.com/CosmoCreeper/Sine
2. In Sine settings, enable JavaScript mods from unofficial sources.
3. Enter `snowserge/ZenArcMod` in the custom repository installation field and select Install.
4. Restart Zen once, then open Configure on the ZenArcMod card.

Keep `zen.urlbar.replace-newtab` enabled for the native empty-screen behavior.
Ordinary web-page gestures are provided by Gesturefy and configured separately in that extension.

## Migrate from the manually installed mod

1. Back up the existing `chrome/sine-mods/zen-safe-close` folder and `chrome/sine-mods/mods.json`.
2. Disable the existing ZenArcMod entry and restart Zen so its old hooks are removed.
3. Install this repository through Sine. It uses the same stable mod ID, `zen-safe-close`.
4. Restart Zen and confirm the card shows version 2.1.3 and a Configure button.
5. Enable updates for the mod in Sine. Existing `zen-safe-close.*` preferences remain in the browser profile.

Do not run an older AutoConfig/userChrome copy alongside the Sine mod.

## Settings

Settings are declared in `preferences.json`. They persist in Firefox preferences under `zen-safe-close.*`.
Checkboxes and dropdowns apply immediately; text fields apply when Sine commits the field value.
Roomy restores native tab dimensions. Density applies to ordinary and pinned tab rows, including folder children, but leaves Essentials tiles and folder headers at native dimensions.
Sepia's default scope remains pinned tabs only, independently of density.
Disabling pinned protection restores Zen's native close behavior.

## Compatibility and limits

- Uses privileged Zen and Firefox internals; browser updates may require adjustments.
- Zen 1.23.4b was the user's development environment. A complete cross-platform compatibility matrix has not been verified.
- Split View and Glance tabs are protected from removal but are not automatically discarded by this mod.
- If Zen's native empty screen is unavailable, the mod keeps the pinned tab and reports an error instead of creating an ordinary blank tab.
- A cancelled beforeunload prompt keeps the pinned tab loaded; it may already have switched to the empty screen.
- System-page gestures are a small supplement, not a complete Gesturefy replacement. They do not draw a gesture trail.
- Density can conflict with other mods that override tab layout. Test tab dragging and sidebar layout with your theme.
- Automated tests use simulated browser objects; actual rendering and native input need verification in Zen.

## Development

Runtime files are `theme.json`, `preferences.json`, and `zen-safe-close.uc.js`.
There is no build step or runtime dependency on Node.js.
Do not publish a complete browser profile, personal `mods.json`, backup files, cookies, or session data.

## License

MIT; see LICENSE.txt.
