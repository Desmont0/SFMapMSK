import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'browser.spec.ts',fullyParallel:false,workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:18765',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[
    {name:'chromium',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}},
    {name:'webkit',use:{...devices['iPhone 13']}},
  ],
  webServer:{command:'npx tsx tests/browser-server.ts',url:'http://127.0.0.1:18765/api/health',reuseExistingServer:false,timeout:30000},
});
