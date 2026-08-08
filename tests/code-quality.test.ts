/**
 * Code quality lint tests — catches AI-generated code patterns.
 *
 * Repo-scoped copy (cli is its own source-of-truth repo). Mirrors the checks
 * the AGLedger monorepo enforced, narrowed to this package's `src`. The CLI is
 * not an offline verifier, so the no-network block is intentionally omitted.
 * Run with `npm test`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

/** Source directories to scan (relative to repo root). */
const SOURCE_DIRS = ['src'];

/** Files where emoji/symbols are legitimate (CLI terminal output, parsers). */
const EMOJI_ALLOWLIST = new Set<string>([]);

/** Collect all source files recursively. */
function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectFiles(full, exts));
    } else if (exts.includes(extname(full))) {
      results.push(full);
    }
  }
  return results;
}

function allTsFiles(): string[] {
  return SOURCE_DIRS.flatMap(d => collectFiles(join(ROOT, d), ['.ts']));
}

function relPath(file: string): string {
  return relative(ROOT, file);
}

describe('no emoji in source files', () => {
  // Matches common emoji ranges — skin tones, symbols, pictographs, dingbats
  const emojiPattern = /[\u{1F300}-\u{1F9FF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{2705}\u{274C}\u{274E}\u{2728}\u{2734}\u{2744}\u{2747}\u{2757}\u{2763}\u{2764}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]|[✓✅⚡⏳📋📊❌⚠️✨🔥💡🚀🎉]/gu;

  it('should not contain emoji characters', () => {
    const violations: string[] = [];
    for (const file of allTsFiles()) {
      const rel = relPath(file);
      if (EMOJI_ALLOWLIST.has(rel)) continue;
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const matches = lines[i].match(emojiPattern);
        if (matches) {
          violations.push(`${rel}:${i + 1}  found: ${matches.join(', ')}`);
        }
      }
    }
    expect(violations, `Emoji found in source files:\n${violations.join('\n')}`).toHaveLength(0);
  });
});

describe('no decorative section dividers', () => {
  // Matches lines that are only dashes, equals, or box-drawing chars
  const dividerPattern = /^\s*\/\/\s*[-=═─━]{10,}\s*$/;

  it('should not contain // --- or // === decorative dividers', () => {
    const violations: string[] = [];
    for (const file of allTsFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (dividerPattern.test(lines[i])) {
          violations.push(`${relPath(file)}:${i + 1}  ${lines[i].trim()}`);
        }
      }
    }
    expect(violations, `Section dividers found:\n${violations.join('\n')}`).toHaveLength(0);
  });
});

describe('no per-file copyright boilerplate', () => {
  const copyrightPattern = /Patent Pending|Copyright 20\d{2} AGLedger LLC\. All rights reserved/;

  it('should not have copyright headers in source files (use LICENSE file)', () => {
    const violations: string[] = [];
    for (const file of allTsFiles()) {
      // Only check the first 10 lines (header area)
      const head = readFileSync(file, 'utf8').split('\n').slice(0, 10).join('\n');
      if (copyrightPattern.test(head)) {
        violations.push(relPath(file));
      }
    }
    expect(violations, `Per-file copyright found:\n${violations.join('\n')}`).toHaveLength(0);
  });
});

describe('em-dash density in shipped markdown', () => {
  // Heavy em-dash use reads as machine-written. Cap each Markdown doc at a
  // natural human level so the shipped prose does not look auto-generated.
  const MAX_EM_DASHES = 4;

  /** Collect all *.md files, skipping vendored/build dirs and CHANGELOG. */
  function collectMarkdown(dir: string): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'build' || entry === '.git') continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...collectMarkdown(full));
      } else if (extname(full) === '.md' && entry !== 'CHANGELOG.md') {
        results.push(full);
      }
    }
    return results;
  }

  it(`should have at most ${MAX_EM_DASHES} em-dashes per file`, () => {
    const violations: string[] = [];
    for (const file of collectMarkdown(ROOT)) {
      const content = readFileSync(file, 'utf8');
      const count = (content.match(/—/g) ?? []).length;
      if (count > MAX_EM_DASHES) {
        violations.push(`${relPath(file)}  has ${count} em-dashes (max ${MAX_EM_DASHES})`);
      }
    }
    expect(violations, `Too many em-dashes:\n${violations.join('\n')}`).toHaveLength(0);
  });
});

describe('publishable package cleans dist before building', () => {
  // A bare `tsc` build leaves orphaned compiled files in dist/ when a source
  // file is renamed or removed (tsc never deletes stale outputs). Since `files`
  // ships all of dist/, those orphans leak into the published tarball. The
  // build must wipe dist/ first.
  it('build wipes dist/ (prebuild rm -rf dist) so no orphans ship', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    const cleansDist = (s: string | undefined): boolean =>
      s !== undefined && /\b(rm -rf|rimraf)\b[^&|]*\bdist\b/.test(s);
    expect(
      cleansDist(scripts.prebuild) || cleansDist(scripts.build),
      'build does not wipe dist/ first (add "prebuild": "rm -rf dist")',
    ).toBe(true);
  });
});

describe('published tarball carries no dangling source-map references', () => {
  // `files` excludes dist/**/*.map because the maps point at ../src/*.ts with no
  // sourcesContent and src/ is not in the tarball, so they resolve to nothing.
  // Excluding the file is only half the change: tsc still appends a
  // `//# sourceMappingURL=` comment to every .js and .d.ts, which then points at
  // a map the tarball does not contain (agents#114). Turn the emit off instead.
  it('does not emit maps that "files" excludes', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      files?: string[];
    };
    const excludesMaps = (pkg.files ?? []).some((f) => f.startsWith('!') && f.endsWith('.map'));

    const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { sourceMap?: boolean; declarationMap?: boolean };
    };
    const opts = tsconfig.compilerOptions ?? {};
    const emitting = (['sourceMap', 'declarationMap'] as const).filter((k) => opts[k] === true);

    expect(
      excludesMaps ? emitting : [],
      `tsconfig turns on ${emitting.join(' + ')} while package.json "files" excludes *.map, ` +
        'so every emitted file would reference a map that never ships. ' +
        'Either drop the "files" exclusion or turn the emit off.',
    ).toHaveLength(0);
  });
});
