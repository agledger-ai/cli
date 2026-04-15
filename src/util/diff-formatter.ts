/**
 * Colored diff output for schema version comparisons.
 * Red for breaking changes, green for additions, yellow for modifications.
 */

import { RED, GREEN, YELLOW, BOLD, RESET } from './colors.js';

interface DiffChange {
  path: string;
  type: string;
  breaking: boolean;
  detail: string;
}

interface DiffResult {
  contractType: string;
  from: { version: number };
  to: { version: number };
  mandate: { changes: DiffChange[] };
  receipt: { changes: DiffChange[] };
  overallCompatibility: { backward: boolean; forward: boolean };
}

function colorForType(type: string, breaking: boolean): string {
  if (breaking) return RED;
  if (type === 'added') return GREEN;
  return YELLOW;
}

function formatChanges(label: string, changes: DiffChange[]): string {
  if (changes.length === 0) return `  ${label}: no changes\n`;
  let out = `  ${label}:\n`;
  const breaking = changes.filter((c) => c.breaking);
  const nonBreaking = changes.filter((c) => !c.breaking);

  if (breaking.length > 0) {
    out += `    ${BOLD}${RED}Breaking (${breaking.length}):${RESET}\n`;
    for (const c of breaking) {
      out += `      ${RED}✗ ${c.path} — ${c.type}: ${c.detail}${RESET}\n`;
    }
  }
  for (const c of nonBreaking) {
    const color = colorForType(c.type, false);
    const symbol = c.type === 'added' ? '+' : '~';
    out += `    ${color}${symbol} ${c.path} — ${c.type}: ${c.detail}${RESET}\n`;
  }
  return out;
}

export function formatDiff(diff: DiffResult): string {
  let out = `${BOLD}${diff.contractType}${RESET}  v${diff.from.version} → v${diff.to.version}\n`;
  const compat = diff.overallCompatibility;
  const backLabel = compat.backward ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const fwdLabel = compat.forward ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  out += `  Backward compatible: ${backLabel}  Forward compatible: ${fwdLabel}\n\n`;
  out += formatChanges('Mandate schema', diff.mandate.changes);
  out += formatChanges('Receipt schema', diff.receipt.changes);
  return out;
}
