import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guards over app.css.
 *
 * jsdom does not resolve the real cascade, so these assert on the stylesheet
 * text for classes of bug that are invisible to a render test.
 */
// The test sits beside app.css at the package root.
const css = readFileSync(
  resolve(import.meta.dirname ?? ".", "app.css"),
  "utf8",
);

/** Every `selector { body }` block, with comments stripped. */
function rules(source = css): { selector: string; body: string }[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    body,
  }));
}

describe("app.css", () => {
  it("never styles BB's own elements", () => {
    // BB owns its sidebar, panel, toggle and navigation rail.
    const selectors = rules().flatMap((rule) => rule.selector.split(/,(?![^()]*\))/));
    expect(selectors.filter((selector) => /\[data-sidebar=|\.group\.peer|\[data-testid=|\bhtml\b|data-spooler-rail/.test(selector))).toEqual([]);
  });

  it("never anchors :has() on the page", () => {
    // body:has() made the browser restyle the page on every DOM change in
    // BB: about 4-5ms per streamed chunk or tooltip in a 20k-element page.
    const selectors = rules().flatMap((rule) => rule.selector.split(/,(?![^()]*\))/));
    expect(selectors.filter((selector) =>
      /(^|[\s>+~(])(body|html|:root)(\[[^\]]*\]|\.[\w-]+)*:has\(/.test(selector),
    )).toEqual([]);
  });

  it("keeps the chip row off container queries (chips wrap instead)", () => {
    // The old 284px fold is retired: status chips are a wrapping row and the
    // narrow drawer grows taller rather than hiding labels.
    expect(css).not.toContain("@container spooler-thread-list (max-width: 284px)");
    for (const file of ["README.md", "CHANGELOG.md"]) {
      const copy = readFileSync(resolve(import.meta.dirname, file), "utf8");
      expect(copy).not.toMatch(/284px/);
    }
  });

  it("lets a swiped-away row fold shut whatever its density", () => {
    // The compact and two-line rules set a min-height at the same specificity
    // and come later in the file, so only !important lets the fold win.
    const fold = rules().find((rule) =>
      rule.selector.includes('.spooler-row[data-swipe-phase="fold"]'),
    );
    expect(fold?.body).toMatch(/min-height:\s*0\s*!important/);
    // The wait in useRowSwipe is the one place the duration is set.
    expect(fold?.body).toMatch(/height var\(--spooler-swipe-fold,/);
  });

  it("lays row metadata as one meta line with one rhetoric slot per fact", () => {
    // The old wrapping chip grid is retired: rows read title line + meta
    // line. The meta carries at most one status pill/word, the project
    // (first to truncate), and the PR.
    const meta = rules().find((rule) => rule.selector === ".spooler-row-meta");
    expect(meta?.body).toMatch(/display:\s*flex/);
    expect(meta?.body).toMatch(/white-space:\s*nowrap/);
    expect(rules().find((rule) => rule.selector === ".spooler-thread-title")?.body)
      .toMatch(/display:\s*contents/);
    // The metadata grid is retired outright.
    expect(rules().filter((rule) => /\.spooler-row-grid\b/.test(rule.selector)))
      .toEqual([]);
    // Quiet rows keep the meta line (it is where the project lives) but
    // compact clamps it to one unwrapped line.
    const compactMeta = rules().find(
      (rule) => rule.selector === ".spooler-density-compact .spooler-row-meta,\n.spooler-row-compact .spooler-row-meta",
    );
    expect(compactMeta?.body).toMatch(/flex-wrap:\s*nowrap/);
    expect(compactMeta?.body).toMatch(/overflow:\s*hidden/);
    // The retired extra wrapper must not come back.
    expect(rules().filter((rule) => /\.spooler-row-extra\b/.test(rule.selector)))
      .toEqual([]);
  });

  it("clamps the whole title instead of the last SDK segment", () => {
    const title = rules().find((rule) =>
      rule.selector === ".spooler-title-wrap .spooler-thread-title",
    );
    expect(title?.body).toMatch(/-webkit-line-clamp:\s*2/);
    expect(title?.body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rules().filter((rule) => /spooler-title-wrap/.test(rule.selector) && /-webkit-line-clamp/.test(rule.body))
      .map((rule) => rule.selector)).toEqual([
      // Ordinary thread titles honor the two-line setting; no wrap-scoped
      // third rule may sneak a clamp in.
      ".spooler-title-wrap .spooler-thread-title",
    ]);
    // The redesigned section list runs the two-row grammar structurally:
    // spool titles and section header titles clamp on their own, outside
    // the wrap setting.
    for (const selector of [
      ".spooler-spool-title",
      ".spooler-group-header-right .spooler-group-label",
    ]) {
      const rule = rules().find((candidate) => candidate.selector === selector);
      expect(rule?.body).toMatch(/-webkit-line-clamp:\s*2/);
      expect(rule?.body).toMatch(/overflow-wrap:\s*anywhere/);
    }
  });

  it("sizes wrapping titles from content and keeps the grid out of two-line mode", () => {
    expect(rules().find((rule) => rule.selector === ".spooler-title-wrap .spooler-row-title-text")?.body)
      .toMatch(/flex:\s*1 1 auto/);
    // The metadata grid needs no two-line variant: it wraps itself.
    expect(rules().filter((rule) => /\.spooler-title-wrap .*spooler-row-grid/.test(rule.selector)))
      .toEqual([]);
  });

  it("overlays the hover cluster in the time slot on hover or focus-within", () => {
    // The cluster (Pin · Archive · Details · More) sits top-right and
    // reveals on row hover or focus-within; touch reaches it through the
    // More menu. It must never be display:none — keyboard focus and the
    // settled-shelf path both rely on opacity.
    const cluster = rules().find(
      (rule) => rule.selector === ".spooler-row-cluster",
    );
    expect(cluster?.body).toMatch(/top:\s*\d+px/);
    expect(rules()
      .filter((rule) => /\.spooler-row-cluster\b/.test(rule.selector) && /display:\s*none/.test(rule.body)))
      .toEqual([]);
    const reveal = rules().find(
      (rule) =>
        rule.selector.includes(".spooler-row:hover .spooler-row-cluster") &&
        rule.selector.includes(".spooler-row:focus-within .spooler-row-cluster"),
    );
    expect(reveal?.body).toMatch(/opacity:\s*1/);
    // The old actions bar is retired.
    expect(rules().filter((rule) => /\.spooler-row-actions\b/.test(rule.selector)))
      .toEqual([]);
    // The per-line lift machinery is retired: the title line is the only
    // surface the cluster ever overlays.
    expect(css).not.toContain("--spooler-actions-lift");
  });

  it("estimates unrendered two-line rows taller than one-line rows", () => {
    const estimate = (selector: RegExp) => Number(
      rules()
        .find((rule) => selector.test(rule.selector) && /contain-intrinsic-size/.test(rule.body))
        ?.body.match(/contain-intrinsic-size:\s*auto\s+(\d+)px/)?.[1],
    );
    expect(estimate(/^\.spooler-title-wrap \.spooler-row$/))
      .toBeGreaterThan(estimate(/^\.spooler-row$/));
    expect(estimate(/^\.spooler-title-wrap\.spooler-density-compact \.spooler-row,/))
      .toBeGreaterThan(estimate(/^\.spooler-density-compact \.spooler-row,/));
  });

  it("never resets the row margin with the shorthand", () => {
    // `margin: 0` also zeroes margin-left, which silently wipes the child
    // thread indent that .spooler-row-child / .spooler-row-deep own.
    const offenders = rules()
      .filter((rule) => /\.spooler-row\b/.test(rule.selector))
      .filter((rule) => /(^|[;{\s])margin:\s*0\s*[;]?\s*$/.test(rule.body));

    expect(offenders.map((rule) => rule.selector)).toEqual([]);
  });

  it("keeps the child indent defined", () => {
    const child = rules().find((rule) => rule.selector === ".spooler-row-child");
    const deep = rules().find((rule) => rule.selector === ".spooler-row-deep");
    expect(child?.body).toMatch(/margin-left:\s*16px/);
    expect(deep?.body).toMatch(/margin-left:\s*28px/);
  });

  it("keeps the trailing time cluster on the title line, beside the title", () => {
    // The title and the trailing badges share one head row, aligned on
    // their vertical centers; the meta line is its own row beneath.
    const head = rules().find((rule) => rule.selector === ".spooler-row-head");
    expect(head?.body).toMatch(/display:\s*flex/);
    expect(head?.body).toMatch(/align-items:\s*center/);
    expect(rules().find((rule) => rule.selector === ".spooler-row-head > .spooler-row-title")?.body)
      .toMatch(/flex:\s*1 1 auto/);
  });

  it("renders spool rosters one step deeper with one straight guide", () => {
    // Members render at depth 1 for their row logic; the roster hangs one
    // stock step (48px) deeper than the bucket's own rows, with no elbow
    // tree guides — ONE straight hairline per member dropping back to the
    // section icon's axis, plus one 2px gap between members.
    const members = rules().find((rule) => rule.selector === ".spooler-spool-members");
    expect(members?.body).toMatch(/padding:\s*0/);
    expect(members?.body).toMatch(/margin-top:\s*0/);
    expect(members?.body).toMatch(/border-top:\s*none/);
    expect(members?.body).toMatch(/gap:\s*2px/);
    const member = rules().find((rule) => rule.selector === ".spooler-spool-member .spooler-row-child");
    expect(member?.body).toMatch(/margin-left:\s*48px/);
    const guides = rules().filter((rule) =>
      /\.spooler-spool-member \.spooler-row-child::(before|after)/.test(rule.selector),
    );
    expect(guides.map((rule) => rule.selector.split("::")[1])).toEqual(["after", "before"]);
    expect(guides[0]?.body).toMatch(/display:\s*none/);
    const guide = rules().find((rule) =>
      rule.selector === ".spooler-spool-member .spooler-row-child::before",
    );
    expect(guide?.body).toMatch(/left:\s*-15px/);
    expect(guide?.body).toMatch(/width:\s*1px/);
  });

  it("gives no row a person glyph or a grid inset", () => {
    // The glyph was the only reason the grid stepped in under child rows.
    expect(css).not.toContain("spooler-child-glyph");
    expect(rules().filter((rule) => /\.spooler-row-(child|deep) \.spooler-row-grid/.test(rule.selector)))
      .toEqual([]);
  });

  it("keeps compact inline padding identical to comfortable", () => {
    // Compact must compress vertically only, or the tree guides drift off
    // the text they belong to.
    const main = rules().find((rule) =>
      /\.spooler-density-compact \.spooler-row-main/.test(rule.selector),
    );
    expect(main?.body).toMatch(/padding:\s*\d+px 8px/);
  });

  it("keeps badge-row titles readable when the row is squeezed", () => {
    // The project yields first (it is the flex-shrink item), the title
    // keeps a floor, the time ellipsizes instead of overflowing, and the
    // row clips any pathological residue at the text edge.
    const project = rules()
      .filter((rule) => rule.selector === ".spooler-row-project")
      .find((rule) => /flex:/.test(rule.body));
    expect(project?.body).toMatch(/flex:\s*0 1 auto/);
    expect(project?.body).toMatch(/text-overflow:\s*ellipsis/);
    expect(rules().find((rule) => rule.selector === ".spooler-row-title-text")?.body)
      .toMatch(/min-width:\s*40px/);
    const time = rules().find((rule) => rule.selector === ".spooler-row-time");
    expect(time?.body).toMatch(/flex:\s*0 1 auto/);
    expect(time?.body).toMatch(/white-space:\s*nowrap/);
    expect(time?.body).toMatch(/text-overflow:\s*ellipsis/);
    expect(rules().find((rule) => rule.selector === ".spooler-row-title")?.body)
      .toMatch(/overflow:\s*clip/);
  });

  it("declares each row-affecting selector at most once", () => {
    const seen = new Map<string, number>();
    for (const rule of rules()) {
      if (!/\.spooler-row-main|\.spooler-row-extra/.test(rule.selector)) continue;
      seen.set(rule.selector, (seen.get(rule.selector) ?? 0) + 1);
    }
    const duplicated = [...seen].filter(([, count]) => count > 1);
    // A later duplicate silently wins by source order — that is how the
    // padding regression came back during this fix.
    expect(duplicated.map(([selector]) => selector)).toEqual([]);
  });

  it("presents one pill pip: numeral center-massed, spinner behind it", () => {
    // Both pips — the section header's and the spool card's — share the
    // same recipe: a circular 18px pill (min-width, never a stretched
    // width) that can only widen horizontally when a second digit needs
    // the room.
    for (const selector of [
      ".spooler-group-count-pip",
      ".spooler-spool-pip .spooler-spool-count",
    ]) {
      const rule = rules().find(
        (candidate) => candidate.selector === selector,
      );
      expect(rule?.body).toMatch(/min-width:\s*18px/);
      expect(rule?.body).toMatch(/height:\s*18px/);
      expect(rule?.body).toMatch(/padding-inline:\s*5px/);
      expect(rule?.body).toMatch(/border-radius:\s*999px/);
      expect(rule?.body).toMatch(/box-sizing:\s*border-box/);
      expect(rule?.body).not.toMatch(/(?<![\w-])width:\s*18px/);
      expect(rule?.body).not.toMatch(/padding:\s*[1-9]/);
    }
    // The numeral paints above the overlay spinner (it is positioned and
    // later in DOM), reads in the host's mono face so a count flip only
    // widens the pill, and trims itself to the digit's cap band so
    // centering is the ink's center of mass, not the metrics box.
    const numeral = rules().find(
      (rule) => rule.selector === ".spooler-pip-numeral",
    );
    expect(numeral?.body).toMatch(/position:\s*relative/);
    expect(numeral?.body).toMatch(/z-index:\s*1/);
    expect(numeral?.body).toMatch(/line-height:\s*1/);
    expect(numeral?.body).toMatch(/font-family:\s*var\(--font-mono/);
    expect(numeral?.body).toMatch(/text-box-trim:\s*trim-both/);
    expect(numeral?.body).toMatch(/text-box-edge:\s*cap\s+alphabetic/);
    // Spinning geometry: every spooler spinner rotates about its viewBox
    // center — a px origin (e.g. 12px 12px) resolves against the CSS box
    // rather than the 24-unit viewBox, so the rotation center lands off
    // center and the ticks orbit instead of spinning in place. Percentages
    // with transform-box: view-box hit the viewport center at any size.
    const spin = rules().find(
      (rule) => rule.selector === ".spooler-spinner [data-icon-root]",
    );
    expect(spin?.body).toMatch(/transform-box:\s*view-box/);
    expect(spin?.body).toMatch(/transform-origin:\s*50%\s+50%/);
    // The pip's spinner is pip-sized (ticks ring the numeral without
    // trading paint) and constant: it must not stretch with the pill.
    const pipIcon = rules().find(
      (rule) =>
        rule.selector.includes(
          ".spooler-spool-pip .spooler-spool-pip-status [data-icon-root]",
        ),
    );
    expect(pipIcon?.body).toMatch(/width:\s*18px/);
    expect(pipIcon?.body).toMatch(/height:\s*18px/);
    // The spool pip's spinner spans its pip exactly like the section's —
    // and centers the svg itself: bare flex content parks it up-left.
    const status = rules().find(
      (rule) =>
        rule.selector === ".spooler-spool-pip .spooler-spool-pip-status",
    );
    expect(status?.body).toMatch(/position:\s*absolute/);
    expect(status?.body).toMatch(/inset:\s*0/);
    expect(status?.body).toMatch(/display:\s*flex/);
    expect(status?.body).toMatch(/align-items:\s*center/);
    expect(status?.body).toMatch(/justify-content:\s*center/);
  });

  it("retired the stacked-deck layers under spool cards", () => {
    // The layers poked out below the card's negative bottom margin, so the
    // panel border had blank space under it; the card now sits plainly.
    expect(css).not.toContain("spooler-spool-stack-layer");
  });

  it("overlays the section status on a neutral pip that tones only by state", () => {
    const pip = rules().find((rule) =>
      rule.selector === ".spooler-group-count-pip",
    );
    // Shannon style: neutral fg tint at rest — the slab mixes are gone.
    expect(pip?.body).toMatch(/border-radius:\s*999px/);
    expect(pip?.body).toMatch(/color-mix\(in srgb, var\(--foreground\) 6%, transparent\)/);
    const status = rules().find(
      (rule) =>
        rule.selector === ".spooler-group-count-pip .spooler-group-status",
    );
    // The status spans the pip exactly: inset zero, not resized separately.
    expect(status?.body).toMatch(/position:\s*absolute/);
    expect(status?.body).toMatch(/inset:\s*0/);
    // A state may only tint WHOLE pips (:has on the overlaid status), one
    // tint per state: running green, needs-you amber, failed red.
    const tints = rules().filter((rule) =>
      rule.selector.startsWith(".spooler-group-count-pip:"),
    );
    expect(tints.map((rule) => rule.selector)).toEqual([
      ".spooler-group-count-pip:has(.spooler-dot-error)",
      ".spooler-group-count-pip:has(.spooler-dot-attention)",
      ".spooler-group-count-pip:has(.spooler-tone-running)",
    ]);
    // The spinner is success green — the same mix the WORKING badges read —
    // and does not pulse inside the pip: the numeral above it stays steady.
    const tone = rules().find(
      (rule) =>
        rule.selector === ".spooler-group-count-pip .spooler-tone-running",
    );
    expect(tone?.body).toMatch(/--success/);
    expect(tone?.body).toMatch(/animation:\s*none/);
  });

  it("puts the chevron at the left of every group header, even sections", () => {
    // §2(d): the section-mode chevron moved from the far right to the left
    // of the label, while the section rail stays between them.
    const toggle = rules().find((rule) => rule.selector === ".spooler-group-toggle");
    expect(toggle?.body).toMatch(/display:\s*flex/);
    const chevron = rules().find((rule) => rule.selector === ".spooler-group-chevron");
    expect(chevron?.body).toMatch(/width:\s*14px/);
    // No far-right chevron variant may come back.
    expect(rules().filter((rule) => /spooler-group-chevron-right/.test(rule.selector)))
      .toEqual([]);
  });

  it("lays bucket boxes on one vertical rhythm, flush under the header", () => {
    const fold = rules().find(
      (rule) =>
        rule.selector ===
        ".spooler-list-sections .spooler-group > .spooler-fold > .spooler-fold-inner",
    );
    // The fold is the spacing authority: the 2px entry gap for every
    // adjacency, no top inset (the first box rides right under the rim),
    // and the column simply ends at the last entry.
    expect(fold?.body).toMatch(/flex-direction:\s*column/);
    expect(fold?.body).toMatch(/gap:\s*2px/);
    expect(fold?.body).toMatch(/padding-top:\s*0/);
    expect(fold?.body).toMatch(/padding-bottom:\s*0/);
    // A mangled merge once spliced a 999px radius in here, clipping whole
    // sections into pills when expanded (0fr hid it while collapsed).
    expect(fold?.body).not.toMatch(/border-radius|box-shadow/);
    // Neither card kind carries its own vertical margin at the bucket's top
    // level, so the rhythm can't drift between spool cards and thread cards.
    const card = rules().find(
      (rule) =>
        rule.selector === ".spooler-group-bucket .spooler-spool-card",
    );
    expect(card?.body).toMatch(/margin-block:\s*0/);
    const row = rules().find((rule) =>
      rule.selector ===
      ".spooler-group-bucket > .spooler-fold > .spooler-fold-inner > .spooler-thread-cluster > .spooler-row",
    );
    expect(row?.body).toMatch(/margin-block:\s*0/);
    // Boxed panels separate themselves: no hairline between top-level runs.
    const sep = rules().find((rule) =>
      rule.selector ===
      ".spooler-group-bucket > .spooler-fold > .spooler-fold-inner > .spooler-thread-cluster + .spooler-thread-cluster::before",
    );
    expect(sep?.body).toMatch(/content:\s*none/);
    // Member separators are gone: the flat roster separates by the same
    // 2px entry rhythm instead of hairlines inside the card.
    expect(
      rules().find(
        (rule) => rule.selector === ".spooler-spool-member + .spooler-spool-member",
      ),
    ).toBeUndefined();
    const first = rules().find(
      (rule) =>
        rule.selector ===
        ".spooler-list-sections .spooler-fold-inner > :first-child",
    );
    expect(first?.body).toMatch(/margin-top:\s*0/);
  });

  it("keeps the stylesheet brace-balanced", () => {
    // Unbalanced braces turn the following selector into a nested rule in
    // browsers that support CSS nesting, silently firing its declarations
    // at the previous rule's targets. Assert every open brace closes.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect([...stripped].filter((ch) => ch === "{").length).toBe(
      [...stripped].filter((ch) => ch === "}").length,
    );
  });

  it("headers are sticky one-line captions on the sidebar", () => {
    const header = rules().find((candidate) => candidate.selector === ".spooler-group-header");
    expect(header?.body).toMatch(/height:\s*28px/);
    expect(header?.body).toMatch(/background:\s*var\(--sidebar/);
    expect(header?.body).toMatch(/z-index:\s*10/);
    // Pills live at the caption's right end and only render when a count
    // is above zero; no dot, no pill otherwise.
    const pills = rules().find((rule) => rule.selector === ".spooler-group-pills");
    expect(pills?.body).toMatch(/margin-left:\s*auto/);
    const failed = rules().find((rule) => rule.selector === ".spooler-group-pill-failed");
    expect(failed?.body).toMatch(/--surface-destructive/);
    const needs = rules().find((rule) => rule.selector === ".spooler-group-pill-needs");
    expect(needs?.body).toMatch(/--surface-attention/);
    const working = rules().find((rule) => rule.selector === ".spooler-group-pill-working");
    expect(working?.body).toMatch(/--success-foreground/);
    // The section colour dot is retired.
    expect(rules().filter((rule) => /\.spooler-sec-dot\b/.test(rule.selector)))
      .toEqual([]);
  });

  it("carries the section color in one dot and indents the bucket flat", () => {
    // Shannon style: no tri-tone. A bucket owns only its dot variable (gray
    // fallback for the uncolored sections) and the flat row treatment:
    // rows indent one stock step, the dot rides in the header, box shadows
    // and slab backgrounds never reappear.
    expect(css).not.toMatch(/--spooler-sec-[123]\b/);
    expect(css).not.toContain("spooler-sec-fg");
    const bucket = rules().find(
      (rule) => rule.selector === ".spooler-group-bucket",
    );
    expect(bucket?.body).toMatch(/--spooler-sec-dot:\s*var\(--muted-foreground\)/);
    const row = rules().find(
      (rule) => rule.selector === ":where(.spooler-group-bucket) .spooler-row",
    );
    expect(row?.body).toMatch(/margin-left:\s*24px/);
    const dot = rules().find(
      (rule) => rule.selector === ".spooler-group-header .spooler-sec-dot",
    );
    expect(dot?.body).toMatch(/width:\s*6px/);
    expect(dot?.body).toMatch(/background:\s*var\(--spooler-sec-dot, var\(--muted-foreground\)\)/);
    // Wrappers re-use the bare .spooler-group class, so the hide rule must
    // gate through the header's DIRECT parent or it hides every dot.
    const hide = rules().find(
      (rule) =>
        rule.selector.includes(':not(.spooler-group-bucket)') &&
        rule.body.includes('display: none'),
    );
    expect(hide?.selector).toContain('> .spooler-group-header .spooler-sec-dot');
  });

  it("keeps the menu color swatch its own pill", () => {
    // Restored after a merge ate its rule into the bucket fold-inner one.
    const swatch = rules().find((rule) => rule.selector === ".spooler-menu-swatch");
    expect(swatch?.body).toMatch(/border-radius:\s*999px/);
    expect(swatch?.body).toMatch(/box-shadow:\s*inset/);
  });

  it("pins the whole Active station and offsets the group headers beneath it", () => {
    // The overlay is bar + cards together: the station carries the sticky,
    // its measured height lands in --spooler-active-overlap, and that
    // custom property is what every other group header sticks beneath —
    // so the overlay can wrap or fold without anything drifting.
    const station = rules().find((rule) => rule.selector === ".spooler-active-station");
    expect(station?.body).toMatch(/position:\s*sticky/);
    expect(station?.body).toMatch(/top:\s*0/);
    expect(station?.body).toMatch(/z-index:\s*2/);
    expect(station?.body).toMatch(/flex-direction:\s*column/);
    const header = rules().find((rule) => rule.selector === ".spooler-group-header");
    expect(header?.body).toMatch(/top:\s*var\(--spooler-active-overlap, 0px\)/);
    const bar = rules().find((rule) => rule.selector === ".spooler-active-bar");
    expect(bar?.body).toMatch(/min-height:\s*var\(--spooler-active-bar-h\)/);
    // No double rim: the bar's old border-bottom moved to the station.
    expect(bar?.body).not.toMatch(/border-bottom/);
    expect(station?.body).toMatch(/border-bottom:\s*1px solid var\(--border\)/);
  });

  it("keeps the collapsed filter header one widget beyond the search row", () => {
    // Collapsed hides the filter INPUT: the Grouping widget anchors the
    // row's left edge and the auto margin right-justifies the toggle
    // chevron; expanded, the input's flex basis makes that margin a no-op.
    const row = rules().find((rule) => rule.selector === ".spooler-search-row");
    expect(row?.body).toMatch(/display:\s*flex/);
    const search = rules().find(
      (rule) => rule.selector === ".spooler-search-row .spooler-search",
    );
    expect(search?.body).toMatch(/flex:\s*1 1 auto/);
    expect(search?.body).toMatch(/min-width:\s*0/);
    const toggle = rules().find((rule) => rule.selector === ".spooler-filters-toggle");
    expect(toggle?.body).toMatch(/flex:\s*none/);
    expect(toggle?.body).toMatch(/margin-left:\s*auto/);
    const mini = rules().find((rule) => rule.selector === ".spooler-filters-mini");
    expect(mini?.body).toMatch(/flex:\s*none/);
  });
});
