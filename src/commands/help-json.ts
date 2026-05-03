import { Args } from '@oclif/core';
import { BaseCommand, ErrorCode, ExitCode } from '../base.js';

/** Per-command JSON schema for agent consumption (~200 tokens per command). */
export default class HelpJson extends BaseCommand {
  static override description = 'Get JSON schema for a specific command (agent discovery)';
  static override args = {
    command: Args.string({ description: 'CLI command name (e.g., "api", "discover", "login")', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args } = await this.parse(HelpJson);
    try {
      const plugin = this.config.plugins.get(this.config.pjson.name);
      if (!plugin) {
        this.output({ error: 'Plugin not found' });
        return;
      }
      const cmdId = args.command.replace(/ /g, ':');
      const cmd = plugin.commands.find(
        (c) => c.id === cmdId || c.aliases?.includes(cmdId),
      );
      if (!cmd) {
        this.failWith(ErrorCode.COMMAND_NOT_FOUND, `Command "${args.command}" not found`, ExitCode.USAGE_ERROR, 'Run "agledger list-commands" to see available commands');
      }
      this.output({
        name: cmd.id.replace(/:/g, ' '),
        description: cmd.description ?? '',
        args: Object.fromEntries(
          Object.entries(cmd.args ?? {}).map(([k, v]) => [
            k,
            { description: v.description, required: v.required },
          ]),
        ),
        flags: Object.fromEntries(
          Object.entries(cmd.flags ?? {})
            .filter(([k]) => !['json', 'api-key', 'api-url'].includes(k))
            .map(([k, v]) => [
              k,
              {
                description: v.description,
                required: (v as Record<string, unknown>).required ?? false,
                type: v.type,
              },
            ]),
        ),
      });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('EEXIT:')) throw err;
      this.output({
        error: `Could not load schema for "${args.command}"`,
        suggestion: 'Run "agledger list-commands" to see available commands',
      });
    }
  }
}
