import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base.js';

export default class AuditEvents extends BaseCommand {
  static override description = 'List audit events';
  static override flags = {
    ...BaseCommand.baseFlags,
    since: Flags.string({ description: 'ISO 8601 timestamp \u2014 list events after this time', required: true }),
    order: Flags.string({ description: 'Sort order', options: ['asc', 'desc'], default: 'desc' }),
    limit: Flags.integer({ description: 'Max results per page', default: 25 }),
    cursor: Flags.string({ description: 'Pagination cursor' }),
    all: Flags.boolean({ description: 'Stream all pages as NDJSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AuditEvents);
    try {
      const query: Record<string, unknown> = {
        since: flags.since,
        order: flags.order,
        limit: flags.limit,
      };
      if (flags.cursor) query.cursor = flags.cursor;

      await this.paginate(flags, '/events', query, {
        all: flags.all,
        columns: ['id', 'eventType', 'mandateId', 'timestamp'],
      });
    } catch (err) {
      this.handleError(err);
    }
  }
}
