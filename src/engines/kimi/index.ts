import type { BotConfigBase } from '../../config.js';
import type { Logger } from '../../utils/logger.js';
import type { Engine, Executor } from '../types.js';
import { StreamProcessor } from '../claude/stream-processor.js';
import { KimiExecutor } from './executor.js';

/**
 * Kimi engine. Uses Kimi Code's official local Server API and reuses the
 * Claude `StreamProcessor`, translating atomic frontend snapshots into the
 * shared card event shape.
 */
export class KimiEngine implements Engine {
  readonly name = 'kimi' as const;

  constructor(
    private config: BotConfigBase,
    private logger: Logger,
  ) {}

  createExecutor(): Executor {
    return new KimiExecutor(this.config, this.logger);
  }

  createStreamProcessor(userPrompt: string): StreamProcessor {
    return new StreamProcessor(userPrompt);
  }
}

export { KimiExecutor } from './executor.js';
