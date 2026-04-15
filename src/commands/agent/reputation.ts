import { Args } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class AgentReputation extends BaseCommand {
  static override description = 'Get reputation score for an agent';
  static override args = {
    agentId: Args.string({ description: 'Agent ID', required: true }),
  };
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AgentReputation);
    try {
      const result = await this.api(flags, 'GET', `/agents/${args.agentId}/reputation`);
      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
