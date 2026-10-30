# Folder slash: cause, policy and verification

## Evidence

ZenArcMod 2.5.6 contains no slash pseudo-element, slash insertion or title rewriting.
The native Zen 1.23.4b implementation is responsible:

- [vertical-tabs.css](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/tabs/zen-tabs/vertical-tabs.css#L919): tabs without `zen-pinned-changed="true"` hide `.tab-reset-pin-button`.
- [Separator and hover](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/tabs/zen-tabs/vertical-tabs.css#L941): `.tab-reset-pin-button::after` draws an empty, narrow rectangle rotated by 15 degrees. It looks like a slash; it is not a literal slash in the title. Hover sets its opacity to zero.
- [ZenPinnedTabManager](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/tabs/ZenPinnedTabManager.mjs): `onLocationChange` compares the current top-level URL to `_zenPinnedInitialState.entry.url`, ignoring fragments. A difference calls `pinHasChangedUrl`; returning calls `resetPinChangedUrl`. Essentials are excluded, and Split View can store `had-zen-pinned-changed` instead.

This explains different markers on otherwise similar rows and changes after navigation,
redirects, reset, and hover. Pending/busy/selected are not direct native separator
conditions. Unloading, restoration and redirects can indirectly change URL state.
The Check Point/Intune/Ivanti diagnosis is inferred from the reported appearance:
the screenshot's DOM and saved/current URLs were not available for direct inspection.

## Intended behavior in this change

With ZenArcMod enabled and the sidebar expanded, every visible normal tab inside
a Zen folder has exactly one decorative slash before its title, including nested
folders and unpinned folder children. It is a structural marker, not a loaded,
selected, hover or changed-URL indicator. The slash stays during navigation,
restore, unloading and folder toggles. Hidden rows remain hidden.

The new slash is `.tab-label-container::before`. The native reset-button separator
is suppressed only for the same folder rows. The native button and
`zen-pinned-changed` attribute retain their original behavior: reset remains
available only when Zen offers it. No tab titles, saved URLs, click handlers,
folder visibility, animation or gesture code is changed.

Outside folders, Zen retains native URL-change semantics and hover behavior.
Essentials, empty placeholders, Glance/embedded tabs and the icon-only collapsed
sidebar do not get the structural slash. Turning the mod off or uninstalling it
restores native styles. Appearance-effects settings do not control the slash.

## Automated checks

- Existing Node regression suite, plus a generated-CSS policy check in
  `tests/visuals.test.cjs`.
- `tests/browser/folder-slash.cjs` runs the shipped visuals code in actual Firefox
  with a minimal HTML fixture modeling Zen's native selector and hover behavior.
  It first reproduces the native inconsistency, then checks 48 combinations across
  three densities (URL changed, pending, selected, busy), hover, nested folders,
  unpinned children, exclusions, reset click, collapsed folder, icon-only sidebar,
  moving a row out of a folder, disable and uninstall.
- CI runs Node checks and both Firefox rendering checks on Windows, macOS and Linux.
  Existing folder collapse/reversal tests remain enabled.
- Firefox fixtures do not replace live privileged Zen/XUL verification.

## Manual acceptance: Windows and Apple Silicon macOS

Use Zen 1.23.4b with only this mod enabled, then repeat with your usual theme:

1. In a folder named vr portals, use three pinned tabs with saved and changed URLs.
   All three must show one slash, whether loaded, sleeping, selected or not.
2. Navigate and follow a redirect, return to the saved URL, then unload/reload.
   The slash stays. For changed URLs the original reset control must still return
   to the saved page; hover must not remove the decorative slash.
3. Collapse/expand repeatedly with Always show loaded tabs both on and off.
   Check zero/one/multiple loaded children and nested folders. Hidden tabs must not
   become visible, rows must remain vertical and the slash must not flash/double.
4. Repeat Roomy/Cosy/Compact, light/dark, RTL and reduced motion. Check long titles,
   throbbers, audio icons, reset-button hover/sublabel and keyboard focus.
5. Confirm no added slash on Essentials, empty screen, Glance or tabs outside
   folders. Collapse the sidebar to icons: no added slash. Move a tab out/in.
6. Disable/uninstall and hot reload through Sine: native slash/reset behavior
   returns with no leftover styles. Verify gestures and pinned close/unload.

Do not report these live checks as passed without running them on each target.
