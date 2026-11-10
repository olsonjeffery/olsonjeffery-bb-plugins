# Spools mobile vs desktop — viewport gap analysis (2026-11-10)

**What this is.** A code-level, viewport-based assessment of the Spools
sidebar's compact-viewport (mobile) presentation against its own desktop
presentation and against the host's responsive behavior. The host: bb ≤
`767px` runs the sidebar as a **drawer** with bottom-sheet dialogs and
responsive menus (see the builtin `thread-list` app and the shared
`presentation === "drawer"` plumbing), and defines touch type tokens
(`--bb-sidebar-row-height: 1.75rem; --bb-sidebar-row-height-coarse: 2.5rem`).
The list slot hands the plugin two signals — `isCompactViewport` and
`onNavigate()` ("closes the mobile drawer — call after opening a thread").

**Biggest gap first, then everything else.** Items fixed in 0.13.0 are
marked ✅; the rest are the backlog.

## Issues

1. **Menus are desktop popovers on mobile (behavior).** Thread ⋯, spool
   ⋯, group ⋯ and View menus all render as `position: fixed` popups anchored
   at coordinates (`SpoolerMenu`, `spooler-view-menu`): 248px-wide sheet,
   ~28px rows, clamped horizontally only. The host turns every dropdown
   into a bottom **sheet on compact viewports**, with 44px rows, a
   backdrop, Escape/dismiss, `--bb-drawer-keyboard-inset` handling and
   bottom safe-area padding. Also: the View menu closes on outside
   pointer-down only, no screen-reader drawer semantics, and a
   right-half-screen open still blocks the scroller. **Priority: high.**
   Fix shape: a `compact` variant of `SpoolerMenu` rendering an
   `aria-modal` bottom sheet (backdrop + slide-up + safe-area) fed by the
   same `items`, for every menu call site when `isCompactViewport`.
2. **Sticky hover paints everywhere (display).** ✅ 0.13.0 — every
   `:hover` tube/wash on rows, headers, chips, segmented controls and row
   chrome stuck to the last-tapped row until the next tap; bb gates hover
   under `(hover: hover)`. The header's **+ new thread** appeared only on
   hover, so touch never reached it. Fixed via an `(hover: none)` offset
   block; the row tube switch runs through `--spooler-row-hover-bg`.
3. **Touch hit targets under the host scale (display).** ✅ 0.13.0 for the
   persistent header chrome: the filter input now runs 16px ink on coarse
   pointers (stops the iOS focus zoom-jump), 34px search row, 30px
   chips/segmented controls, larger ⋯ chrome. Row internals keep desktop
   metrics (rows already ride the full-height tube; content-visibility
   estimates depend on them).
4. **Details facts were hover-tooltips only (behavior).** ✅ partially —
   the panel now carries `Activity` (the full relative time), which the
   sub-head's short time previously carried only as a hover tooltip that
   touch cannot read. Still tooltip-only: the provider name
   (`Provider: …`) and the PR chip's full title context. Neither is
   fatal (the chip's own state words stay visible), lower priority.
5. **isCompactViewport only drives density (gap).** ✅ expanded — today
   the prop only forces the compact density class. It should also feed
   the menu-space decisions (item 1) and possibly default the Active
   deck to folded on very short scrollports. Un-done parts stay here.
6. **Settings + custom modals are desktop-shaped (display).** The
   Section Settings modal and Unspool confirm are fixed-centered desktop
   dialogs (`.spooler-modal` 292px); the host's Dialog-`. drawer` halves
   do not apply to hand-rolled modals. At ≤767px they hover mid-screen
   above the list. Priority: medium (touches only appear from menus).
   Fix shape: bottom sheet at compact, host-metrics bless the recipe.
7. **The list header spends 3 rows before rows (display).** Expanded,
   the header is: search row (30px) + Row B (28px segmented) + chips row
   (22px+) + borders/padding — roughly 100px of chrome before any thread.
   Spools' own collapse affordance (the chevron) is the right tool and
   it's fine on touch — but consider auto-collapsing on `isCompactViewport`
   (2 lines: search + grouping) by default. Priority: low (user
   controllable) but real on 667-tall phones. Related: the sticky Active
   station consumes MORE top space in section grouping on mobile.
8. **No virtualisation (both viewports, worse on mobile).** Documented in
   the skill; thousands of rows scroll slowly on low-end phones.
   Priorities unchanged.
9. **Drag-to-reorder projects is desktop-first (behavior).** dnd-kit
   TouchSensor (250ms hold, 5px slop) works, but the drag preview
   (`spooler-group-drag-preview`) drops A11y entirely on touch and the
   reorder affordance is invisible (grip only on desktop hover). The
   menu's "Reset project order" is the touch fallback. Priority: low.
10. **The `Group by section` button's labels lie** ("drag a thread onto a
    header to file it") — dragging retired in 0.5.3; this is desktop
    metaphor chrome, harmless on touch but stale copy. Trivial fix.
11. **Press-and-hold + swipes already reach parity** — 450ms long-press
    opens the same context menu with click-suppression; swipe actions
    are per-row with touch sensors. No action; listed for completeness.
12. **(Clone-specific)** `--bb-sidebar-row-height-coarse` exists in the
    host for exactly this case but rows measure their own padding; the
    coarse row height stays identical to desktop (two-line box ~58px).
    Intentional for tree-guide alignment (compact asserts inline padding).
    Keep, unless a bespoke coarse row metric is requested.

## Fixed in 0.13.0 (recap)

- ✅ sticky hover paints (row tubes, headers, chips, segmented, chrome)
- ✅ touch-scale header chrome + 16px filter ink (no iOS zoom)
- ✅ + new thread reachable at rest under `hover: none`
- ✅ Tag badges + tag rollup on spool cards (new display, both viewports)
- ✅ Thread summary content setting (display, both viewports)
- ✅ Details: Tag line item + Activity (touch-visible timestamps)

## Recommended next steps (owned by future turns)

1. Bottom-sheet menus at `isCompactViewport` (item 1) — the single
   highest-leverage mobile behavior fix; one component, all menu sites.
2. Bottom-sheet `UnspoolConfirm` + `SectionSettings` (item 6).
3. Auto-collapse the filter header on compact viewports by default
   (item 7) — stored preference should still win.
4. Consider move-to-section drag targets for spool filing on touch if
   drags return (the menu remains the touch path).
