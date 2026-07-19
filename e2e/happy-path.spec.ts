import { test, expect } from "@playwright/test";

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test("signup -> generate -> Love -> Buddy edit -> share -> dislike -> lock -> feedback -> Memory", async ({ page, context }) => {
  const email = uniqueEmail();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/");
  await expect(page.getByText("PlanBuddy")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Where are you based?")).toBeVisible();
  await page.getByLabel("Home city").fill("Lisbon");
  const cityOption = page.getByRole("button", { name: /Lisbon/i }).first();
  await expect(cityOption).toBeVisible({ timeout: 10000 });
  await cityOption.click();
  await expect(page.getByText("Who's usually along?")).toBeVisible();
  await page.getByRole("button", { name: "Start planning" }).click();

  await expect(page.getByText("One click. One genuinely good plan.")).toBeVisible();
  await page.getByRole("button", { name: "Plan my weekend" }).click();
  await expect(page.getByRole("button", { name: /Lock it/i })).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: /^Love$/i }).click();
  await expect(page.getByText("PlanBuddy learned")).toBeVisible();

  const originalTitle = await page.locator(".ticket-card h2").first().textContent();
  await page.getByRole("button", { name: "Edit this plan with Buddy" }).click();
  await page.getByLabel("Edit this plan with Buddy").fill("Change only the restaurant and keep the walks");
  await page.route("**/api/plan-specs/*/chat-action", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.getByRole("button", { name: "Send plan edit" }).click();
  await expect(page.locator(".ticket-card h2").first()).toHaveText(originalTitle ?? "");
  await expect(page.getByText(/Checking the route, constraints/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to original" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/changed the meal stop/i)).toBeVisible();
  await page.getByRole("button", { name: "Back to original" }).click();
  await expect(page.locator(".ticket-card h2").first()).toHaveText(originalTitle ?? "");

  await page.getByRole("button", { name: /^Share$/i }).click();
  await expect(page.getByRole("button", { name: "Shared" })).toBeVisible();

  await page.getByRole("button", { name: /^Dislike$/i }).click();
  await page.getByLabel(/What missed/i).fill("Not feeling it today");
  await page.getByRole("button", { name: "Save and show another" }).click();
  await expect(page.getByRole("button", { name: /Lock it/i })).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: /Lock it/i }).click();
  await expect(page.getByText("It's on.")).toBeVisible();
  await page.getByRole("link", { name: "View in History" }).click({ force: true });
  await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  await page.locator(".card").first().click();
  await page.getByRole("button", { name: /^Love$/i }).click();
  await page.getByRole("button", { name: "Save feedback" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.getByRole("link", { name: "Chat" }).click();
  await page.getByPlaceholder(/Say something/).fill("We are allergic to peanuts");
  await page.getByPlaceholder(/Say something/).press("Enter");
  await expect(page.getByText(/Added to Memory as a constraint/i)).toBeVisible({ timeout: 15000 });
  await page.getByRole("link", { name: "Memory" }).click();
  await expect(page.getByText(/peanut/i).first()).toBeVisible();
  await expect(page.getByText("Unverified quote")).toBeVisible();
});
