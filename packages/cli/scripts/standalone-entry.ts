import { main } from '../src/index.js';

main(process.argv.slice(2)).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`metabot: ${msg}\n`);
  process.exit(1);
});
