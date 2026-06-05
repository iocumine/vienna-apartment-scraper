import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { createEmailer } from '../alerts/email.js';
import { runPoll } from '../jobs/poll.js';
import { runStatsSnapshot } from '../jobs/computeStats.js';

// Manual one-shot poll (npm run poll:once) for testing the scraper end-to-end.
async function main(): Promise<void> {
  const config = loadConfig();
  const repo = openDatabase(config.dbPath);
  const email = config.smtp.user ? createEmailer(config.smtp) : null;
  const result = await runPoll({ repo, config, email });
  runStatsSnapshot({ repo });
  console.log(JSON.stringify(result, null, 2));
  repo.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
