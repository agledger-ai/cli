/**
 * ANSI escape codes for terminal styling. No external dependencies.
 *
 * Respects NO_COLOR (https://no-color.org): when the NO_COLOR env var is set
 * (any value, including empty string) or stderr is not a TTY, all codes
 * resolve to empty strings so output is plain text.
 */
const disabled = 'NO_COLOR' in process.env || !process.stderr.isTTY;

export const RED = disabled ? '' : '\x1b[31m';
export const GREEN = disabled ? '' : '\x1b[32m';
export const YELLOW = disabled ? '' : '\x1b[33m';
export const BOLD = disabled ? '' : '\x1b[1m';
export const RESET = disabled ? '' : '\x1b[0m';
