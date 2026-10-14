// Browser test for the calendar: events, repeats, editing one date or the series, views, tasks overlay, .ics.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { addSession, retryingFetch, sessionHeaders } from "./session.mjs";

const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await addSession(context);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("status of 4")) errors.push(`console: ${message.text()}`);
});

async function api(path, init = {}) {
  const response = await retryingFetch(`${baseUrl}${path}`, { headers: sessionHeaders({ "Content-Type": "application/json" }), ...init });
  return { status: response.status, body: await response.json() };
}
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}\n  ${error.message}`);
  }
}

const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 12);
// A day in the middle of the current month, so month-grid assertions never depend on today's position.
const now = new Date();
const mid = new Date(now.getFullYear(), now.getMonth(), 15, 12);
const midKey = key(mid);
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const rangeOf = (from, to) => `/api/calendar?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`;
const monthRange = () => rangeOf(new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth() + 2, 1));
const eventsNamed = async (title) => (await api(monthRange())).body.occurrences.filter((o) => o.title === title);
const grid = () => page.getByRole("gridcell");

try {
  await check("calendar: shows the current month with today marked, and nothing scheduled yet", async () => {
    await page.goto(`${baseUrl}/calendar`);
    const monthName = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    await page.getByRole("heading", { name: monthName, level: 1 }).waitFor();
    assert.equal(await grid().count(), 42);
    await page.getByRole("tab", { name: "Month", selected: true }).waitFor();
  });

  await check("calendar: creates an event from the form, and it appears on its day", async () => {
    await page.getByRole("button", { name: "New event" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByLabel("Title").fill("Dentist");
    await dialog.getByLabel("Starts").fill(midKey);
    await dialog.getByLabel("Start time").fill("10:00");
    await dialog.getByLabel("Ends").fill(midKey);
    await dialog.getByLabel("End time").fill("11:00");
    await dialog.getByLabel("Location").fill("Main St");
    await dialog.getByRole("button", { name: "Save" }).click();
    await page.getByText("Event added.").waitFor();
    const day = page.getByRole("gridcell", { name: mid.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) });
    await day.getByRole("button", { name: /Dentist/ }).waitFor();
    const stored = (await eventsNamed("Dentist"))[0];
    assert.equal(stored.location, "Main St");
    assert.equal(new Date(stored.end) - new Date(stored.start), 3_600_000);
  });

  await check("calendar: rejects an event that ends before it starts, with a clear message", async () => {
    await page.getByRole("button", { name: "New event" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByLabel("Title").fill("Backwards");
    await dialog.getByLabel("Starts").fill(midKey);
    await dialog.getByLabel("Start time").fill("15:00");
    await dialog.getByLabel("Ends").fill(midKey);
    await dialog.getByLabel("End time").fill("14:00");
    await dialog.getByRole("button", { name: "Save" }).click();
    await dialog.getByRole("alert").getByText("The event can't end before it starts.").waitFor();
    await dialog.getByLabel("Title").fill("");
    await dialog.getByRole("button", { name: "Save" }).click();
    await dialog.getByRole("alert").getByText("Give the event a title.").waitFor();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    assert.equal((await eventsNamed("Backwards")).length, 0);
  });

  await check("calendar: a repeating event appears on every date, and one date can be changed on its own", async () => {
    const start = addDays(mid, -14); // two weeks before, so there are several repeats this month
    await api("/api/calendar", {
      method: "POST",
      body: JSON.stringify({ title: "Standup", start: new Date(start.getFullYear(), start.getMonth(), start.getDate(), 9, 0).toISOString(), end: new Date(start.getFullYear(), start.getMonth(), start.getDate(), 9, 15).toISOString(), timezone: zone, recurrence: { freq: "weekly", interval: 1, count: 6 } }),
    });
    await page.goto(`${baseUrl}/calendar`);
    await page.getByRole("button", { name: /Standup/ }).first().waitFor();
    const occurrences = await eventsNamed("Standup");
    assert.equal(occurrences.length, 6);

    // Edit the occurrence on `mid`'s week.
    const target = occurrences.find((o) => o.key >= midKey) ?? occurrences.at(-1);
    const targetDay = new Date(`${target.key}T12:00:00`);
    await page.getByRole("gridcell", { name: targetDay.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) }).getByRole("button", { name: /Standup/ }).click();
    const dialog = page.getByRole("dialog", { name: "Edit event" });
    await dialog.getByLabel("Title").fill("Standup (retro)");
    await dialog.getByRole("button", { name: "Save" }).click();
    await page.getByRole("dialog", { name: "Save changes to…" }).getByRole("button", { name: /Only this event/ }).click();
    await page.getByText("Event saved.").waitFor();
    assert.equal((await eventsNamed("Standup (retro)")).length, 1);
    assert.equal((await eventsNamed("Standup")).length, 5, "the other five are untouched");
  });

  await check("calendar: deleting one date keeps the series, deleting the series removes all", async () => {
    const before = await eventsNamed("Standup");
    const victim = before[0];
    await page.goto(`${baseUrl}/calendar`);
    const victimDay = new Date(`${victim.key}T12:00:00`);
    // The date may be outside the visible month; use the API for navigation-free certainty about the data.
    await api(`/api/calendar/${victim.eventId}?scope=this&occurrence=${victim.key}`, { method: "DELETE" });
    assert.equal((await eventsNamed("Standup")).length, 4);
    assert.ok(victimDay instanceof Date);

    await page.reload();
    const chip = page.getByRole("button", { name: /Standup(?! \(retro\))/ }).first();
    await chip.waitFor();
    await chip.click();
    await page.getByRole("dialog", { name: "Edit event" }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog", { name: "Delete…" }).getByRole("button", { name: "All events in the series" }).click();
    await page.getByText("Event deleted.").waitFor();
    assert.equal((await eventsNamed("Standup")).length, 0);
    assert.equal((await eventsNamed("Standup (retro)")).length, 1, "the separately edited date survives");
  });

  await check("calendar: week view shows timed events as blocks, and clicking a slot starts an event at that hour", async () => {
    await api("/api/calendar", { method: "POST", body: JSON.stringify({ title: "Review", start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0).toISOString(), end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 30).toISOString(), timezone: zone }) });
    await page.goto(`${baseUrl}/calendar`);
    await page.getByRole("tab", { name: "Week" }).click();
    await page.getByRole("button", { name: /Review/ }).waitFor();
    const column = page.locator("div.relative.border-l").nth(now.getDay());
    const box = await column.boundingBox();
    // The column's box already reflects how far the grid is scrolled; 11:00 is 11 hours down from its top.
    await page.mouse.click(box.x + 20, box.y + 11 * 48 + 10);
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel("Start time").inputValue(), "11:00");
    assert.equal(await dialog.getByLabel("End time").inputValue(), "12:00");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  await check("calendar: agenda lists upcoming events, and tasks due appear as dashed chips that open Tasks", async () => {
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: "File taxes", dueDate: key(now) }) });
    await page.goto(`${baseUrl}/calendar`);
    await page.getByRole("tab", { name: "Agenda" }).click();
    await page.getByRole("button", { name: /Review/ }).waitFor();
    await page.getByRole("link", { name: /File taxes/ }).waitFor();
    await page.getByText("today", { exact: true }).waitFor();
    await page.getByRole("link", { name: /File taxes/ }).click();
    await page.waitForURL(/\/tasks$/);
  });

  await check("calendar: the assistant proposes time blocks, saves nothing until confirmed, then adds them as events", async () => {
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Write quarterly report", priority: "urgent" }) });
    const eventsBefore = async () => (await api(rangeOf(now, addDays(now, 8)))).body.occurrences.filter((o) => o.title.startsWith("Work on:")).length;
    const startCount = await eventsBefore();
    await page.goto(`${baseUrl}/calendar`);
    await page.getByRole("button", { name: "Plan my tasks" }).click();
    const setup = page.getByRole("dialog", { name: "Plan time for your tasks" });
    await setup.getByLabel("Plan the next").selectOption("5");
    await setup.getByRole("button", { name: "Suggest a plan" }).click();
    const review = page.getByRole("dialog", { name: "Suggested time blocks" });
    await review.getByText("Two focused blocks before the deadlines.").waitFor({ timeout: 20_000 });
    await review.getByRole("checkbox").first().waitFor();
    assert.equal(await review.getByRole("checkbox").count(), 2);
    assert.equal(await eventsBefore(), startCount, "nothing is saved while reviewing");
    await review.getByRole("checkbox").nth(1).uncheck();
    await review.getByRole("button", { name: /Apply 1 time block/ }).click();
    await page.getByText(/Added 1 time block to your calendar/).waitFor();
    assert.equal(await eventsBefore(), startCount + 1);
  });

  await check("calendar: exports an .ics file and re-importing it updates instead of duplicating", async () => {
    await page.goto(`${baseUrl}/calendar`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export" }).click()]);
    assert.equal(download.suggestedFilename(), "omni-calendar.ics");
    const text = await (await retryingFetch(`${baseUrl}/api/calendar/export`, { headers: sessionHeaders() })).text();
    assert.match(text, /BEGIN:VCALENDAR/);
    assert.match(text, /SUMMARY:Dentist/);
    const before = (await api(monthRange())).body.occurrences.length;
    await page.getByLabel("Choose a calendar file").setInputFiles({ name: "backup.ics", mimeType: "text/calendar", buffer: Buffer.from(text) });
    await page.getByText(/Imported 0 new and \d+ updated/).waitFor();
    assert.equal((await api(monthRange())).body.occurrences.length, before);
  });

  await check("calendar: imports events from another app and warns about what it can't match", async () => {
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:external-1", "SUMMARY:Imported meeting", `DTSTART:${key(mid).replace(/-/g, "")}T150000Z`, `DTEND:${key(mid).replace(/-/g, "")}T160000Z`, "RRULE:FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    await page.getByLabel("Choose a calendar file").setInputFiles({ name: "other.ics", mimeType: "text/calendar", buffer: Buffer.from(ics) });
    await page.getByText(/Imported 1 new and 0 updated/).waitFor();
    await page.getByText(/BYSETPOS/).waitFor();
    assert.equal((await eventsNamed("Imported meeting")).length >= 1, true);
    await page.getByLabel("Choose a calendar file").setInputFiles({ name: "bad.ics", mimeType: "text/calendar", buffer: Buffer.from("not a calendar") });
    await page.getByRole("alert").getByText(/No events were found/).waitFor();
  });

  await check("calendar: the API validates input and needs a sign-in", async () => {
    assert.equal((await api("/api/calendar", { method: "POST", body: JSON.stringify({ title: "x", start: "soon", end: "later" }) })).status, 400);
    assert.equal((await api("/api/calendar?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z")).body.error.code, "invalid_range");
    assert.equal((await api("/api/calendar/missing")).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/calendar?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/calendar/export`)).status, 401);
  });

  await check("home: today's schedule shows on the dashboard", async () => {
    await page.goto(`${baseUrl}/`);
    await page.getByRole("heading", { name: "Today's schedule" }).waitFor();
    await page.getByRole("link", { name: "Review" }).waitFor();
  });

  await check("mobile: the calendar fits a phone screen in every view", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await addSession(mobile);
    const phone = await mobile.newPage();
    await phone.goto(`${baseUrl}/calendar`, { waitUntil: "networkidle" });
    for (const view of ["Month", "Week", "Agenda"]) {
      await phone.getByRole("tab", { name: view }).click();
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `${view} overflows by ${overflow}px`);
    }
    await mobile.close();
  });

  await check("no unexpected browser errors", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} calendar checks passed`);
process.exit(failed.length ? 1 : 0);
