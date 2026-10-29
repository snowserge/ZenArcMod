# Collapse sleeping folders on startup (2.5.0)

**Configure → Folder visibility → Collapse folders without loaded tabs at
startup** (`zen-safe-close.collapseSleepingFoldersAtStartup`) defaults to true.

After native session restore and browser installation are ready, collapse each
expanded ordinary zen-folder without loaded descendants. A loaded descendant
is non-closing, not a zen-empty-tab placeholder, and either has no pending flag
or is remembered by session memory as awaiting background restore. Never expand
folders containing loaded tabs; retain their restored collapsed/expanded state.
Process nested folders inside out, excluding drag-image copies. Other workspace
containers are not changed.

The rule is separate from loaded-folder visibility and session-memory settings.
With memory off, only the actual pending state determines loadedness. With
memory on, it does not wait for website/network completion or mistakenly close
folders whose remembered tabs are still queued.

Each browser window has a one-shot token retained across Sine hot reloads.
It applies after module initialization/native restore once; a first installation
can therefore also apply it in the current window. Later manual folder changes,
late restore events or configuration changes do not keep reapplying it.
Disable/re-enable after it has been handled takes effect on the next window
startup. Trusted interaction with a folder while startup is pending protects
that branch and its ancestors from automatic collapse.

Programmatic startup changes are batched. Loaded-folder layout refreshes once
after the batch rather than anchoring every programmatic collapse as if it
were a clicked folder header. No tab is loaded, unloaded, selected or moved.
Native folder setters still handle collapse when custom visibility is off.

## Automated checks

`node --check zen-safe-close.uc.js`

`node --test tests/*.test.cjs`

The startup-rule tests execute the shipped module with simulated native session
readiness, folders, timers and events. They cover sleeping/empty/loaded folders,
remembered pending descendants, nested branches, placeholders, closing tabs,
native startup/busy gating, disabled settings, early manual input, one-shot
behavior, hot reload, custom layout off, batch rendering and teardown.

## Live acceptance

1. Leave three folders expanded: one with only unloaded tabs, one with a loaded
   tab, and one containing an empty/unloaded subfolder. Quit and restart Zen.
   The first and the empty nested branch should collapse; loaded branches retain
   their previous state.
2. Enable session memory and repeat with slow/offline remembered tabs. Those
   folders must not collapse just because their pages remain pending.
3. Manually expand a sleeping folder after startup, then restore/discard other
   tabs and reload the mod. The folder should stay open.
4. Disable the startup checkbox and restart; standard restored folder state
   should remain. Repeat with loaded-folder visibility off and in both OSes.
5. Check startup scroll position and verify no programmatic collapse leaves a
   held clicked-header anchor.

No real Zen startup, native rendering or cross-platform live result is claimed
by the simulated tests. These checks remain necessary after installing 2.5.0.
