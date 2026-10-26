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

  it("documents the chip-fold threshold consistently", () => {
    expect(css).toContain("@container spooler-thread-list (max-width: 284px)");
    for (const file of ["README.md", "CHANGELOG.md"]) {
      const copy = readFileSync(resolve(import.meta.dirname, file), "utf8");
      expect(copy).toContain("284px");
      expect(copy).not.toMatch(/(?:270|285)px/);
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

  it("lays row metadata as one wrapping chip grid", () => {
    // The grid is the whole metadata story: every kind (time, project,
    // model, thinking, section, host, branch, PR, folded summary) is a chip
    // on one wrapping row, capped per element so one long value can never
    // eat the line, and the owned title stays transparent to the layout.
    const grid = rules().find((rule) => rule.selector === ".spooler-row-grid");
    expect(grid?.body).toMatch(/display:\s*flex/);
    expect(grid?.body).toMatch(/flex-wrap:\s*wrap/);
    expect(grid?.body).toMatch(/max-width:\s*100%/);
    const item = rules().find(
      (rule) => rule.selector === ".spooler-row-grid > *",
    );
    expect(item?.body).toMatch(/max-width:\s*45%/);
    expect(rules().find((rule) => rule.selector === ".spooler-thread-title")?.body)
      .toMatch(/display:\s*contents/);
    // The old stacked-line layout is retired outright: no rule may declare
    // .spooler-row-meta anywhere.
    expect(rules().filter((rule) => /\.spooler-row-meta\b/.test(rule.selector)))
      .toEqual([]);
    // Quiet rows fold only the SECONDARY chips; time/project/branch/PR and
    // a folded-family summary stay, so the grid never reads as empty.
    const secondary = rules().find(
      (rule) => rule.selector === ".spooler-row-collapsed .spooler-grid-secondary",
    );
    expect(secondary?.body).toMatch(/display:\s*none/);
    // Compact keeps the grid to one unwrapped line instead of hiding it.
    const compactGrid = rules().find(
      (rule) => rule.selector === ".spooler-density-compact .spooler-row-grid,\n.spooler-row-compact .spooler-row-grid",
    );
    expect(compactGrid?.body).toMatch(/flex-wrap:\s*nowrap/);
    expect(compactGrid?.body).toMatch(/overflow:\s*hidden/);
    expect(rules()
      .filter((rule) => /\.spooler-row-extra\b/.test(rule.selector) && /grid-template-rows:\s*0fr/.test(rule.body) && /compact/.test(rule.selector)))
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
      // Ordinary thread titles and the spool header title both honor the
      // two-line setting; no third rule may sneak a clamp in.
      ".spooler-title-wrap .spooler-thread-title",
      ".spooler-title-wrap .spooler-spool-title",
    ]);
  });

  it("sizes wrapping titles from content and keeps the grid out of two-line mode", () => {
    expect(rules().find((rule) => rule.selector === ".spooler-title-wrap .spooler-row-title-text")?.body)
      .toMatch(/flex:\s*1 1 auto/);
    // The metadata grid needs no two-line variant: it wraps itself.
    expect(rules().filter((rule) => /\.spooler-title-wrap .*spooler-row-grid/.test(rule.selector)))
      .toEqual([]);
  });

  it("keeps hover actions top-anchored and never hides them", () => {
    // The actions bar overlays the title line's right end in every layout;
    // per-row hiding is out: under project grouping no row has a chip, so
    // that emptied the bar list-wide.
    const actions = rules().find(
      (rule) => rule.selector === ".spooler-row-actions",
    );
    expect(actions?.body).toMatch(/top:\s*\d+px/);
    expect(rules()
      .filter((rule) => /spooler-title-wrap/.test(rule.selector) && /\.spooler-action\b/.test(rule.selector) && /display:\s*none/.test(rule.body))
      .map((rule) => rule.selector)).toEqual([]);
    expect(rules().filter((rule) => /spooler-title-wrap.*:hover/.test(rule.selector)))
      .toEqual([]);
    // The per-line lift machinery is retired: the title line is the only
    // surface the bar ever overlays.
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

  it("puts the status cluster on the title line, beside the title", () => {
    // Title and badges share one head row, aligned on the first baseline, so
    // the cluster never floats between the title and the metadata grid. The
    // grid is its own line, pinned to the text column so a long chip cannot
    // spill past the row edge.
    const head = rules().find((rule) => rule.selector === ".spooler-row-head");
    expect(head?.body).toMatch(/display:\s*flex/);
    expect(head?.body).toMatch(/align-items:\s*baseline/);
    expect(rules().find((rule) => rule.selector === ".spooler-row-head > .spooler-row-title")?.body)
      .toMatch(/flex:\s*1 1 auto/);
    const extra = rules().find((rule) => rule.selector === ".spooler-row-extra");
    expect(extra?.body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    const inner = rules().find((rule) => rule.selector === ".spooler-row-extra-inner");
    expect(inner?.body).toMatch(/min-width:\s*0/);
  });

  it("renders spool roster rows flush with the card, with no tree guides", () => {
    // Members render at depth 1 for their row logic; the roster itself is
    // flat, so it may not indent or draw the family tree's guides.
    const members = rules().find((rule) => rule.selector === ".spooler-spool-members");
    expect(members?.body).toMatch(/padding:\s*2px 10px 8px 0/);
    const member = rules().find((rule) => rule.selector === ".spooler-spool-member .spooler-row-child");
    expect(member?.body).toMatch(/margin-left:\s*0/);
    const guides = rules().filter((rule) => /\.spooler-spool-member \.spooler-row-child::(before|after)/.test(rule.selector));
    expect(guides).toHaveLength(1);
    expect(guides[0]?.body).toMatch(/display:\s*none/);
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
    // At phone widths a chip plus time plus badge left no room: the title
    // was the only shrinkable item, so it went to zero and the time
    // painted under the badge. Now the chip yields first, the title keeps
    // a floor, the time ellipsizes instead of overflowing, and the row
    // clips any pathological residue at the text edge.
    const project = rules()
      .filter((rule) => rule.selector === ".spooler-row-project")
      .find((rule) => /flex:/.test(rule.body));
    expect(project?.body).toMatch(/flex:\s*0 1 auto/);
    expect(project?.body).toMatch(/min-width:\s*0/);
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

  it("overlays the section status on the count pip in success green", () => {
    const pip = rules().find((rule) =>
      rule.selector === ".spooler-group-count-pip",
    );
    // Same panel recipe as spool cards, so the pip reads as belonging.
    expect(pip?.body).toMatch(/border-radius:\s*999px/);
    expect(pip?.body).toMatch(/color-mix\((?:[\s\S]*?)card/);
    const status = rules().find(
      (rule) =>
        rule.selector === ".spooler-group-count-pip .spooler-group-status",
    );
    // The status spans the pip exactly: inset zero, not resized separately.
    expect(status?.body).toMatch(/position:\s*absolute/);
    expect(status?.body).toMatch(/inset:\s*0/);
    // The spinner is success green — the same mix the WORKING badges read —
    // and does not pulse inside the pip: the numeral above it stays steady.
    const tone = rules().find(
      (rule) =>
        rule.selector === ".spooler-group-count-pip .spooler-tone-running",
    );
    expect(tone?.body).toMatch(/--success/);
    expect(tone?.body).toMatch(/animation:\s*none/);
  });

  it("right-aligns the section header chrome and keeps the chevron alone", () => {
    const header = rules().find(
      (rule) => rule.selector === ".spooler-group-header-right",
    );
    expect(header?.body).toMatch(/padding:\s*\d+px\s+\d+px/);
  });

  it("lays bucket boxes on one vertical rhythm, flush under the header", () => {
    const fold = rules().find(
      (rule) =>
        rule.selector ===
        ".spooler-list-sections .spooler-group > .spooler-fold > .spooler-fold-inner",
    );
    // The fold is the spacing authority: one flex gap for every adjacency,
    // no top inset (the first box rides right under the header).
    expect(fold?.body).toMatch(/flex-direction:\s*column/);
    expect(fold?.body).toMatch(/gap:\s*6px/);
    expect(fold?.body).toMatch(/padding-top:\s*0/);
    expect(fold?.body).toMatch(/padding-bottom:\s*8px/);
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
    // Threads inside a spool beat in the same 6px time (5px pad + 1px rule).
    const member = rules().find(
      (rule) => rule.selector === ".spooler-spool-member + .spooler-spool-member",
    );
    expect(member?.body).toMatch(/border-top/);
    expect(member?.body).toMatch(/padding-top:\s*5px/);
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

  it("divides the spool card between header and roster with one darker hairline", () => {
    // Both rules share the ink: members' separators and the header/roster
    // divide read 60% of the border color, past the panel tint.
    for (const selector of [
      ".spooler-spool-members",
      ".spooler-spool-member + .spooler-spool-member",
    ]) {
      const rule = rules().find((candidate) => candidate.selector === selector);
      expect(rule?.body).toMatch(
        /border-top:\s*1px solid color-mix\(in srgb, var\(--border\) 60%, transparent\)/,
      );
    }
    // The header keeps the same 5px runway above the divide that member
    // separators carry below theirs (5px pad + 1px rule = one 6px beat).
    const members = rules().find(
      (candidate) => candidate.selector === ".spooler-spool-members",
    );
    expect(members?.body).toMatch(/margin-top:\s*5px/);
  });

  it("keeps the menu color swatch its own pill", () => {
    // Restored after a merge ate its rule into the bucket fold-inner one.
    const swatch = rules().find((rule) => rule.selector === ".spooler-menu-swatch");
    expect(swatch?.body).toMatch(/border-radius:\s*999px/);
    expect(swatch?.body).toMatch(/box-shadow:\s*inset/);
  });
});
