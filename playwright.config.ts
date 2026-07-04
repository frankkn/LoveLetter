import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 30_000,
    expect: {
        timeout: 7_000
    },
    fullyParallel: false,
    reporter: [['list']],
    use: {
        baseURL: 'http://127.0.0.1:5173',
        trace: 'on-first-retry'
    },
    webServer: [
        {
            command: 'npx tsc -p tsconfig.playwright-server.json && node .temp/colyseus-test/tests/support/colyseus-test-server.js',
            url: 'http://127.0.0.1:2567/health',
            timeout: 15_000,
            reuseExistingServer: false
        },
        {
            command: 'npm run dev -- --host 127.0.0.1 --port 5173',
            url: 'http://127.0.0.1:5173',
            timeout: 20_000,
            reuseExistingServer: !process.env.CI
        }
    ],
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                // The audio regression tests (music-next-round.spec.ts) assert on
                // real Audio.play() state. Headless Chromium's autoplay policy
                // occasionally rejects play() under parallel load even after a
                // click gesture, which resets the app's audio state and flakes
                // the first BGM assertion. Allow autoplay unconditionally.
                launchOptions: {
                    args: ['--autoplay-policy=no-user-gesture-required']
                }
            }
        }
    ]
});
