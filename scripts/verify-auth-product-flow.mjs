import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const baseUrl = process.env.BROWSER_BASE_URL ?? 'http://127.0.0.1:3100';
const serverLog = process.env.BROWSER_SERVER_LOG;
const outputDir = process.env.BROWSER_OUTPUT_DIR
  ?? path.resolve(process.cwd(), 'screenshots/auth-product-flow');
const executablePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

if (!serverLog) throw new Error('BROWSER_SERVER_LOG is required');

await fs.mkdir(outputDir, { recursive: true });

const email = `browser-auth-${Date.now()}@example.test`;
const consoleErrors = [];
const pageErrors = [];
const layoutChecks = [];
const fingerprintRequests = [];

function observe(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({ label, text: message.text() });
  });
  page.on('pageerror', (error) => pageErrors.push({ label, text: error.message }));
  page.on('request', (request) => {
    if (request.headers()['x-fingerprint']) {
      fingerprintRequests.push({ label, url: request.url() });
    }
  });
}

async function waitForPath(page, pathname) {
  await page.waitForFunction(
    (expected) => window.location.pathname === expected,
    { timeout: 20_000 },
    pathname,
  );
}

async function checkLayout(page, label) {
  const result = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    dark: document.documentElement.classList.contains('dark'),
  }));
  layoutChecks.push({ label, ...result, noHorizontalOverflow: result.scrollWidth <= result.width });
}

async function requireDarkTheme(page, label) {
  await page.waitForFunction(
    () => document.documentElement.classList.contains('dark'),
    { timeout: 10_000 },
  );
  const colorScheme = await page.evaluate(
    () => getComputedStyle(document.documentElement).colorScheme,
  );
  if (!colorScheme.includes('dark')) {
    throw new Error(`${label} did not apply the dark color scheme`);
  }
}

async function clickButton(page, text) {
  const clicked = await page.evaluate((label) => {
    const candidates = [...document.querySelectorAll('button')];
    const button = candidates.find((element) => element.textContent?.trim().includes(label));
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Button not found: ${text}`);
}

async function clickLink(page, text) {
  const clicked = await page.evaluate((label) => {
    const candidates = [...document.querySelectorAll('a')];
    const link = candidates.find((element) => element.textContent?.trim() === label && element.getClientRects().length > 0);
    if (!(link instanceof HTMLElement)) return false;
    link.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Link not found: ${text}`);
}

async function requestOtp(page, targetEmail) {
  const start = (await fs.readFile(serverLog, 'utf8').catch(() => '')).length;
  await page.type('input[type="email"]', targetEmail);
  await clickButton(page, '获取验证码');
  await page.waitForSelector('input[autocomplete="one-time-code"]');

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const log = await fs.readFile(serverLog, 'utf8').catch(() => '');
    const fresh = log.slice(start);
    const escaped = targetEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = fresh.match(new RegExp(`To: ${escaped} \\| Code: (\\d{6})`));
    if (match) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`OTP was not written for ${targetEmail}`);
}

async function verifyOtp(page, code) {
  await page.type('input[autocomplete="one-time-code"]', code);
  await clickButton(page, '验证');
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  observe(page, 'desktop-product');
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('jade_fingerprint', 'legacy-browser-fingerprint');
  });

  await page.goto(`${baseUrl}/zh`, { waitUntil: 'networkidle2' });
  const ctas = await page.$$eval('a', (links) => links
    .filter((link) => ['立即开始', '免费开始制作', '立即创建简历'].includes(link.textContent?.trim() ?? ''))
    .map((link) => ({ text: link.textContent?.trim(), href: link.href })));
  if (ctas.length < 3) throw new Error(`Expected all product CTAs, found ${ctas.length}`);
  for (const cta of ctas) {
    const url = new URL(cta.href);
    if (url.pathname !== '/zh/login' || url.searchParams.get('callbackUrl') !== '/zh/dashboard') {
      throw new Error(`Incorrect CTA target: ${cta.text} -> ${cta.href}`);
    }
  }

  await clickLink(page, '立即开始');
  await waitForPath(page, '/zh/login');
  if (new URL(page.url()).searchParams.get('callbackUrl') !== '/zh/dashboard') {
    throw new Error(`CTA callback was not preserved: ${page.url()}`);
  }
  const loginCopy = await page.locator('body').map((element) => element.innerText).wait();
  if (!loginCopy.includes('首次使用新邮箱验证后会自动创建账户')) {
    throw new Error('Automatic registration copy is missing');
  }
  if (!loginCopy.includes('使用 Google 登录')) throw new Error('Google login is missing');
  if (loginCopy.includes('学生演示') || loginCopy.includes('Anonymous User')) {
    throw new Error('Product login exposed a demo identity');
  }
  await page.screenshot({ path: path.join(outputDir, 'product-login-desktop-light.png'), fullPage: true });
  await checkLayout(page, 'product-login-desktop-light');

  await page.goto(`${baseUrl}/zh/dashboard?view=list`, { waitUntil: 'networkidle2' });
  await waitForPath(page, '/zh/login');
  if (new URL(page.url()).searchParams.get('callbackUrl') !== '/zh/dashboard?view=list') {
    throw new Error(`Direct dashboard callback was not preserved: ${page.url()}`);
  }

  const demoResponse = await fetch(`${baseUrl}/zh/demo`, { redirect: 'manual' });
  if (demoResponse.status !== 404) throw new Error(`Product /demo returned ${demoResponse.status}`);

  await page.goto(`${baseUrl}/zh/login?callbackUrl=%2Fzh%2Fdashboard`, { waitUntil: 'networkidle2' });
  const firstCode = await requestOtp(page, email);
  await verifyOtp(page, firstCode);
  await waitForPath(page, '/zh/onboarding');
  await page.screenshot({ path: path.join(outputDir, 'new-user-onboarding-desktop-light.png'), fullPage: true });
  await checkLayout(page, 'new-user-onboarding-desktop-light');

  const inputs = await page.$$('form input:not([type="checkbox"])');
  const values = ['Browser User', 'Career University', 'Computer Science', '2027', 'Software Engineering'];
  if (inputs.length !== values.length) throw new Error(`Expected ${values.length} onboarding inputs, found ${inputs.length}`);
  for (let index = 0; index < inputs.length; index += 1) {
    await inputs[index].type(values[index]);
  }
  const checkboxes = await page.$$('form input[type="checkbox"]');
  for (const checkbox of checkboxes) await checkbox.click();
  await clickButton(page, '保存并进入工作台');
  await waitForPath(page, '/zh/dashboard');
  await page.waitForSelector('header');
  await page.screenshot({ path: path.join(outputDir, 'new-user-dashboard-desktop-light.png'), fullPage: true });
  await checkLayout(page, 'new-user-dashboard-desktop-light');
  const productBody = await page.locator('body').map((element) => element.innerText).wait();
  if (productBody.includes('学生演示') || productBody.includes('教师工作台演示') || productBody.includes('Anonymous User')) {
    throw new Error('Authenticated product UI exposed a demo identity');
  }

  const existingContext = await browser.createBrowserContext();
  const mobile = await existingContext.newPage();
  observe(mobile, 'mobile-existing-user');
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await mobile.evaluateOnNewDocument(() => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('jade_fingerprint', 'legacy-browser-fingerprint');
  });
  await mobile.goto(`${baseUrl}/zh/login?callbackUrl=%2Fzh%2Fdashboard`, { waitUntil: 'networkidle2' });
  await requireDarkTheme(mobile, 'product-login-mobile-dark');
  await mobile.screenshot({ path: path.join(outputDir, 'product-login-mobile-dark.png'), fullPage: true });
  await checkLayout(mobile, 'product-login-mobile-dark');

  const secondCode = await requestOtp(mobile, email);
  await verifyOtp(mobile, secondCode);
  await waitForPath(mobile, '/zh/dashboard');
  if (mobile.url().includes('/onboarding')) throw new Error('Existing email was sent through onboarding again');
  await requireDarkTheme(mobile, 'existing-user-dashboard-mobile-dark');
  await mobile.screenshot({ path: path.join(outputDir, 'existing-user-dashboard-mobile-dark.png'), fullPage: true });
  await checkLayout(mobile, 'existing-user-dashboard-mobile-dark');
  await existingContext.close();

  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  }
  if (fingerprintRequests.length) {
    throw new Error(`Product requests sent a fingerprint header: ${JSON.stringify(fingerprintRequests)}`);
  }
  if (layoutChecks.some((check) => !check.noHorizontalOverflow)) {
    throw new Error(`Horizontal overflow: ${JSON.stringify(layoutChecks)}`);
  }

  const results = {
    passed: true,
    email,
    ctas,
    finalDesktopUrl: page.url(),
    layoutChecks,
    consoleErrors,
    pageErrors,
    fingerprintRequests,
  };
  await fs.writeFile(
    path.join(outputDir, 'product-browser-results.json'),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
