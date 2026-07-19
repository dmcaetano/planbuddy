import { test, expect } from "@playwright/test";

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test("signup -> onboard -> generate -> reject -> lock -> feedback -> Memory", async ({ page }) => {
  const email = uniqueEmail();

  await page.goto("/");
  await expect(page.getByText("PlanBuddy")).toBeVisible();

  // Signup
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();

  // Onboarding: home base
  await expect(page.getByText("Where are you based?")).toBeVisible();
  await page.getByLabel("Home city").fill("Lisbon");
  const cityOption = page.getByRole("button", { name: /Lisbon/i }).first();
  await expect(cityOption).toBeVisible({ timeout: 10000 });
  await cityOption.click();

  // Onboarding: participants
  await expect(page.getByText("Who's usually along?")).toBeVisible();
  await page.getByRole("button", { name: "Start planning" }).click();

  // Plan tab: New spec state
  await expect(page.getByText("One click. One genuinely good plan.")).toBeVisible();
  await page.getByRole("button", { name: "Plan my weekend" }).click();

  // Recommendation appears
  await expect(page.getByRole("button", { name: /Lock it/i })).toBeVisible({ timeout: 15000 });

  // Reject with a reason (Not this), then a next candidate should appear
  await page.getByRole("button", { name: /Not this/i }).click();
  await page.getByLabel(/Why isn't this the one/i).fill("Not feeling it today");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("button", { name: /Lock it/i })).toBeVisible({ timeout: 15000 });

  // Lock the current candidate
  await page.getByRole("button", { name: /Lock it/i }).click();
  await expect(page.getByText("It's on the calendar.")).toBeVisible();

  // History: find the locked plan and leave feedback
  await page.getByRole("link", { name: "View in History" }).click();
  await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  await page.locator(".card").first().click();
  await page.locator('button[aria-label="5 stars"]').click();
  await page.getByRole("button", { name: "Submit feedback" }).click();
  await expect(page.getByText("Thanks — that feedback helps PlanBuddy learn safely.")).toBeVisible();

  // Chat: state a direct constraint and confirm it lands in Memory
  await page.getByRole("link", { name: "Chat" }).click();
  await page.getByPlaceholder("Say something…").fill("We are allergic to peanuts");
  await page.getByPlaceholder("Say something…").press("Enter");
  await expect(page.getByText(/Added to Memory as a constraint/i)).toBeVisible({ timeout: 15000 });

  // Memory: constraint is visible with provenance and can be confirmed
  await page.getByRole("link", { name: "Memory" }).click();
  await expect(page.getByText(/peanut/i).first()).toBeVisible();
  await expect(page.getByText("Unverified quote")).toBeVisible();
});
