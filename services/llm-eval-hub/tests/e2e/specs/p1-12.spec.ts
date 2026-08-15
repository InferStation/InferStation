import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const evidenceDir = process.env.E2E_EVIDENCE_DIR || path.resolve(import.meta.dirname, "../../../artifacts/e2e");
const apiKey = process.env.E2E_API_KEY || "inferstation-e2e-key";
const endpointName = "P1-12 Mock Endpoint";
const datasetName = "mvp-golden-v1";
const runName = "P1-12 Browser E2E";
const manifestPath = "/workspace/datasets/experiments/mvp-golden-v1/manifest.yaml";
const dataPath = "/workspace/datasets/experiments/mvp-golden-v1/data/test.jsonl";
const assertions: Array<{ name: string; status: "PASS"; detail: string }> = [];
let runId = "";

function record(name: string, detail: string) {
  assertions.push({ name, status: "PASS", detail });
}

function writeJson(name: string, value: unknown) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function installApiKey(page: Page) {
  return page.addInitScript((key: string) => {
    window.localStorage.setItem("evalhub.apiKey", key);
  }, apiKey);
}

async function assertLayout(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const selectors = [
      ".topbar",
      ".page-heading",
      ".run-heading",
      ".heading-actions",
      ".wizard-actions",
      ".tabs",
      ".filterbar",
      ".metric-grid",
    ];
    const overlaps: string[] = [];
    for (const selector of selectors) {
      for (const container of document.querySelectorAll<HTMLElement>(selector)) {
        const children = [...container.children].filter((child): child is HTMLElement => {
          const rect = child.getBoundingClientRect();
          const style = getComputedStyle(child);
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        });
        for (let left = 0; left < children.length; left += 1) {
          for (let right = left + 1; right < children.length; right += 1) {
            const a = children[left].getBoundingClientRect();
            const b = children[right].getBoundingClientRect();
            const intersectionWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const intersectionHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (intersectionWidth > 1 && intersectionHeight > 1) {
              overlaps.push(`${selector}: ${children[left].tagName} overlaps ${children[right].tagName}`);
            }
          }
        }
      }
    }
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      overlaps,
    };
  });
  expect(result.documentWidth, `${label}: document must not overflow horizontally`).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.overlaps, `${label}: sibling controls must not overlap`).toEqual([]);
  record(`${label} layout`, `${result.viewportWidth}px viewport, ${result.documentWidth}px document, 0 overlaps`);
}

function installRuntimeDiagnostics(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("ERR_ABORTED")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (!request.url().includes("/events") && request.failure()?.errorText !== "net::ERR_ABORTED") {
      errors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    }
  });
  return errors;
}

function parseProgress(text: string): [number, number] {
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) throw new Error(`Could not parse progress: ${text}`);
  return [Number(match[1]), Number(match[2])];
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted && character === '"' && content[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function saveScreenshot(page: Page, name: string) {
  const destination = path.join(evidenceDir, "screenshots", name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await page.screenshot({ path: destination, fullPage: true });
}

test.describe("P1-12 Browser E2E", () => {
  test.describe.configure({ mode: "serial" });

  test("desktop complete workflow, SSE refresh, filters, detail and exports", async ({ page, request, browserName }) => {
    fs.mkdirSync(path.join(evidenceDir, "downloads"), { recursive: true });
    await installApiKey(page);
    const runtimeErrors = installRuntimeDiagnostics(page);

    await expect((await request.post("http://e2e-mock-openai:8001/__control/reset")).ok()).toBeTruthy();
    await expect((await request.post("http://e2e-mock-openai:8001/__control/delay/200")).ok()).toBeTruthy();

    await test.step("register and probe endpoint", async () => {
      await page.goto("/endpoints");
      await expect(page.getByRole("heading", { name: "Endpoints" })).toBeVisible();
      await page.locator(".page-heading").getByRole("button", { name: "登记 Endpoint" }).click();
      const dialog = page.getByRole("dialog", { name: "登记 Endpoint" });
      await dialog.getByLabel("名称").fill(endpointName);
      await dialog.getByLabel("认证方式").selectOption("none");
      await dialog.getByLabel("Base URL").fill("http://e2e-mock-openai:8001/v1");
      await dialog.getByLabel("Model ID").fill("mock-intent-v1");
      await dialog.getByLabel("并发上限").fill("4");
      await dialog.getByLabel("QPS 上限").fill("100");
      await dialog.getByRole("button", { name: "保存" }).click();
      const row = page.getByRole("row").filter({ hasText: endpointName });
      await expect(row).toBeVisible();
      await expect(row.getByText("healthy", { exact: true })).toBeVisible();
      await expect(page.locator(".model-list span").filter({ hasText: "mock-intent-v1" })).toBeVisible();
      await assertLayout(page, "desktop endpoint");
      await saveScreenshot(page, "desktop-01-endpoint.png");
      record("Endpoint registration and probe", "healthy; mock-intent-v1 discovered");
    });

    await test.step("create dataset and upload frozen version", async () => {
      await page.goto("/datasets");
      await page.locator(".page-heading").getByRole("button", { name: "新建数据集" }).click();
      const createDialog = page.getByRole("dialog", { name: "新建数据集" });
      await createDialog.getByLabel("标识名").fill(datasetName);
      await createDialog.getByLabel("显示名称").fill("MVP Golden V1");
      await createDialog.getByLabel("说明").fill("P1-12 isolated browser E2E fixture");
      await createDialog.getByRole("button", { name: "创建" }).click();
      const datasetRow = page.locator(".dataset-row").filter({ hasText: datasetName });
      await expect(datasetRow).toBeVisible();
      await datasetRow.getByRole("button", { name: "上传版本" }).click();
      const uploadDialog = page.getByRole("dialog", { name: /上传版本/ });
      await uploadDialog.locator('input[type="file"]').nth(0).setInputFiles(manifestPath);
      await uploadDialog.locator('input[type="file"]').nth(1).setInputFiles(dataPath);
      await uploadDialog.getByRole("button", { name: "校验并上传" }).click();
      await expect(datasetRow.getByText("100 samples", { exact: false })).toBeVisible();
      await assertLayout(page, "desktop dataset");
      await saveScreenshot(page, "desktop-02-dataset.png");
      record("Dataset UI upload", "manifest and 100-row JSONL accepted as version 1.0.0");
    });

    await test.step("create run through wizard and observe SSE", async () => {
      await page.goto("/evaluations/new");
      await page.getByRole("button", { name: new RegExp(endpointName) }).click();
      await page.getByLabel("Model ID").selectOption({ label: "mock-intent-v1" });
      await page.getByRole("button", { name: /下一步/ }).click();
      await page.getByText(/MVP Golden V1 · 1.0.0/).click();
      await page.getByRole("button", { name: /下一步/ }).click();
      await page.getByLabel("运行名称").fill(runName);
      await page.getByLabel("并发", { exact: true }).fill("2");
      await page.getByLabel("QPS", { exact: true }).fill("100");
      await page.getByRole("button", { name: /下一步/ }).click();
      await expect(page.getByText("预检通过", { exact: true })).toBeVisible();
      await expect(page.getByText(/100 个样本，实际并发 2/)).toBeVisible();

      const sseResponse = page.waitForResponse((response) => response.url().includes("/events") && response.status() === 200);
      const createResponse = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/v1\/runs$/.test(response.url()) && response.status() === 202);
      await page.getByRole("button", { name: "创建并运行" }).click();
      const response = await createResponse;
      const body = await response.json() as { id: string };
      runId = body.id;
      await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
      await sseResponse;
      await expect(page.locator(".live-progress")).toBeVisible();
      await expect.poll(async () => parseProgress(await page.locator(".live-progress-head").innerText())[0], { timeout: 60_000 }).toBeGreaterThan(0);
      const [beforeRefresh, total] = parseProgress(await page.locator(".live-progress-head").innerText());
      expect(beforeRefresh).toBeLessThan(total);
      await saveScreenshot(page, "desktop-03-running.png");

      const refreshedSse = page.waitForResponse((sse) => sse.url().includes(`/runs/${runId}/events`) && sse.status() === 200);
      await page.reload();
      await refreshedSse;
      await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
      const [afterRefresh] = parseProgress(await page.locator(".live-progress-head").innerText());
      expect(afterRefresh).toBeGreaterThanOrEqual(beforeRefresh);
      record("SSE and refresh recovery", `progress ${beforeRefresh}/100 before refresh and ${afterRefresh}/100 after refresh`);
    });

    await test.step("inspect results, filter samples and validate exports", async () => {
      await expect(page.locator(".run-heading").getByText("SUCCEEDED", { exact: true })).toBeVisible({ timeout: 120_000 });
      await expect(page.locator(".primary-metric").getByText("100.0%", { exact: true })).toBeVisible();
      await expect(page.getByText("暂无匹配样本", { exact: true })).toBeVisible();
      await assertLayout(page, "desktop result");
      await saveScreenshot(page, "desktop-04-result.png");

      const jsonlDownloadPromise = page.waitForEvent("download");
      await page.getByTitle("导出 JSONL").click();
      const jsonlDownload = await jsonlDownloadPromise;
      const jsonlPath = path.join(evidenceDir, "downloads", "run.jsonl");
      await jsonlDownload.saveAs(jsonlPath);
      const jsonlLines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n");
      expect(jsonlLines).toHaveLength(100);
      for (const line of jsonlLines) JSON.parse(line);

      await page.getByRole("button", { name: "样本", exact: true }).click();
      await page.locator(".segmented").getByRole("button", { name: "SUCCEEDED", exact: true }).click();
      await expect(page.locator(".clickable-row")).toHaveCount(100);
      await page.locator(".clickable-row").first().click();
      await expect(page.locator(".sample-panel")).toBeVisible();
      await expect(page.locator(".sample-panel").getByText(/mvp-golden-v1-/).first()).toBeVisible();
      await page.locator(".sample-panel").getByRole("button", { name: "关闭" }).click();
      await page.locator(".segmented").getByRole("button", { name: "FAILED", exact: true }).click();
      await expect(page.getByText("暂无匹配样本", { exact: true })).toBeVisible();

      const csvDownloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "CSV", exact: true }).click();
      const csvDownload = await csvDownloadPromise;
      const csvPath = path.join(evidenceDir, "downloads", "run.csv");
      await csvDownload.saveAs(csvPath);
      const csvRows = parseCsvRows(fs.readFileSync(csvPath, "utf8"));
      expect(csvRows).toHaveLength(101);
      expect(csvRows[0]).toContain("sample_id");
      record("Results and sample detail", "accuracy 100.0%; 100 succeeded rows; failed filter empty; detail drawer opened");
      record("JSONL and CSV exports", "100 parseable JSONL records; CSV header plus 100 parseable data rows");
    });

    await test.step("find terminal run in history", async () => {
      await page.goto("/runs");
      await page.getByPlaceholder("搜索运行名称").fill(runName);
      await page.locator(".filterbar .segmented").getByRole("button", { name: "SUCCEEDED", exact: true }).click();
      await expect(page.getByRole("link", { name: runName, exact: true })).toBeVisible();
      await assertLayout(page, "desktop run history");
      await saveScreenshot(page, "desktop-05-run-history.png");
      record("Run history search and status filter", "terminal run found by exact name under SUCCEEDED");
    });

    expect(runtimeErrors).toEqual([]);
    record("Browser runtime diagnostics", "0 page errors, console errors, or non-SSE request failures");
    writeJson("assertions.json", assertions);
    writeJson("environment.json", {
      captured_at_utc: new Date().toISOString(),
      browser: browserName,
      playwright: "1.62.1",
      desktop_viewport: "1440x1000",
      mobile_viewport: "390x844",
      git_sha: process.env.EVALHUB_GIT_SHA || "working-tree",
      compose_config_sha256: process.env.EVALHUB_COMPOSE_CONFIG_SHA256 || "working-tree",
      gpu_devices: process.env.EVALHUB_GPU_DEVICES || "2,3",
      gpu_unique_ids: process.env.EVALHUB_GPU_UNIQUE_IDS || "unknown,unknown",
      run_id: runId,
    });
  });

  test("mobile result, navigation and layout", async ({ browser }) => {
    expect(runId).not.toBe("");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Shanghai", reducedMotion: "reduce" });
    await context.addInitScript((key: string) => window.localStorage.setItem("evalhub.apiKey", key), apiKey);
    const page = await context.newPage();
    const runtimeErrors = installRuntimeDiagnostics(page);
    await page.goto(`/runs/${runId}`);
    await expect(page.locator(".run-heading").getByText("SUCCEEDED", { exact: true })).toBeVisible();
    await expect(page.getByTitle("打开导航")).toBeVisible();
    await expect(page.locator(".sidebar")).not.toBeInViewport();
    await page.getByTitle("打开导航").click();
    await expect(page.locator(".sidebar")).toBeInViewport();
    await page.locator(".sidebar").getByRole("link", { name: "运行记录" }).click();
    await expect(page.getByRole("heading", { name: "运行记录" })).toBeVisible();
    await page.getByRole("link", { name: runName, exact: true }).click();
    await expect(page.locator(".primary-metric").getByText("100.0%", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "样本", exact: true }).click();
    await page.locator(".segmented").getByRole("button", { name: "SUCCEEDED", exact: true }).click();
    await expect(page.locator(".clickable-row").first()).toBeVisible();
    await assertLayout(page, "mobile result and samples");
    const mobileViewport = path.join(evidenceDir, "screenshots", "mobile-00-viewport.png");
    fs.mkdirSync(path.dirname(mobileViewport), { recursive: true });
    await page.screenshot({ path: mobileViewport });
    await saveScreenshot(page, "mobile-01-result-samples.png");
    expect(runtimeErrors).toEqual([]);
    record("Mobile navigation and result", "390x844 sidebar navigation, result metrics, samples and layout passed");
    writeJson("assertions.json", assertions);

    const report = [
      "# P1-12 Browser E2E Report",
      "",
      `- Result: PASS`,
      `- Run ID: \`${runId}\``,
      "- Browser: Chromium via Playwright 1.62.1",
      "- Viewports: 1440x1000 and 390x844",
      "- GPU device boundary: physical cards 2,3; no GPU devices mounted into E2E services",
      "",
      "## Assertions",
      "",
      ...assertions.map((item) => `- PASS - ${item.name}: ${item.detail}`),
      "",
    ].join("\n");
    fs.writeFileSync(path.join(evidenceDir, "report.md"), report);
    await context.close();
  });
});
