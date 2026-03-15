import { test, expect } from '@playwright/test';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';

const TEST_USER_ID = '10000001';

test.describe('Admin Users - Economy Subtab', () => {

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Users');
    await searchUser(page, TEST_USER_ID);
    await switchUserSubtab(page, 'economy');
  });

  test('coins operation select and amount input exist', async ({ page }) => {
    // Coins operation dropdown
    const coinsOp = page.locator('#eco-coins-op');
    await expect(coinsOp).toBeVisible();

    const coinsOptions = await coinsOp.locator('option').allTextContents();
    expect(coinsOptions).toContain('Add');
    expect(coinsOptions).toContain('Deduct');

    // Coins amount input
    const coinsAmount = page.locator('#eco-coins-amount');
    await expect(coinsAmount).toBeVisible();

    // Apply button
    const coinsApply = page.locator('#eco-coins-apply');
    await expect(coinsApply).toBeVisible();

    // Coins display
    const coinsDisplay = page.locator('#eco-coins-display');
    await expect(coinsDisplay).toBeVisible();
  });

  test('beans operation select and amount input exist', async ({ page }) => {
    // Beans operation dropdown
    const beansOp = page.locator('#eco-beans-op');
    await expect(beansOp).toBeVisible();

    const beansOptions = await beansOp.locator('option').allTextContents();
    expect(beansOptions).toContain('Add');
    expect(beansOptions).toContain('Deduct');

    // Beans amount input
    const beansAmount = page.locator('#eco-beans-amount');
    await expect(beansAmount).toBeVisible();

    // Apply button
    const beansApply = page.locator('#eco-beans-apply');
    await expect(beansApply).toBeVisible();

    // Beans display
    const beansDisplay = page.locator('#eco-beans-display');
    await expect(beansDisplay).toBeVisible();
  });

  test('backpack section with search, category filter, gift select', async ({ page }) => {
    // Backpack search input
    const backpackSearch = page.locator('#backpack-search');
    await expect(backpackSearch).toBeVisible();

    // Category filter dropdown
    const categoryFilter = page.locator('#backpack-category-filter');
    await expect(categoryFilter).toBeVisible();

    // Gift select dropdown for adding gifts
    const giftSelect = page.locator('#backpack-gift-select');
    await expect(giftSelect).toBeVisible();

    // Quantity input
    const qtyInput = page.locator('#backpack-qty');
    await expect(qtyInput).toBeVisible();

    // Add button
    const addBtn = page.locator('#backpack-add-btn');
    await expect(addBtn).toBeVisible();

    // Clear All button
    const clearAllBtn = page.locator('#backpack-clear-btn');
    await expect(clearAllBtn).toBeVisible();

    // Backpack grid container
    const backpackGrid = page.locator('#backpack-grid');
    await expect(backpackGrid).toBeAttached();
  });

  test('transactions section with type filter and load button', async ({ page }) => {
    // Transaction type filter
    const txTypeFilter = page.locator('#tx-type-filter');
    await expect(txTypeFilter).toBeVisible();

    // Verify all transaction types are available
    const txOptions = await txTypeFilter.locator('option').allTextContents();
    expect(txOptions).toContain('All Types');
    expect(txOptions).toContain('Purchase');
    expect(txOptions).toContain('Gacha Pull');
    expect(txOptions).toContain('Gift Sent');
    expect(txOptions).toContain('Gift Received');
    expect(txOptions).toContain('Bean Redeem');
    expect(txOptions).toContain('Daily Reward');
    expect(txOptions).toContain('Subscription');
    expect(txOptions).toContain('Admin Adjustment');
    expect(txOptions).toContain('Admin Backpack');

    // Load button
    const loadBtn = page.locator('#tx-load-btn');
    await expect(loadBtn).toBeVisible();

    // Transaction list container
    const txList = page.locator('#tx-list');
    await expect(txList).toBeAttached();
  });
});
