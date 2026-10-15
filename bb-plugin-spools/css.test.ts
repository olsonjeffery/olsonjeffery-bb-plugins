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

  it("keeps metadata and the owned title transparent to one-line layout", () => {
    for (const selector of [".spooler-row-meta", ".spooler-thread-title"]) {
      expect(rules().find((rule) => rule.selector === selector)?.body)
        .toMatch(/display:\s*contents/);
    }
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

  it("sizes wrapping titles from content and declares wrapping metadata once", () => {
    expect(rules().find((rule) => rule.selector === ".spooler-title-wrap .spooler-row-title-text")?.body)
      .toMatch(/flex:\s*1 1 auto/);
    expect(rules().filter((rule) => rule.selector === ".spooler-title-wrap .spooler-row-meta"))
      .toHaveLength(1);
  });

  it("lifts two-line hover actions clear of the branch line and never hides them", () => {
    // The bar sits at the row's bottom in two-line mode. Unlifted, it lands
    // on the branch line and takes clicks meant for the PR badge. Hiding
    // actions per row is out too: under project grouping no row has a chip,
    // so that emptied the bar list-wide.
    const wrap = rules().filter((rule) => /spooler-title-wrap/.test(rule.selector));
    expect(wrap.find((rule) => /:has\(\.spooler-branch-line\)/.test(rule.selector))?.body)
      .toMatch(/--spooler-actions-lift:\s*[1-9]\d*px/);
    expect(wrap.find((rule) => /\.spooler-row-actions$/.test(rule.selector) && /bottom:/.test(rule.body))?.body)
      .toMatch(/var\(--spooler-actions-lift\)/);
    expect(wrap
      .filter((rule) => /\.spooler-action\b/.test(rule.selector) && /display:\s*none/.test(rule.body))
      .map((rule) => rule.selector)).toEqual([]);
    expect(rules().filter((rule) => /spooler-title-wrap.*:hover/.test(rule.selector)))
      .toEqual([]);
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

  it("stands the spool working-count word down instead of clipping it mid-glyph", () => {
    // jsdom cannot lay out the badges line either: the word zero-out is
    // guarded here, the measurement decision in SpoolCard's tests.
    const clip = rules().find(
      (rule) =>
        rule.selector ===
        ".spooler-spool-workcount .spooler-workcount-word-clip",
    );
    expect(clip?.body).toMatch(/flex:\s*0 0 0/);
    expect(clip?.body).toMatch(/overflow:\s*hidden/);
    // The badge itself refuses to shrink: the spinner and the count are the
    // essential signal, so the line never slices them mid-glyph.
    const badge = rules().find(
      (rule) => rule.selector === ".spooler-spool-workcount",
    );
    expect(badge?.body).toMatch(/flex:\s*none/);
  });
});
