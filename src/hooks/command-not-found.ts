import type { Hook } from '@oclif/core';

/**
 * Unknown commands printed only "command X not found", with no nearest match
 * and no pointer to how to find the real one (agents#107). An agent that
 * guessed a verb had nothing to recover from, which matters here because the
 * CLI deliberately has few commands: almost everything goes through
 * `agledger api`, and a wrong guess is the expected first move.
 */

/** Levenshtein distance, iterative two-row form. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const substitute = previous[j]! + (a[i] === b[j] ? 0 : 1);
      current.push(Math.min(current[j]! + 1, previous[j + 1]! + 1, substitute));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** Closest command id, when it is close enough to be worth suggesting. */
function nearest(id: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = distance(id.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // Scale with the length of what was typed so short ids don't match everything.
  return best !== undefined && bestScore <= Math.max(2, Math.floor(id.length / 2))
    ? best
    : undefined;
}

const hook: Hook<'command_not_found'> = async function (opts) {
  const id = opts.id;
  const ids = opts.config.commandIDs;
  const suggestion = nearest(id, ids);

  const parts = [
    suggestion ? `Did you mean \`agledger ${suggestion}\`?` : undefined,
    'Run `agledger list-commands` to see every command.',
    // The real surface area is the API passthrough, not the command list.
    'Most operations go through `agledger api <METHOD> <PATH>`, which reaches every route.',
  ].filter(Boolean);

  process.stderr.write(
    JSON.stringify({
      error: true,
      code: 'COMMAND_NOT_FOUND',
      message: `Command "${id}" not found.`,
      ...(suggestion ? { didYouMean: suggestion } : {}),
      suggestion: parts.join(' '),
    }) + '\n',
  );
  // 2 = usage error, matching the exit code oclif already used for this case.
  process.exit(2);
};

export default hook;
