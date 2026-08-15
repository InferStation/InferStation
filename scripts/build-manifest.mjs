#!/usr/bin/env node
// Build runtime-loadable manifests for performance and accuracy benchmark runs.
//
// Output (relative to repo root, served as static assets by Next):
//   public/data/runs.json       — RunSummary[] (no raw_llamabench), newest first
//   public/data/raw/<id>.json   — full RunRecord per run
//   public/data/evaluations/index.json    — published accuracy runs
//   public/data/evaluations/raw/<id>.json — full accuracy run per id
//
// This script is the single source of truth for the data the site loads at
// runtime. After it writes these files, the static site can be served as-is
// with no Next.js build needed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const RUNS_DIR = path.join(repoRoot, "data", "runs");
const OUT_DIR = path.join(repoRoot, "public", "data");
const OUT_RAW = path.join(OUT_DIR, "raw");
const EVALUATIONS_DIR = path.join(repoRoot, "data", "evaluations");
const EVALUATIONS_OUT = path.join(OUT_DIR, "evaluations");
const EVALUATIONS_OUT_RAW = path.join(EVALUATIONS_OUT, "raw");
const evaluationsOnly = process.argv.includes("--evaluations-only");

function* walkJson(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJson(full);
    else if (entry.isFile() && entry.name.endsWith(".json")) yield full;
  }
}

function buildPerformanceManifest() {
  fs.mkdirSync(OUT_RAW, { recursive: true });
  // Wipe stale raw files so deleted runs disappear.
  for (const f of fs.readdirSync(OUT_RAW)) {
    if (f.endsWith(".json")) fs.unlinkSync(path.join(OUT_RAW, f));
  }

  const summaries = [];
  for (const abs of walkJson(RUNS_DIR)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
      console.warn(`[manifest] skip ${abs}: ${e.message}`);
      continue;
    }
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    const id = rel
      .replace(/^data\/runs\//, "")
      .replace(/\.json$/, "")
      .replace(/\//g, "__");

    // Persist the full record as a per-id asset.
    fs.writeFileSync(
      path.join(OUT_RAW, `${id}.json`),
      JSON.stringify({ ...parsed, id, source_path: rel }),
    );

    // Strip the heavy raw llama-bench payload from the summary list.
    const summary = { ...parsed, id, source_path: rel };
    delete summary.raw_llamabench;
    summaries.push(summary);
  }

  summaries.sort((a, b) => {
    if (a.run_date !== b.run_date) return a.run_date < b.run_date ? 1 : -1;
    return a.id.localeCompare(b.id);
  });

  fs.writeFileSync(
    path.join(OUT_DIR, "runs.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), runs: summaries }),
  );

  console.log(`[manifest] wrote ${summaries.length} runs to public/data/runs.json`);
}

const PUBLICATION_STATUSES = new Set(["published", "draft", "example"]);
const RUN_STATUSES = new Set(["completed", "partial", "failed"]);
const TARGET_TYPES = new Set(["local_server", "online_api"]);
const METRIC_UNITS = new Set(["ratio", "percent", "score", "seconds", "count"]);
const METRIC_DIRECTIONS = new Set(["higher_is_better", "lower_is_better"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateEvaluationRecord(record, rel) {
  const errors = [];
  const requiredString = (value, field) => {
    if (!nonEmptyString(value)) errors.push(`${field} must be a non-empty string`);
  };
  const stringValue = (value, field) => {
    if (typeof value !== "string") errors.push(`${field} must be a string`);
  };
  const nullableNumber = (value, field, { integer = false, min = 0 } = {}) => {
    if (value === null) return;
    if (!Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) {
      errors.push(`${field} must be null or a ${integer ? "whole " : ""}number >= ${min}`);
    }
  };
  const isoTimestamp = (value, field) => {
    if (
      !nonEmptyString(value) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value))
    ) {
      errors.push(`${field} must be an ISO 8601 UTC timestamp`);
    }
  };

  if (record?.schema_version !== 1) errors.push("schema_version must be 1");
  if (!PUBLICATION_STATUSES.has(record?.publication_status)) {
    errors.push("publication_status must be published, draft, or example");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record?.run_date || "")) {
    errors.push("run_date must use YYYY-MM-DD");
  }
  isoTimestamp(record?.started_at, "started_at");
  isoTimestamp(record?.completed_at, "completed_at");
  if (
    Number.isFinite(Date.parse(record?.started_at)) &&
    Number.isFinite(Date.parse(record?.completed_at)) &&
    Date.parse(record.started_at) > Date.parse(record.completed_at)
  ) {
    errors.push("started_at cannot be later than completed_at");
  }
  if (!RUN_STATUSES.has(record?.status)) errors.push("status must be completed, partial, or failed");
  requiredString(record?.model?.slug, "model.slug");
  requiredString(record?.model?.name, "model.name");
  nullableNumber(record?.model?.params_b, "model.params_b");
  stringValue(record?.model?.source_url, "model.source_url");
  stringValue(record?.model?.revision, "model.revision");
  requiredString(record?.model?.quantization, "model.quantization");
  stringValue(record?.model?.scheme, "model.scheme");
  if (!TARGET_TYPES.has(record?.target?.type)) {
    errors.push("target.type must be local_server or online_api");
  }
  requiredString(record?.target?.provider, "target.provider");
  requiredString(record?.target?.model_id, "target.model_id");
  requiredString(record?.target?.endpoint_protocol, "target.endpoint_protocol");
  stringValue(record?.target?.region, "target.region");
  if (record?.target?.type === "local_server") {
    requiredString(record?.target?.host?.slug, "target.host.slug");
    requiredString(record?.target?.host?.name, "target.host.name");
    requiredString(record?.target?.host?.vendor, "target.host.vendor");
    requiredString(record?.target?.host?.chip, "target.host.chip");
    nullableNumber(record?.target?.host?.accelerator_count, "target.host.accelerator_count", {
      integer: true,
      min: 1,
    });
    nullableNumber(record?.target?.host?.vram_gb, "target.host.vram_gb", { min: 0 });
    requiredString(record?.target?.engine?.slug, "target.engine.slug");
    requiredString(record?.target?.engine?.name, "target.engine.name");
    requiredString(record?.target?.engine?.version, "target.engine.version");
    requiredString(record?.target?.engine?.commit, "target.engine.commit");
    requiredString(record?.target?.engine?.backend, "target.engine.backend");
  }
  if (record?.producer?.name !== "llm-eval-hub") {
    errors.push("producer.name must be llm-eval-hub");
  }
  requiredString(record?.producer?.version, "producer.version");
  requiredString(record?.producer?.commit, "producer.commit");
  requiredString(record?.producer?.run_id, "producer.run_id");
  requiredString(record?.producer?.run_fingerprint, "producer.run_fingerprint");
  requiredString(record?.evaluation?.spec_id, "evaluation.spec_id");
  requiredString(record?.evaluation?.suite?.slug, "evaluation.suite.slug");
  requiredString(record?.evaluation?.suite?.name, "evaluation.suite.name");
  requiredString(record?.evaluation?.suite?.version, "evaluation.suite.version");
  requiredString(record?.evaluation?.harness?.name, "evaluation.harness.name");
  requiredString(record?.evaluation?.harness?.version, "evaluation.harness.version");
  requiredString(record?.evaluation?.harness?.commit, "evaluation.harness.commit");
  requiredString(record?.evaluation?.adapter?.name, "evaluation.adapter.name");
  requiredString(record?.evaluation?.adapter?.version, "evaluation.adapter.version");
  requiredString(record?.evaluation?.adapter?.chat_template, "evaluation.adapter.chat_template");
  requiredString(
    record?.evaluation?.adapter?.prompt_template_sha256,
    "evaluation.adapter.prompt_template_sha256",
  );
  nullableNumber(record?.evaluation?.generation?.temperature, "evaluation.generation.temperature");
  nullableNumber(record?.evaluation?.generation?.top_p, "evaluation.generation.top_p");
  nullableNumber(record?.evaluation?.generation?.seed, "evaluation.generation.seed", {
    integer: true,
  });
  nullableNumber(
    record?.evaluation?.generation?.max_output_tokens,
    "evaluation.generation.max_output_tokens",
    { integer: true, min: 1 },
  );
  if (record?.evaluation?.grader !== null) {
    requiredString(record?.evaluation?.grader?.type, "evaluation.grader.type");
    requiredString(record?.evaluation?.grader?.name, "evaluation.grader.name");
    requiredString(record?.evaluation?.grader?.version, "evaluation.grader.version");
  }
  requiredString(record?.evaluation?.command, "evaluation.command");

  if (!Array.isArray(record?.tasks) || record.tasks.length === 0) {
    errors.push("tasks must be a non-empty array");
  } else {
    record.tasks.forEach((task, taskIndex) => {
      const prefix = `tasks[${taskIndex}]`;
      requiredString(task?.dataset?.slug, `${prefix}.dataset.slug`);
      requiredString(task?.dataset?.name, `${prefix}.dataset.name`);
      requiredString(task?.dataset?.version, `${prefix}.dataset.version`);
      requiredString(task?.dataset?.split, `${prefix}.dataset.split`);
      if (task?.dataset?.subset !== null && typeof task?.dataset?.subset !== "string") {
        errors.push(`${prefix}.dataset.subset must be null or a string`);
      }
      requiredString(task?.dataset?.category, `${prefix}.dataset.category`);
      requiredString(task?.dataset?.source_url, `${prefix}.dataset.source_url`);
      requiredString(task?.dataset_checksum, `${prefix}.dataset_checksum`);
      requiredString(task?.protocol?.id, `${prefix}.protocol.id`);
      requiredString(task?.protocol?.task_type, `${prefix}.protocol.task_type`);
      requiredString(
        task?.protocol?.denominator_policy,
        `${prefix}.protocol.denominator_policy`,
      );
      requiredString(task?.protocol?.on_api_error, `${prefix}.protocol.on_api_error`);
      requiredString(task?.protocol?.on_parse_error, `${prefix}.protocol.on_parse_error`);
      if (!RUN_STATUSES.has(task?.status)) errors.push(`${prefix}.status is invalid`);
      requiredString(task?.primary_metric, `${prefix}.primary_metric`);
      if (!Array.isArray(task?.metrics) || task.metrics.length === 0) {
        errors.push(`${prefix}.metrics must be a non-empty array`);
      } else {
        if (!task.metrics.some((metric) => metric?.name === task.primary_metric)) {
          errors.push(`${prefix}.primary_metric must name one of the task metrics`);
        }
        task.metrics.forEach((metric, metricIndex) => {
          const metricPrefix = `${prefix}.metrics[${metricIndex}]`;
          requiredString(metric?.name, `${metricPrefix}.name`);
          requiredString(metric?.label, `${metricPrefix}.label`);
          if (!Number.isFinite(metric?.value)) errors.push(`${metricPrefix}.value must be finite`);
          if (!METRIC_UNITS.has(metric?.unit)) errors.push(`${metricPrefix}.unit is invalid`);
          if (!METRIC_DIRECTIONS.has(metric?.direction)) {
            errors.push(`${metricPrefix}.direction is invalid`);
          }
          if (metric?.unit === "ratio" && (metric.value < 0 || metric.value > 1)) {
            errors.push(`${metricPrefix}.value must be between 0 and 1 for ratio metrics`);
          }
          if (metric?.unit === "percent" && (metric.value < 0 || metric.value > 100)) {
            errors.push(`${metricPrefix}.value must be between 0 and 100 for percent metrics`);
          }
          if (metric?.unit === "seconds" && metric.value < 0) {
            errors.push(`${metricPrefix}.value cannot be negative for seconds metrics`);
          }
          if (metric?.n !== undefined && (!Number.isInteger(metric.n) || metric.n < 0)) {
            errors.push(`${metricPrefix}.n must be a non-negative integer`);
          }
          if (metric?.stderr !== undefined && (!Number.isFinite(metric.stderr) || metric.stderr < 0)) {
            errors.push(`${metricPrefix}.stderr must be a non-negative finite number`);
          }
          if (metric?.ci95 !== undefined) {
            if (
              !Array.isArray(metric.ci95) ||
              metric.ci95.length !== 2 ||
              !metric.ci95.every(Number.isFinite) ||
              metric.ci95[0] > metric.ci95[1]
            ) {
              errors.push(`${metricPrefix}.ci95 must be an ordered pair of finite numbers`);
            }
          }
        });
      }
      const counterNames = [
        "total_samples",
        "scored_samples",
        "api_errors",
        "parse_errors",
        "score_errors",
      ];
      for (const counter of counterNames) {
        const value = task?.counters?.[counter];
        if (!Number.isInteger(value) || value < 0) {
          errors.push(`${prefix}.counters.${counter} must be a non-negative integer`);
        }
      }
      if (
        Number.isInteger(task?.counters?.total_samples) &&
        Number.isInteger(task?.counters?.scored_samples) &&
        task.counters.scored_samples > task.counters.total_samples
      ) {
        errors.push(`${prefix}.counters.scored_samples cannot exceed total_samples`);
      }
    });
  }

  const score = record?.summary?.score;
  if (score !== null) {
    errors.push("summary.score must be null until a versioned composite policy is approved");
  }
  const completed = record?.summary?.completed_tasks;
  const total = record?.summary?.total_tasks;
  if (!Number.isInteger(completed) || !Number.isInteger(total) || completed < 0 || total < 0) {
    errors.push("summary task counts must be non-negative integers");
  } else if (completed > total) {
    errors.push("summary.completed_tasks cannot exceed summary.total_tasks");
  }
  requiredString(record?.summary?.score_label, "summary.score_label");
  requiredString(record?.summary?.normalization, "summary.normalization");
  if (Array.isArray(record?.tasks)) {
    const observedCompleted = record.tasks.filter((task) => task?.status === "completed").length;
    if (total !== record.tasks.length) errors.push("summary.total_tasks must equal tasks.length");
    if (completed !== observedCompleted) {
      errors.push("summary.completed_tasks must equal the number of completed task records");
    }
    if (record?.status === "completed" && observedCompleted !== record.tasks.length) {
      errors.push("a completed run cannot contain partial or failed tasks");
    }
  }

  nullableNumber(record?.usage?.requests, "usage.requests", { integer: true });
  nullableNumber(record?.usage?.input_tokens, "usage.input_tokens", { integer: true });
  nullableNumber(record?.usage?.output_tokens, "usage.output_tokens", { integer: true });
  nullableNumber(record?.usage?.billed_usd, "usage.billed_usd");
  stringValue(record?.artifacts?.source_url, "artifacts.source_url");
  stringValue(record?.artifacts?.log_url, "artifacts.log_url");
  stringValue(record?.artifacts?.report_url, "artifacts.report_url");
  stringValue(record?.artifacts?.samples_url, "artifacts.samples_url");
  stringValue(record?.artifacts?.samples_sha256, "artifacts.samples_sha256");
  stringValue(record?.notes, "notes");

  if (errors.length) {
    throw new Error(`[manifest] invalid evaluation ${rel}:\n  - ${errors.join("\n  - ")}`);
  }
}

function buildEvaluationManifest() {
  fs.mkdirSync(EVALUATIONS_OUT_RAW, { recursive: true });
  for (const f of fs.readdirSync(EVALUATIONS_OUT_RAW)) {
    if (f.endsWith(".json")) fs.unlinkSync(path.join(EVALUATIONS_OUT_RAW, f));
  }

  const summaries = [];
  const producerRunIds = new Map();
  let checked = 0;
  for (const abs of walkJson(EVALUATIONS_DIR)) {
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (error) {
      throw new Error(`[manifest] invalid JSON ${rel}: ${error.message}`);
    }
    validateEvaluationRecord(parsed, rel);
    const previousPath = producerRunIds.get(parsed.producer.run_id);
    if (previousPath) {
      throw new Error(
        `[manifest] duplicate producer.run_id ${parsed.producer.run_id}: ${previousPath} and ${rel}`,
      );
    }
    producerRunIds.set(parsed.producer.run_id, rel);
    checked += 1;

    const isDatedRun = /^data\/evaluations\/\d{4}-\d{2}-\d{2}\/.+\.json$/.test(rel);
    if (parsed.publication_status !== "published") continue;
    if (!isDatedRun) {
      throw new Error(`[manifest] published evaluation must live below a YYYY-MM-DD directory: ${rel}`);
    }
    const directoryDate = rel.split("/")[2];
    if (directoryDate !== parsed.run_date) {
      throw new Error(
        `[manifest] published evaluation run_date ${parsed.run_date} does not match directory ${directoryDate}: ${rel}`,
      );
    }

    const id = rel
      .replace(/^data\/evaluations\//, "")
      .replace(/\.json$/, "")
      .replace(/\//g, "__");
    const fullRecord = { ...parsed, id, source_path: rel };
    fs.writeFileSync(path.join(EVALUATIONS_OUT_RAW, `${id}.json`), JSON.stringify(fullRecord));

    const summary = { ...fullRecord };
    delete summary.raw_output;
    summaries.push(summary);
  }

  summaries.sort((a, b) => {
    if (a.run_date !== b.run_date) return a.run_date < b.run_date ? 1 : -1;
    return a.id.localeCompare(b.id);
  });

  fs.writeFileSync(
    path.join(EVALUATIONS_OUT, "index.json"),
    JSON.stringify({ schema_version: 1, generated_at: new Date().toISOString(), runs: summaries }),
  );
  console.log(
    `[manifest] validated ${checked} evaluation files; wrote ${summaries.length} published runs`,
  );
}

if (!evaluationsOnly) buildPerformanceManifest();
buildEvaluationManifest();
