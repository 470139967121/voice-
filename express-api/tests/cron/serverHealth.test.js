const serverHealth = require('../../src/cron/serverHealth');

describe('serverHealth', () => {
  test('creates alert on high memory usage', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 50, // Low threshold to trigger
        pm2RestartAlert: false,
      }),
    };

    // Mock process.memoryUsage to return high usage
    const originalMemUsage = process.memoryUsage;
    process.memoryUsage = () => ({
      heapUsed: 900 * 1024 * 1024,   // 900MB
      heapTotal: 1000 * 1024 * 1024,  // 1000MB (90% usage)
      rss: 1100 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    });

    await serverHealth(mockManager);

    expect(createAlert).toHaveBeenCalledTimes(1);
    expect(createAlert).toHaveBeenCalledWith(
      'high_memory',
      'warning',
      'High server memory usage',
      expect.stringContaining('90.0%'),
      expect.objectContaining({
        heapUsedMB: 900,
        heapTotalMB: 1000,
      })
    );

    process.memoryUsage = originalMemUsage;
  });

  test('does nothing when memory is normal', async () => {
    const createAlert = jest.fn().mockResolvedValue(undefined);
    const mockManager = {
      createAlert,
      getConfig: () => ({
        serverMemoryWarningPercent: 85,
        pm2RestartAlert: false,
      }),
    };

    // Mock low memory usage
    const originalMemUsage = process.memoryUsage;
    process.memoryUsage = () => ({
      heapUsed: 100 * 1024 * 1024,   // 100MB
      heapTotal: 500 * 1024 * 1024,   // 500MB (20% usage)
      rss: 200 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    });

    await serverHealth(mockManager);

    expect(createAlert).not.toHaveBeenCalled();

    process.memoryUsage = originalMemUsage;
  });
});
