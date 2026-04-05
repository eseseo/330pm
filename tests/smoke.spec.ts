import { test, expect } from '@playwright/test';

test('홈 화면 렌더링', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  await page.screenshot({ path: 'test-results/home.png', fullPage: true });
});

test('입력 UI 존재 확인', async ({ page }) => {
  await page.goto('/');

  const input = page.locator('textarea, input[type="text"]');

  await expect(input.first()).toBeVisible();
});

test('콘솔 에러 체크', async ({ page }) => {
  const errors: string[] = [];

  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  page.on('pageerror', err => {
    errors.push(err.message);
  });

  await page.goto('/');
  await page.waitForTimeout(1500);

  console.log('Errors:', errors);
});
