/**
 * Puppeteer configuration.
 *
 * In Docker (CHROMIUM_PATH set), skip downloading Chromium — use the system one.
 * Locally, let Puppeteer download its own Chrome.
 */
const config = {};

if (process.env.CHROMIUM_PATH) {
	config.skipDownload = true;
}

module.exports = config;
