import { expect, test } from '@playwright/test';

const authSession = {
  userId: 'user-123',
  accessToken: 'access-token',
  expiresAt: 4_102_444_800,
  roles: ['user'],
  name: 'Kitchen Operator',
};

test('moves from marketing to login and protects the creator route', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('marketing-login-cta').click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/app/print/new');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test('submits a label, shows a toast link, and polls the status page to a terminal state', async ({ page }) => {
  let statusReads = 0;

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: 'leftover-label-printer.auth-session',
      value: authSession,
    }
  );

  await page.route('**/api/v1/print-jobs', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }

    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({
      printerId: 'printer-1',
      templateId: 'label-default',
      templateVersion: 'v1',
      payload: {
        itemName: 'Chicken soup',
        datePrepared: '2026-03-18',
      },
    });

    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        jobId: 'job-123',
        state: 'pending',
        acceptedAt: '2026-03-18T17:00:00.000Z',
        traceId: 'trace-1',
      }),
    });
  });

  await page.route('**/api/v1/print-jobs/job-123', async (route) => {
    statusReads += 1;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jobId: 'job-123',
        state: statusReads > 1 ? 'printed' : 'processing',
        printerId: 'printer-1',
        templateId: 'label-default',
        templateVersion: 'v1',
        events: [
          {
            eventId: 'event-1',
            jobId: 'job-123',
            type: 'pending',
            source: 'backend',
            occurredAt: '2026-03-18T17:00:00.000Z',
          },
          {
            eventId: 'event-2',
            jobId: 'job-123',
            type: statusReads > 1 ? 'printed' : 'processing',
            source: statusReads > 1 ? 'agent' : 'backend',
            occurredAt: '2026-03-18T17:00:05.000Z',
          },
        ],
      }),
    });
  });

  await page.goto('/app/print/new');
  await page.getByTestId('item-name-input').fill('Chicken soup');
  await page.getByTestId('date-prepared-input').fill('2026-03-18');
  await page.getByTestId('submit-print-button').click();

  await expect(page.getByTestId('submission-toast')).toBeVisible();
  await page.getByTestId('toast-status-link').click();

  await expect(page.getByTestId('job-status-title')).toContainText('job-123');
  await expect(page.getByTestId('job-status-state')).toContainText('processing');

  await page.waitForTimeout(5500);

  await expect(page.getByTestId('job-status-state')).toContainText('printed');
});

test('shows client-side validation before submitting an empty label', async ({ page }) => {
  let createRequests = 0;

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: 'leftover-label-printer.auth-session',
      value: authSession,
    }
  );

  await page.route('**/api/v1/print-jobs', async (route) => {
    createRequests += 1;
    await route.abort();
  });

  await page.goto('/app/print/new');
  await page.getByTestId('submit-print-button').click();

  await expect(page.getByTestId('item-name-error')).toBeVisible();
  expect(createRequests).toBe(0);
});
