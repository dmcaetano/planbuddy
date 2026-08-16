import { test, expect } from "@playwright/test";

function uniqueEmail(): string {
  return `e2e-timeleft-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test("one-tap 'time left' button plans without touching the spec form", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Where are you based?")).toBeVisible();
  await page.getByLabel("Home city").fill("Lisbon");
  const cityOption = page.getByRole("button", { name: /Lisbon/i }).first();
  await expect(cityOption).toBeVisible({ timeout: 10000 });
  await cityOption.click();
  await expect(page.getByText("Who's usually along?")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Build your fun profile")).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();

  await expect(page.getByText("Plan what's actually left")).toBeVisible();

  // Which windows are still usable depends on the wall clock; whatever is left
  // of today, the weekend, or the week, at least one of them must be offered.
  const available = page.locator(".time-left__button:not([disabled])");
  await expect(available.first()).toBeVisible();
  await available.first().click();

  const stageOrLock = page
    .getByText("Reading your household memory")
    .or(page.getByRole("button", { name: /Lock it/i }));
  await expect(stageOrLock.first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: /Lock it/i })).toBeVisible({ timeout: 20000 });

  // The result is a real itinerary with clock times, not just a date range.
  await expect(page.locator(".itinerary-stop").first()).toBeVisible();
});
