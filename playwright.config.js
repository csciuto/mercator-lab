const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:8090' },
  webServer: {
    command: 'python3 -m http.server 8090',
    url: 'http://localhost:8090',
    reuseExistingServer: !process.env.CI,
  },
});
