import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class MandateList extends BaseCommand {
  static override description = 'List mandates with optional filters';
  static override flags = {
    ...BaseCommand.baseFlags,
    status: Flags.string({ description: 'Filter by mandate status (CREATED, ACTIVE, PROCESSING, REVISION_REQUESTED, FULFILLED, FAILED, REMEDIATED, EXPIRED, CANCELLED)' }),
    type: Flags.string({ description: 'Filter by contract type (e.g., ACH-PROC-v1)' }),
    limit: Flags.integer({ description: 'Max results per page', default: 25 }),
    cursor: Flags.string({ description: 'Pagination cursor' }),
    all: Flags.boolean({ description: 'Stream all pages as NDJSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MandateList);
    try {
      const query: Record<string, unknown> = { limit: flags.limit };
      if (flags.status) query.status = flags.status;
      if (flags.type) query.contractType = flags.type;
      if (flags.cursor) query.cursor = flags.cursor;

      await this.paginate(flags, '/mandates', query, {
        all: flags.all,
        columns: ['id', 'status', 'contractType', 'createdAt'],
      });
    } catch (err) {
      this.handleError(err);
    }
  }
}
