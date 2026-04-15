import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class AgentList extends BaseCommand {
  static override description = 'List agents in an enterprise';
  static override flags = {
    ...BaseCommand.baseFlags,
    enterprise: Flags.string({ description: 'Enterprise ID', required: true }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AgentList);
    try {
      const result = await this.api(flags, 'GET', `/enterprises/${flags.enterprise}/agents`);
      this.outputPage(result as { data: unknown[] }, ['id', 'displayName', 'status', 'createdAt']);
    } catch (err) {
      this.handleError(err);
    }
  }
}
