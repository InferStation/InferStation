# Accuracy evaluation JSON schema

InferStation stores one JSON object per accuracy evaluation run under:

```text
data/evaluations/<YYYY-MM-DD>/<descriptive-name>.json
```

The relative path is the stable public run ID. Do not rename a published file.
Files under `data/evaluations/examples/` are validated as examples but are never
included in the public accuracy manifest.

## File names

Use lowercase, filesystem-safe names that identify the target, model and suite:

```text
<target>-<model>-<suite>-<short-spec>-eval.json
```

For example:

```text
rtx-4090-qwen3-8b-quality-core-greedy-eval.json
openai-api-example-model-quality-core-greedy-eval.json
```

The filename is descriptive only. Readers must use fields inside the record and
must not infer model or benchmark configuration from the filename.

## Current record shape

```jsonc
{
  "schema_version": 1,
  "publication_status": "published",
  "run_date": "2026-08-14",
  "started_at": "2026-08-14T08:00:00Z",
  "completed_at": "2026-08-14T09:00:00Z",
  "status": "completed",

  "model": {
    "slug": "qwen3-8b",
    "name": "Qwen3-8B",
    "params_b": 8.2,
    "source_url": "https://huggingface.co/Qwen/Qwen3-8B",
    "revision": "immutable-model-revision",
    "quantization": "AWQ-4bit",
    "scheme": "W4A16"
  },

  "target": {
    "type": "local_server",
    "provider": "self-hosted",
    "model_id": "Qwen/Qwen3-8B",
    "endpoint_protocol": "openai-chat-completions",
    "region": "shanghai",
    "host": {
      "slug": "rtx-4090-sh",
      "name": "RTX 4090",
      "vendor": "NVIDIA",
      "chip": "RTX 4090",
      "accelerator_count": 1,
      "vram_gb": 24
    },
    "engine": {
      "slug": "vllm",
      "name": "vLLM",
      "version": "0.10.0",
      "commit": "immutable-engine-commit",
      "backend": "CUDA"
    }
  },

  "producer": {
    "name": "llm-eval-hub",
    "version": "0.1.0",
    "commit": "immutable-eval-hub-commit",
    "run_id": "eval-hub-run-uuid",
    "run_fingerprint": "sha256:eval-hub-protocol-fingerprint"
  },

  "evaluation": {
    "spec_id": "sha256:canonical-evaluation-spec-hash",
    "suite": {
      "slug": "inferstation-quality-core",
      "name": "InferStation Quality Core",
      "version": "2026.08"
    },
    "harness": {
      "name": "llm-eval-hub",
      "version": "0.1.0",
      "commit": "immutable-eval-hub-commit"
    },
    "adapter": {
      "name": "openai-compatible",
      "version": "1",
      "chat_template": "tokenizer-default",
      "prompt_template_sha256": "sha256:resolved-prompt-template"
    },
    "generation": {
      "temperature": 0,
      "top_p": 1,
      "seed": 42,
      "max_output_tokens": 32
    },
    "grader": null,
    "command": "LLM Eval Hub run; endpoint URL and credentials omitted"
  },

  "summary": {
    "score": null,
    "score_label": "No composite score",
    "normalization": "none",
    "completed_tasks": 1,
    "total_tasks": 1
  },

  "tasks": [
    {
      "dataset": {
        "slug": "gsm8k-native",
        "name": "GSM8K Native",
        "version": "native-v1@immutable-revision",
        "split": "test",
        "subset": null,
        "category": "reasoning/math",
        "source_url": "https://github.com/AMD-AIM/llm-eval-hub/tree/<commit>/datasets/benchmarks/gsm8k-native"
      },
      "dataset_checksum": "sha256:immutable-dataset-checksum",
      "protocol": {
        "id": "gsm8k-native-chat-0shot-v1",
        "task_type": "numeric_answer",
        "denominator_policy": "all_scoring_samples",
        "on_api_error": "exclude_and_report",
        "on_parse_error": "count_as_incorrect"
      },
      "status": "completed",
      "primary_metric": "numeric_match",
      "metrics": [
        {
          "name": "numeric_match",
          "label": "Numeric exact match",
          "value": 0.81,
          "unit": "ratio",
          "direction": "higher_is_better",
          "n": 1319,
          "stderr": 0.0108,
          "ci95": [0.7888, 0.8312]
        }
      ],
      "counters": {
        "total_samples": 1319,
        "scored_samples": 1319,
        "api_errors": 0,
        "parse_errors": 0,
        "score_errors": 0
      }
    }
  ],

  "usage": {
    "requests": 1319,
    "input_tokens": 1200000,
    "output_tokens": 180000,
    "billed_usd": null
  },

  "artifacts": {
    "source_url": "https://github.com/InferStation/InferStation/actions/runs/<run-id>",
    "log_url": "https://github.com/InferStation/InferStation/actions/runs/<run-id>",
    "report_url": "",
    "samples_url": "",
    "samples_sha256": ""
  },

  "notes": "Operational caveats or interpretation notes.",
  "raw_output": {}
}
```

## Required fields

The manifest builder rejects an evaluation file when any of these requirements
is not satisfied:

- `schema_version` is exactly `1`.
- `publication_status` is `published`, `draft`, or `example`.
- `run_date` is `YYYY-MM-DD`.
- `started_at` and `completed_at` are UTC ISO 8601 timestamps in chronological
  order.
- `status` is `completed`, `partial`, or `failed`.
- Model identity, quantization, target protocol, suite, harness, adapter and
  generation settings use the documented types; identifiers needed for
  reproduction are non-empty.
- `target.type` is `local_server` or `online_api`.
- Local-server records include complete host and engine identity.
- `producer` identifies the exact LLM Eval Hub version, immutable commit, run
  UUID, and frozen run fingerprint. Producer run IDs must be unique across all
  records, including examples and drafts.
- `evaluation.spec_id`, suite slug, suite name and suite version are non-empty.
- `tasks` is a non-empty array.
- Each task has a versioned dataset identity and checksum, frozen protocol and
  error policy, status, primary metric, upstream counters, and at least one
  metric; `primary_metric` must reference a metric in that task.
- Every metric has a finite numeric `value` and a known `unit` and `direction`.
- Ratio/percent values, sample counts, standard errors and confidence intervals
  are range-checked.
- Summary task counts must agree with the task records, and completed runs may
  not contain incomplete tasks.
- `summary.score` is `null` in schema version 1; no composite ranking is
  accepted until its normalization and weighting policy is separately
  versioned and reviewed.
- Usage, artifact and notes fields are always present (nullable numbers and
  empty strings are allowed where the information is unavailable).
- For published records, the date directory must match `run_date`.

Only records under a date directory with `publication_status: "published"` are
exposed on the website. `draft` and `example` records are still schema-checked.

## Model identity

`model.slug` is the stable display/catalog key. `model.revision` identifies the
exact model snapshot when one exists. For open-weight models, use an immutable
Hugging Face or Git commit. For an online API that does not expose a snapshot,
record the exact API model ID in `target.model_id` and leave `model.revision`
empty rather than inventing a revision.

Quantized models must record both the public quantization label and, when known,
the weight/activation scheme such as `W4A16`, `W8A8`, or `W16A16`.

## Target types

### Local server

Set `target.type` to `local_server`. `target.host` and `target.engine` are
required so accuracy can later be joined to the existing performance data.

Do not store credentials in `target`. An endpoint URL is intentionally not part
of the public schema: record the protocol and reproduction command instead.

### Online API

Set `target.type` to `online_api`. Record the provider, exact API model ID,
protocol and region. `target.host` and `target.engine` may be omitted.

Never commit API keys, authorization headers, signed URLs, account IDs, or
private endpoint query strings.

## Evaluation comparability

`evaluation.spec_id` is the comparison boundary. Runs may be compared only
when they have the same spec ID. Generate it from a canonical description
of at least:

- Dataset revisions, splits and subsets.
- System prompt, prompt template and chat template.
- Few-shot examples and count.
- Generation parameters and seed.
- Harness version and task configuration.
- Grader implementation, judge model and judge prompt.
- Input/output limits and truncation policy.

Changing any of those semantics requires a new spec ID and usually a new suite
version.

## Metrics

`unit` is one of:

- `ratio`: value in `[0, 1]`; the UI renders it as a percentage.
- `percent`: value already in `[0, 100]`.
- `score`: benchmark-defined numeric score.
- `seconds`: duration in seconds.
- `count`: integer-like count.

`direction` is `higher_is_better` or `lower_is_better`.

The metric named by `primary_metric` is the value displayed in the Summary.
Keep secondary metrics in the same array. Include `n`, `stderr`, and `ci95`
whenever the harness supplies them; do not calculate fake uncertainty values.

`metric.n` is copied from the matching Eval Hub metric denominator when one is
available. `counters` is copied from Eval Hub's frozen run-dataset state and
must keep API, parse, and score errors visible. Do not turn excluded errors into
incorrect answers or vice versa in the adapter.

`summary.score` is always `null` in the first release. Dataset primary metrics
remain separate; do not average unrelated tasks or invent an overall rank.

## LLM Eval Hub mapping

The JSON file is a reviewed public projection, not a dump of the Eval Hub
database. The adapter reads documented APIs and maps them as follows:

| Public field | LLM Eval Hub source |
| --- | --- |
| timestamps, status | `GET /api/v1/runs/{run_id}` |
| `producer.run_id` | run `id` |
| `producer.run_fingerprint` | run `protocol_fingerprint` |
| API model name | frozen `run_spec_json.model_name` |
| dataset checksum and protocol | frozen `run_spec_json.datasets[].manifest` |
| task counters | run `datasets[].counters_json` |
| metrics and denominators | `GET /api/v1/runs/{run_id}/metrics` |
| model/host/engine/public provider | reviewed InferStation sidecar metadata |

`producer.run_fingerprint` is the immutable Eval Hub execution fingerprint.
`evaluation.spec_id` is InferStation's comparison boundary; they are related
but are not interchangeable.

Never copy endpoint URLs, API keys, authorization headers, internal endpoint or
revision IDs, account IDs, or private network information into this public
record. `target.model_id` is the public API model name, not Eval Hub's internal
database UUID.

## Artifacts and sample data

The checked-in run file contains aggregate results. Large per-sample outputs
should remain in a GitHub Actions artifact or another durable public artifact
location and be linked through `artifacts.samples_url` with a SHA-256 digest.

Before publishing prompts or answers, check the dataset license and remove
secrets or personal data. When redistribution is not allowed, store dataset row
IDs and hashes rather than the original content.

`raw_output` is optional and excluded from the summary manifest. Keep it only
when it is reasonably small and useful for reproducing the aggregate result.

## Examples

- [`examples/local-server.example.json`](examples/local-server.example.json)
- [`examples/online-api.example.json`](examples/online-api.example.json)

Both examples contain synthetic scores and use
`publication_status: "example"`; they never appear in the public leaderboard.
