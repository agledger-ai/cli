import { BaseCommand } from '../../base.js';

export default class SchemaList extends BaseCommand {
  static override description = 'List available contract type schemas';
  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    const { flags } = await this.parse(SchemaList);
    try {
      const result = await this.api(flags, 'GET', '/schemas');
      this.outputPage(result as { data: unknown[] }, ['contractType', 'displayName', 'category']);
    } catch (err) {
      this.handleError(err);
    }
  }
}
