# All-sleeping folder animation regression (2.5.6)

## Narrowed trigger and cause

The user reports the problem only with Always show loaded tabs in collapsed
folders enabled and a folder with no loaded/active rows. A folder with at least
one loaded row animates normally. On macOS, the affected rows appear squeezed
together beneath/beside the folder; reopening can look incomplete.

render() marks an all-sleeping collapsed folder's group container with HIDE.
animateLayout() temporarily adds MOTION to keep that container paintable.
The previous column-layout rule matched BOX:not(HIDE) only. The generic MOTION
rule restored display:flex but did not supply flex-direction. That hidden
container therefore fell back to the default flex-direction:row and squeezed
its child tabs horizontally. Containers with loaded children kept the original
column rule and did not enter this broken state.

Apply the same display:flex/flex-direction:column rule to BOX+MOTION as well.
Keep the logical HIDE marker until completion and remove only the temporary
motion marker. This is a two-selector CSS change; it does not introduce OS
detection, scale transforms, new row sizing, selection changes, native hooks or
another animation implementation.

## Verification

The existing Node suite covers ownership, cancellation, hot reload, logical
visibility, collapsed state and loaded/pending state.

A separate GitHub Actions job on macOS and Linux installs an isolated pinned Playwright version
and its Firefox build, then runs tests/browser/folder-layout.cjs. No browser
test dependency is required to install or run the mod.

That test executes the shipped folder module in an actual Firefox document:
- Restore the exact pre-fix CSS selector and reproduce row layout/narrow tabs.
- Test zero, one and two loaded rows plus six sleeping rows with the fixed rule.
- Pause transitions halfway through and assert column direction, full sidebar
  width, aligned left edges and strictly increasing row positions.
- Reverse collapse into expansion, finish it, and check all sleeping rows have
  full height and no hidden/motion markers.
- Repeat full collapse/reopen cycles and verify pending states stay unchanged.

The fixture uses real DOM, CSS and Web Animations, with a simulated Zen manager.
It is stronger than the previous numeric layout fixture, but is still not an
interactive ARM macOS Zen test. Headless Firefox CI does not verify the user\'s interactive compositor behavior,
complete theme/mod combination or native Zen chrome.

Manual acceptance on the user's Mac remains required: repeat the zero-loaded
case, then load one row and compare; repeat with two loaded rows and a fresh
restart. Check nested folders, Roomy/Cosy/Compact, quick reversal and hot update.
The separate report of missing rows with loaded tabs after restart is not
claimed independently reproduced; record it separately if it remains after
the container-layout correction.
