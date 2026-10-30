# Folder handoff during Sine updates (2.5.5)

## Source-level cause

The previous folder destroy() called restore(), which invoked native
animateCollapse/animateExpand before restoring method hooks. Sine awaits its
unload callback and executes the updated script immediately afterwards.
Native folder methods await their animation promises; animateCollapse can
subsequently set the group container's hidden attribute and queue margin relayout
after the replacement has already rendered its all-loaded layout.

The replacement observed pending/collapsed/style, but not hidden. It also did
not clear the group-start element's old animation/inline margin-top. These
late writes could survive installation and interfere with later toggles until
a browser restart rebuilt the folder tree.

Compared with current
[Sine manager](https://github.com/CosmoCreeper/Sine/blob/main/src/core/manager.sys.mjs)
triggerUnloadListener/rebuildMods and
[Zen folder methods](https://github.com/zen-browser/desktop/blob/dev/src/zen/folders/ZenFolders.mjs).
This explains a hot-reload-only path; perceived jumping on a live Windows
profile has not been reproduced in this environment.

## Changes

On folder-module destruction, cancel owned row effects, position guards,
observers and frame work, remove owned layout markers, and restore method hooks.
Defer native layout restoration one window-timer turn under a cancellable
per-window token. A replacement with the loaded-folder mode active cancels that
token before rendering, preventing the old generation from starting animations.
A disabled replacement leaves it alone so final native selected-tab visibility
is restored. Window unload skips native restoration.

During active layout, clean native group-start animations and margin-top only,
and observe hidden as well as style writes. This also reconciles late callbacks
from pre-2.5.5 copies during the first update. Preserve unrelated indentation,
actual folder collapsed flags, selection and tab loading state.

## Automated checks

Run node --check zen-safe-close.uc.js and node --test.
The tests execute the shipped folder module in a persistent VM window across
multiple generations and insert the microtask gap used by Sine's awaited unload.
Coverage includes repeated reloads, active row-transition interruption, no
outgoing native animation calls, final removal, a disabled replacement, window
unload, legacy hidden writes and group-start cleanup. The fixtures record native
calls and animation lifecycles; they do not render Gecko or run Sine itself.

## Manual acceptance still required

On Windows and macOS:
1. Use a selected loaded row, another loaded row, and interleaved sleeping rows.
   Include nested folders and a sidebar scrolled near its bottom.
2. Enable Always show loaded tabs in collapsed folders. Update 2.5.4 to 2.5.5
   through Sine without restarting. Toggle immediately and again after 1 second.
3. Reload the mod several times; interrupt an expanding/collapsing folder with
   a reload. Confirm there is no accumulated jump, duplicate motion or header
   movement, and that loaded rows stay reachable.
4. Test Roomy/Cosy/Compact and reduced motion.
5. Disable the option, disable the entire mod, and remove it in a disposable
   profile. Native selected-tab visibility must return after the handoff turn.
6. Repeat after restarting to compare hot-reload and clean-start behavior.

Version/theme/update date are advanced together to 2.5.5. No actual Windows or
macOS Sine update/rendering verification is claimed by the automated suite.
