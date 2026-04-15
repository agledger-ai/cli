import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateCreate extends BaseCommand {
  static override description = 'Create a new mandate';
  static override flags = {
    ...BaseCommand.baseFlags,
    type: Flags.string({ description: 'Contract type (e.g., ACH-PROC-v1)', required: true }),
    performer: Flags.string({ description: 'Performer agent ID' }),
    data: Flags.string({ description: 'Mandate data as JSON string' }),
    file: Flags.file({ description: 'Read mandate data from JSON file' }),
    'max-submissions': Flags.integer({ description: 'Max receipt submissions allowed (1-100)' }),
    activate: Flags.boolean({ description: 'Auto-activate the mandate (CREATED \u2192 ACTIVE)', default: false }),
    'dry-run': Flags.boolean({ description: 'Show what would be sent without hitting the API', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MandateCreate);
    try {
      let data: Record<string, unknown> = {};
      if (flags.file) {
        data = JSON.parse(readFileSync(flags.file, 'utf-8'));
      } else if (flags.data) {
        data = JSON.parse(flags.data);
      }

      const params: Record<string, unknown> = {
        contractType: flags.type,
        ...data,
      };
      if (flags.performer) params.performerAgentId = flags.performer;
      if (flags['max-submissions']) params.maxSubmissions = flags['max-submissions'];
      if (flags.activate) params.autoActivate = true;

      if (flags['dry-run']) {
        process.stderr.write('Dry run \u2014 would send:\n');
        this.output(params);
        return;
      }

      // Agent keys use the agent endpoint, principal keys use the standard endpoint
      const apiKey = flags['api-key'] || '';
      const useAgentEndpoint = apiKey.startsWith('ach_age_') || !!flags.performer;
      const path = useAgentEndpoint ? '/mandates/agent' : '/mandates';
      const result = await this.api(flags, 'POST', path, { body: params });

      this.output(result);
    } catch (err) {
      this.handleError(err);
    }
  }
}
