/**
 * Server health check cron — monitors memory usage and PM2 restarts.
 *
 * Runs every 5 minutes. Creates alerts when thresholds are exceeded.
 */

const { execFile } = require('child_process');

async function serverHealth(alertManager) {
  // Check memory usage
  const mem = process.memoryUsage();
  const heapPercent = (mem.heapUsed / mem.heapTotal) * 100;

  const config = alertManager.getConfig();
  const memThreshold = config.serverMemoryWarningPercent || 85;

  if (heapPercent > memThreshold) {
    await alertManager.createAlert(
      'high_memory',
      'warning',
      'High server memory usage',
      `Heap usage at ${heapPercent.toFixed(1)}% (threshold: ${memThreshold}%)`,
      {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        heapPercent: Math.round(heapPercent * 10) / 10,
      }
    );
  }

  // Check PM2 restart count (best-effort)
  if (config.pm2RestartAlert) {
    try {
      await new Promise((resolve) => {
        execFile('npx', ['pm2', 'jlist'], { timeout: 10000 }, (err, stdout) => {
          if (err || !stdout) {
            resolve();
            return;
          }
          try {
            const processes = JSON.parse(stdout);
            for (const proc of processes) {
              if (proc.pm2_env && proc.pm2_env.restart_time > 0) {
                alertManager.createAlert(
                  'pm2_restart',
                  'warning',
                  `PM2 process restarted: ${proc.name}`,
                  `Restart count: ${proc.pm2_env.restart_time}`,
                  { processName: proc.name, restartCount: proc.pm2_env.restart_time }
                );
              }
            }
          } catch (_parseErr) {
            // Skip if can't parse
          }
          resolve();
        });
      });
    } catch (_pm2Err) {
      // Skip PM2 check on failure
    }
  }
}

module.exports = serverHealth;
