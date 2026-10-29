# Active-folder collapse regression

## Cause and scope

The reported screenshots show the folder icon changing to its collapsed state
while the selected row and inactive rows remain visible. This is consistent
with a CSS conflict, not evidence of a missed click or an ARM-specific API bug.

Zen uses two collapse paths. With no selected/active rows it can shift and hide
the entire container. With a selected/active row it keeps the container visible
and animates the other rows' opacity and height to zero. It leaves the resulting
values as normal inline styles, and restores them on expansion.

Before 2.1.4, the mod assigned opacity (1 by default) with `!important` directly
to inactive tab rows. This defeats Zen's opacity animation and final inline
opacity. Cosy/Compact also forced a positive row min-height with `!important`,
preventing rows from shrinking even when Zen sets their height to zero.
This explains why having an active tab exposes the conflict. During the
investigation the user confirmed that switching to Compact triggers it on
other platforms too, consistent with the forced minimum height rather than
an ARM-specific issue.

The fix applies filter/opacity to the direct child `.tab-stack`, leaving
the outer tab under Zen's animation control. Density still uses the existing
tab variables and background sizing, but no longer forces the outer min-height.
No folder handlers, close/unload hooks or platform detection are changed.

## Sources checked

- [Zen 1.23.4b folder implementation](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/folders/ZenFolders.mjs):
  `animateCollapse`, `animateExpand`, `#animateItem`.
- [Current development implementation inspected](https://github.com/zen-browser/desktop/blob/f75390aa2b797ddc3524ff9ed52ceb32a839f9fa/src/zen/folders/ZenFolders.mjs):
  same row opacity/height contract. This is a source comparison, not a
  claim of runtime testing against that build.
- [Firefox/MDN CSS cascade](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/important):
  important declarations override animations and normal inline styles.

## Automated checks

`node --test tests/visuals.test.cjs` executes the shipped visual module and checks
all three density modes with both inactivity settings, preference changes,
folder inclusion, scope and cleanup. The six animation-contract cases fail
against 2.1.3 and pass against 2.1.4. These are CSS ownership and simulated
browser-object tests, not a layout engine or end-to-end reproduction.
A separate density test with visuals disabled also fails against 2.1.3,
isolating the minimum-height conflict from opacity.

## Manual verification in Zen

Use a disposable profile with Sine and only this mod enabled initially.

1. Create a favorites folder with a selected pinned tab and several unloaded
   pinned tabs, matching the reported screenshots. Keep visuals enabled,
   includeFolders enabled, and opacity at 1.
2. Collapse and expand repeatedly. The selected row should stay visible when
   collapsed; the other rows should disappear and return on expansion.
   The folder icon should agree with the layout.
3. Repeat with Roomy, Cosy and Compact, then with opacity 0.4, grayscale,
   both inactivity modes and a loaded but unselected sibling.
4. Select a tab outside the folder and repeat (no active child). Also test a
   nested folder, a folder with all tabs unloaded, and rapid repeated toggles.
5. Disable visuals, exclude folders, and disable/re-enable the mod. Check
   ordinary tab density, Essentials, folder headers and tab dragging.
6. Smoke-test pinned close/unload to the empty screen and ordinary tab closing.
7. Repeat with the user's other mods/theme, and on Windows/Linux when available.

Record Zen version, architecture, density, inactivity mode and other mods if
anything fails. Compare with the mod disabled to distinguish native behavior.

## Verification limits for this change

The available host reports arm64 and has Zen 1.23.4b installed. An attempt to
launch a separate headless Zen with a disposable profile exited at startup
(exit 134), before browser automation connected. Thus no live Zen folder
interaction, Sine reload, native input, screenshot comparison or cross-platform
rendering check is claimed. The existing browser profile was not modified.
