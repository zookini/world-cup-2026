import { defineConfig } from "@playwright/test";

// Stay off 8788, where a manually started `wrangler pages dev` usually lives.
const PORT = 8917;

export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  use: {
    // wrangler doesn't listen on IPv6 localhost, so pin the IPv4 form.
    baseURL: `http://127.0.0.1:${PORT}`,
    // iPhone form factor (see AGENTS.md).
    viewport: { width: 390, height: 844 },
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx wrangler pages dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
