import { test, expect } from '@playwright/test';

test('홈 화면 렌더링', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
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

test('KR 전용 UI 정책 확인', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(800);

  await expect(page.getByText('US', { exact: true })).toHaveCount(0);
  await expect(page.getByText('ALL', { exact: true })).toHaveCount(0);
  await expect(page.getByText('미국장')).toHaveCount(0);
  await expect(page.getByText('미국 종목')).toHaveCount(0);
  await expect(page.locator('input[placeholder="한국 종목명 또는 종목코드 검색"]')).toBeVisible();
});

test('모바일 390px 레이아웃 확인', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(800);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await expect(page.getByText('장마감 한줄 요약')).toBeVisible();
});

test('홈 카드 클릭 시 글쓰기 흐름으로 이동', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(1000);

  const firstCard = page.locator('a[href*="#write-flow"]').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();

  await page.waitForURL(/#write-flow$/);
  await expect(page.locator('#write-flow')).toBeVisible();
});
