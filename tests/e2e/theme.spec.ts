import { test, expect } from '@playwright/test';

test('the theme switcher applies, remembers and URL-overrides the theme', async ({ page }) => {
    const html = page.locator('html');
    await page.goto('/');
    await expect(html).not.toHaveAttribute('data-theme');

    await page.getByRole('button', { name: 'Harmonies', exact: true }).click();
    await expect(html).toHaveAttribute('data-theme', 'harmonies-bold');
    await expect(page.getByRole('button', { name: 'Harmonies', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'harmonies-bold');

    await page.goto('/rules?theme=box-art');
    await expect(html).not.toHaveAttribute('data-theme');
    await page.goto('/rules');
    await expect(html).not.toHaveAttribute('data-theme');

    await page.goto('/rules?theme=harmonies-bold');
    await expect(html).toHaveAttribute('data-theme', 'harmonies-bold');
    await page.getByRole('button', { name: 'Box-art', exact: true }).click();
    await expect(html).not.toHaveAttribute('data-theme');
    await page.goto('/rules'); // not reload(): that would keep ?theme= and re-apply B
    await expect(html).not.toHaveAttribute('data-theme');
});
