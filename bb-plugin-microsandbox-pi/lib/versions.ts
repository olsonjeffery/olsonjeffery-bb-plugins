// bb-plugin-microsandbox-pi — version strings and their ordering.
//
// Pure, dependency-free utilities shared by the host probe, the CLI
// and the page. Everything here is safe to import from the frontend
// bundle (no node builtins).

/** First semver-ish token in a CLI's version output — "1.3.0" from
 * "pi 1.3.0", "0.7.11" from "msb-cli 0.7.11", prerelease aware. */
export function parseVersion(output: string): string | null {
  // The lookbehind keeps a letter prefix ("v1.3.0") usable but refuses
  // to start mid-run ("x10.1.2") or after a decimal point of a longer
  // undotted run.
  const match = /(?<![\d.])\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z._-]*)?(?:\+[0-9A-Za-z._-]+)?/.exec(output);
  if (!match) return null;
  const after = output.slice(match.index + match[0].length);
  // "1.2.34.56": the greedy number run absorbed a fourth numeric
  // section — refuse rather than misreport a prefix.
  if (/^\.\d/.test(after)) return null;
  return match[0];
}

interface SemverChunks {
  core: [number, number, number];
  pre: readonly (number | string)[];
}

/** One semver for ordering. Loose: accepts a leading "v"/"=" and
 * dotted prerelease identifiers. */
export function toSemver(version: string): SemverChunks | null {
  const match = version
    .replace(/^[v=\s]+/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+.*)?$/);
  if (!match) return null;
  const core: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const pre =
    match[4] === undefined ? [] : match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return { core, pre };
}

/** Semver ordering: pre-release below its release, build metadata
 * ignored. Real semver outranks junk; junk falls back to lexical order,
 * so sorting never throws. */
export function compareVersions(a: string, b: string): number {
  const sa = toSemver(a);
  const sb = toSemver(b);
  if (sa === null && sb === null) return a === b ? 0 : a < b ? -1 : 1;
  if (sa === null) return -1; // junk sorts below real semver
  if (sb === null) return 1;
  for (let i = 0; i < 3; i += 1) {
    if (sa.core[i] !== sb.core[i]) return sa.core[i] - sb.core[i];
  }
  const fa = sa.pre.length === 0;
  const fb = sb.pre.length === 0;
  if (fa !== fb) return fa ? 1 : -1;
  for (let i = 0; i < Math.min(sa.pre.length, sb.pre.length); i += 1) {
    const pa = sa.pre[i];
    const pb = sb.pre[i];
    if (pa === pb) continue;
    if (typeof pa === "number" && typeof pb === "number") return pa - pb;
    if (typeof pa === "number") return -1;
    if (typeof pb === "number") return 1;
    return pa < pb ? -1 : 1;
  }
  // Same shared prefix: more identifiers outrank fewer (1.0.0-alpha.1
  // > 1.0.0-alpha).
  return sa.pre.length - sb.pre.length;
}

export function sortVersionsDesc(versions: readonly string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}
