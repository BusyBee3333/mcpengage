import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const surfaces = ["capabilities", "revenue_pulse", "opportunity_review", "proposal_studio", "inbox_triage", "workroom", "market_presence"];
const widths = [320, 390, 768, 1024];

for (const surface of surfaces) {
  test(`${surface} is accessible and responsive`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/revenue-copilot.html?fixture=${surface}`);
    await expect(page.locator("h1").first()).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(accessibility.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  });
}

test("dark theme keeps primary controls readable and keyboard reachable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/revenue-copilot.html?fixture=inbox_triage&theme=dark");
  const action = page.getByRole("button", { name: "Draft reply" });
  await page.keyboard.press("Tab");
  await expect(action).toBeFocused();
  const contrast = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  expect(contrast.violations).toEqual([]);
});

test("critical paths remain usable at 200 percent zoom", async ({ page }) => {
  // A 195 CSS-pixel viewport is the reflow equivalent of a 390px host at 200% browser zoom.
  await page.setViewportSize({ width: 195, height: 900 });
  await page.goto("/revenue-copilot.html?fixture=proposal_studio");
  await expect(page.getByRole("button", { name: "Prepare in chat" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("all provider and action states use truthful language", async ({ page }) => {
  const states = ["signed_out", "provider_not_checked", "provider_disconnected", "permission_denied", "capability_unavailable", "stale_content", "refresh_failure", "draft_saved", "preview_ready", "awaiting_confirmation", "provider_working", "confirmed", "failed_no_change", "already_completed", "outcome_uncertain"];
  for (const state of states) {
    await page.goto(`/revenue-copilot.html?fixture=proposal_studio&state=${state}`);
    await expect(page.locator("body")).not.toContainText(/guaranteed|perfect match/i);
    if (state !== "confirmed") await expect(page.locator("body")).not.toContainText(/^Submitted$/i);
  }
});
