import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const baseUrl = process.env.BROWSER_BASE_URL ?? 'http://127.0.0.1:3101';
const outputDir = process.env.BROWSER_OUTPUT_DIR
  ?? path.resolve(process.cwd(), 'screenshots/auth-product-flow/demo-final');
const executablePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

await fs.mkdir(outputDir, { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const layoutChecks = [];

function observe(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({ label, text: message.text() });
  });
  page.on('pageerror', (error) => pageErrors.push({ label, text: error.message }));
}

async function waitForPath(page, pathname) {
  await page.waitForFunction(
    (expected) => window.location.pathname === expected,
    { timeout: 20_000 },
    pathname,
  );
}

async function waitForText(page, text) {
  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    { timeout: 20_000 },
    text,
  );
}

async function clickButton(page, text) {
  const clicked = await page.evaluate((label) => {
    const button = [...document.querySelectorAll('button')]
      .find((element) => element.textContent?.trim().includes(label));
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Button not found: ${text}`);
}

async function checkLayout(page, label, expectedDark) {
  const result = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    dark: document.documentElement.classList.contains('dark'),
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
  }));
  const check = {
    label,
    ...result,
    noHorizontalOverflow: result.scrollWidth <= result.width,
  };
  layoutChecks.push(check);
  if (!check.noHorizontalOverflow) throw new Error(`${label} has horizontal overflow`);
  if (check.dark !== expectedDark) throw new Error(`${label} dark state was ${check.dark}`);
  if (expectedDark && !check.colorScheme.includes('dark')) {
    throw new Error(`${label} did not apply the dark color scheme`);
  }
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const studentContext = await browser.createBrowserContext();
  const student = await studentContext.newPage();
  observe(student, 'desktop-student-demo');
  await student.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await student.goto(`${baseUrl}/zh/demo`, { waitUntil: 'networkidle2' });
  await waitForText(student, 'CareerPilot 产品演示');
  const demoCopy = await student.locator('body').map((element) => element.innerText).wait();
  if (!demoCopy.includes('学生演示') || !demoCopy.includes('教师工作台')) {
    throw new Error('Independent demo entry does not expose both seeded scenarios');
  }
  await student.screenshot({ path: path.join(outputDir, 'demo-entry-desktop-light.png'), fullPage: true });
  await checkLayout(student, 'demo-entry-desktop-light', false);

  await clickButton(student, '学生演示');
  await waitForPath(student, '/zh/dashboard');
  await waitForText(student, '示例简历 - 陈思远');
  const studentBody = await student.locator('body').map((element) => element.innerText).wait();
  if (studentBody.includes('今日指导工作台')) {
    throw new Error('Student demo exposed the teacher workbench');
  }
  await student.screenshot({ path: path.join(outputDir, 'student-dashboard-desktop-light.png'), fullPage: true });
  await checkLayout(student, 'student-dashboard-desktop-light', false);
  await studentContext.close();

  const teacherContext = await browser.createBrowserContext();
  const teacher = await teacherContext.newPage();
  observe(teacher, 'mobile-teacher-demo');
  await teacher.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await teacher.evaluateOnNewDocument(() => localStorage.setItem('theme', 'dark'));
  await teacher.goto(`${baseUrl}/zh/demo`, { waitUntil: 'networkidle2' });
  await waitForText(teacher, 'CareerPilot 产品演示');
  await checkLayout(teacher, 'demo-entry-mobile-dark', true);
  await teacher.screenshot({ path: path.join(outputDir, 'demo-entry-mobile-dark.png'), fullPage: true });

  await clickButton(teacher, '教师工作台');
  await waitForPath(teacher, '/zh/teacher');
  await waitForText(teacher, '今日指导工作台');
  const teacherBody = await teacher.locator('body').map((element) => element.innerText).wait();
  if (!teacherBody.includes('最近需要关注') || !teacherBody.includes('陈思远')) {
    throw new Error('Teacher demo did not expose its explicitly assigned student');
  }
  await checkLayout(teacher, 'teacher-workbench-mobile-dark', true);
  await teacher.screenshot({ path: path.join(outputDir, 'teacher-workbench-mobile-dark.png'), fullPage: true });
  await teacherContext.close();

  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  }

  const results = {
    passed: true,
    studentUrl: `${baseUrl}/zh/dashboard`,
    teacherUrl: `${baseUrl}/zh/teacher`,
    layoutChecks,
    consoleErrors,
    pageErrors,
  };
  await fs.writeFile(
    path.join(outputDir, 'demo-browser-results.json'),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
