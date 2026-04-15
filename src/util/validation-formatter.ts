/**
 * Pass/fail summary for schema preview and validation results.
 */

import { RED, GREEN, BOLD, RESET } from './colors.js';

interface ValidationError {
  code?: string;
  keyword?: string;
  message: string;
  path?: string;
  instancePath?: string;
}

interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

export function formatValidation(result: ValidationResult): string {
  const errors = result.errors ?? [];
  if (result.valid) {
    return `${GREEN}${BOLD}✓ Valid${RESET}\n`;
  }
  let out = `${RED}${BOLD}✗ Invalid${RESET} — ${errors.length} error${errors.length === 1 ? '' : 's'}\n\n`;
  for (const err of errors) {
    const path = err.path || err.instancePath;
    const pathStr = path ? ` (${path})` : '';
    const code = err.code || err.keyword || 'error';
    out += `  ${RED}•${RESET} [${code}]${pathStr}: ${err.message}\n`;
  }
  return out;
}
