import { Args, allFlags } from '../cli/index.js';
import { loadCommand } from '../cli/main.js';
import { BaseCommand, ErrorCode, ExitCode } from '../base.js';

/** Per-command JSON schema for agent consumption (~200 tokens per command). */
export default class HelpJson extends BaseCommand {
  static override description = 'Get JSON schema for a specific command (agent discovery)';
  static override args = {
    command: Args.string({ description: 'CLI command name (e.g., "api", "discover", "login")', required: true }),
  };
  static override flags = { ...BaseCommand.offlineFlags };

  async run(): Promise<void> {
    const { args } = await this.parse(HelpJson);
    const cmd = await loadCommand(args.command);
    if (!cmd) {
      this.failWith(ErrorCode.COMMAND_NOT_FOUND, `Command "${args.command}" not found`, ExitCode.USAGE_ERROR, 'Run "agledger list-commands" to see available commands');
    }
    this.output({
      name: args.command,
      description: cmd.description ?? '',
      args: Object.fromEntries(
        Object.entries(cmd.args ?? {}).map(([k, v]) => [
          k,
          { description: v.description, required: v.required },
        ]),
      ),
      flags: Object.fromEntries(
        Object.entries(allFlags(cmd))
          .filter(([k]) => !['json', 'api-key', 'api-url'].includes(k))
          .map(([k, v]) => [
            k,
            {
              description: v.description,
              required: v.type === 'option' ? (v.required ?? false) : false,
              type: v.type,
              // Surface the short alias (e.g. -F for --field) so a doc that
              // shows the short form can be verified against this schema.
              ...(v.char ? { char: v.char } : {}),
            },
          ]),
      ),
    });
  }
}
