import 'dotenv/config';
import cron from 'node-cron';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { createEmailer } from './alerts/email.js';
import { runPoll } from './jobs/poll.js';
import { runStatsSnapshot } from './jobs/computeStats.js';
import { runDailyReport } from './jobs/dailyReport.js';
import { createServer } from './web/server.js';
import type { Emailer } from './types.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const repo = openDatabase(config.dbPath, {
    verificationMissThresholdMin: config.verificationMissThresholdMin,
    verificationMissThresholdMax: config.verificationMissThresholdMax,
  });

  const email: Emailer | null = config.smtp.user ? createEmailer(config.smtp) : null;
  if (!email) console.warn('SMTP not configured (SMTP_USER missing) - email disabled.');

  const opts = { timezone: config.timezone };
  cron.schedule(
    config.pollCron,
    () => {
      runPoll({ repo, config, email }).catch((err) =>
        console.error(`poll failed: ${(err as Error).message}`),
      );
    },
    opts,
  );
  cron.schedule(config.statsCron, () => runStatsSnapshot({ repo }), opts);
  cron.schedule(
    config.dailyReportCron,
    () => {
      runDailyReport({ repo, config, email }).catch((err) =>
        console.error(`daily report failed: ${(err as Error).message}`),
      );
    },
    opts,
  );

  // Kick off an initial poll so we have data without waiting for the first cron tick.
  runPoll({ repo, config, email }).catch((err) =>
    console.error(`initial poll failed: ${(err as Error).message}`),
  );

  const app = createServer(repo, config);
  app.listen(config.port, () => {
    console.log(`Dashboard listening on http://localhost:${config.port}`);
    console.log(
      `Polling "${config.pollCron}" for ${config.transactionType} in districts ${config.districts.join(', ')}`,
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
