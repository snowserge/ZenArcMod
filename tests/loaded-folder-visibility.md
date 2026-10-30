# Loaded tabs in all folders (2.3.0)

In Sine Configure, under **Folder visibility**, enable **Always show loaded tabs
in collapsed folders** (`zen-safe-close.showLoadedInFolders`). Default: false.
It works independently of appearance effects, their folder inclusion/scope and
the setting that treats unselected tabs as visually inactive.

With the option enabled:

- A collapsed folder shows every non-closing tab without `pending`; internal
  `zen-empty-tab` placeholders are excluded. Expanded folders show their usual
  contents. No tab is loaded, discarded or selected by this option.
- Loaded descendants remain visible through collapsed parent folders. Empty
  nested branches are hidden when inside a collapsed ancestor.
- Each collapsed ancestor's native `activeTabs` list is updated as well, so
  loaded rows satisfy Zen's `tab.visible` getter for keyboard navigation.
- `pending` mutations, restoring/discarding, closing, grouping, moving tabs,
  selecting and changing collapsed state refresh the layout.
- Selecting a tab in an entirely loaded folder preserves its collapsed state,
  rather than triggering Zen's automatic expansion.
- With 2.5.3, user toggles animate entering/leaving rows (180ms ease-in-out).
  Loaded rows retain their places as the intervening rows shrink/grow. Reduced
  motion and Zen's _dontAnimateFolder setting keep layout immediate. Native
  folder layout/animation entry points are delegated unchanged while off.
  Native visibility is recalculated
  from the current selection when the option is disabled; prior sticky
  visibility history is not recreated.

The mode manages ordinary zen-folder elements in the tab container. It does not
override the overall workspace pinned-section collapse toggle or workspace
switching. Split View wrappers remain visible if they contain a loaded member;
Split View unloading restrictions of the existing close handler still apply.

## Native source contract

Checked [Zen 1.23.4b folders](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/folders/ZenFolders.mjs)
and [its tab visibility getter](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/browser/components/tabbrowser/content/tab-js.patch).
The getter walks collapsed ancestors and requires membership in each ancestor's
`activeTabs`. Styling rows alone would therefore leave logical visibility wrong.
The option wraps the public folder layout methods instead of rewriting private
methods or changing actual tab selection/multiselection.

## Automated validation

`node --check zen-safe-close.uc.js`

`node --test tests/*.test.cjs`

The folder tests execute the shipped module with simulated DOM/native manager
objects. The simulated visibility getter follows the checked Zen contract.
Cases include three independent folders, nested folders, expanded/pending
rows, unload/restore, placeholders, closing/moved tabs, fully loaded folders,
Split View wrappers, preference changes, unavailable API at startup and cleanup.
Existing gesture and folder-density tests also run.

## Live checks still required

On macOS and Windows with Zen 1.23.4b or the user's current version:

1. Create favorites, vr portals and school, with loaded and unloaded tabs.
   Enable the option, select a tab in each in turn, then expand/collapse all
   three. Every loaded row must stay visible in every collapsed folder.
2. Add multiple nested levels. Collapse parents and children in both orders;
   unloaded rows should disappear under any collapsed ancestor. Loaded
   descendants must remain reachable by click and keyboard navigation.
3. Unload a visible pinned tab by gesture; check empty-screen landing and
   immediate row hiding. Restore it and check it reappears. Test last loaded
   child, all-unloaded folder, ordinary tab closing and cancelled beforeunload.
4. Move loaded/unloaded tabs between folders and outside folders. Check for
   stale hidden rows or active dots. Smoke-test tab dragging and Split View.
5. Repeat in Roomy, Cosy and Compact, with visuals disabled, different
   inactivity settings, another workspace, and rapid repeated folder toggles.
6. Toggle the option off/on and disable/re-enable the mod. Native visibility
   must return while off; folder collapsed/loading states must be preserved.
7. Install an update/hot reload and restart. Check no hidden markup, callbacks
   or native method wrappers remain after removal.

These are simulated-object regression tests, not live Gecko rendering or
native input verification. Actual folder spacing, drag behavior, browser update
compatibility and cross-platform integration remain to be checked in Zen.

## Initial scroll stability fix (2.3.1; superseded by 2.4.1)

Refresh reconciles existing visibility attributes in place. It no longer removes
container/start/hidden attributes from every managed node before re-adding them: 
that transient layout could reveal pending rows, shrink the scroll range or
change Gecko's scroll anchor while layout/animation reads force a flush.
Native scroll anchoring is excluded from the managed tab-list subtree.

On expand/collapse, the module snapshots scrollable header ancestors plus the
workspace/arrowscrollbox containers and preserves the visible header position
synchronously and for at most two animation frames. A newer toggle supersedes
the old snapshot. Wheel, touch, pointer/mouse down, key input, tab selection, blur,
workspace change, option disable or teardown cancels deferred correction. No
focus or scrollIntoView call is used. Native scroll limits can constrain exact
position preservation when collapsing content near the bottom of the sidebar.

Tests cover stable attributes, simulated scroll drift during cache invalidation,
deferred restoration, user-input cancellation, replacement, workspace changes
and teardown. Against 2.3.0, stable-attribute and position-preservation regression
cases fail. These simulations do not reproduce Gecko's rendering engine.

Live check: scroll the sidebar well below the top, expand/collapse a folder with
loaded and pending tabs several times, and confirm its header stays reachable.
Repeat for a nested folder, a header near the viewport bottom, each density,
workspace switching and immediate manual wheel/keyboard scrolling after a toggle.

## Asynchronous layout stabilization (2.4.1)

The two-frame correction was insufficient for deferred native scrolling and
background session restore. It was also cancelled by unrelated animateSelect/
animateUnload calls. Header anchoring now remains event-driven until newer
user input/context, instead of expiring after two frames. Scroll listeners
on the actual scrollers and ResizeObserver callbacks trigger a new pass when
late layout/scrolling occurs; there is no endless animation-frame polling.
Wheel/touch/pointer/key input, selection, blur, resizing, workspace changes and
teardown still cancel the held header. Other redraws preserve a currently
visible header for the duration of that redraw.

Actual workspace/arrowscrollbox shadow scrollers receive an owned inline
overflow-anchor override, restored on disable/removal. A document selector
cannot cross that shadow boundary. Position correction uses instant scrollTo,
so CSS smooth scrolling cannot defer it past the correction window. Disconnected
scrollers release their listeners/styles.

Unchanged row nodes are cleaned once on ownership acquisition, preserving native
indentation. Late inline opacity/height/min-height writes mark only that node
dirty for cleanup. Ordinary refreshes no longer repeatedly read/cancel every
row's animations or erase its indentation. Mode disable clears ownership caches.

Saved-loaded pending tabs count as visible while session memory restores them.
The session API is initialized before folder layout and publishes intent changes;
real pending attributes are not altered. Tests run session and folder modules
together on one simulated window, with twelve remembered rows in three folders,
queued loads, explicit discard, timeouts and seeded event interleavings.

Source review included Zen's
[workspace scrollbox](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/spaces/ZenSpace.mjs)
and Firefox's [arrowscrollbox implementation](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/content/widgets/arrowscrollbox.js),
which owns a shadow scrollbox and defers ensureElementIsVisible via RAF.

The late-scroll, unrelated-callback, shadow-scroller and indentation regression
cases fail against 2.4.0, as does immediate startup-row presentation. The test
geometry, native events and SessionStore remain simulated. A fresh attempt to
connect to the real Zen application timed out, so no live browser validation
is claimed. Manual follow-up should include slow/offline startup, expanding a
folder while other remembered tabs restore, delayed smooth scrolling, nested
folders, repeated toggles and immediate wheel/keyboard navigation on both OSes.

Diagnostics available in window.__zenSafeClose.status include folderLayout and
sessionMemory counters, with no tab titles or URLs.

## 2.5.3 toggle animation regression

With loaded-tab visibility on, the previous wrapper replaced all five native
animation entry points with render() and Promise.resolve(false). render()
switched unloaded rows directly between display:none and normal layout. This
made toggling jump even though the Windows initialization fix itself changed no
animation code.

The wrapper now measures affected rows before the render, then animates only
entering/leaving rows' height, vertical margins and opacity using WAAPI. A
temporary attribute keeps leaving rows and otherwise-hidden ancestor containers
paintable until they reach zero height; it is removed on finish, cancellation,
failure, disable and uninstall. Native activeTabs/pending/selection semantics
stay unchanged. Nested hidden branches animate once as a unit. A reversal reads
the current interpolated geometry before cancelling the old effect. Old promise
callbacks cannot clear newer animation ownership.

The temporary min-height:0 applies only to rows/containers carrying the motion
attribute. It is removed with that attribute, including on interruption; there
is no permanent positive outer-row minimum height or opacity override from the
earlier ARM regression. Styling effects still belong to .tab-stack.

ResizeObserver notifications caused by the transition do not trigger a full
folder render each frame. A settled refresh reconciles layout afterwards.
Explicit tab/restore/grouping events can still schedule reconciliation.
Session restoration and background discard/restore remain immediate.

Source comparison: current
[ZenFolders.mjs](https://github.com/zen-browser/desktop/blob/dev/src/zen/folders/ZenFolders.mjs)
uses height/opacity transitions with 180ms duration and ease-in-out for toggles.
This implementation preserves the mode's all-loaded visibility policy rather
than calling native selection-only animations.

Run node --test tests/folder-motion.test.cjs plus the complete node --test suite.
The WAAPI and geometry fixtures test transition ownership, rapid reversal,
nested branches, reduced motion, native animation disable, resize feedback,
moving tabs, animation failure and independent-folder cleanup. These fixtures
do not render Gecko.

Live acceptance still required on Windows and ARM macOS:
- With one selected loaded row, an unselected loaded row and several unloaded
  rows interleaved, repeatedly expand/collapse. Loaded rows should move smoothly
  as intervening rows shrink/grow, with no final jump or selection change.
- Reverse a toggle halfway through; click a different folder during a transition.
- Repeat for empty/all-unloaded, all-loaded, nested folders and Split View.
- Repeat Roomy/Cosy/Compact, opacity 1/0.4, reduced motion, and near the bottom of
  a scrolled sidebar. Wheel/keyboard input must interrupt anchoring.
- Disable the option or mod during a transition. Confirm no motion attributes or
  zero heights linger, and native animation works with the option off.

No live Windows/macOS rendering or perceived smoothness verification is claimed.
