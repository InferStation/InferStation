import importlib.util
import shlex
import socket
import subprocess
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "bench-batch.py"
SPEC = importlib.util.spec_from_file_location("bench_batch", SCRIPT)
assert SPEC and SPEC.loader
bench_batch = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bench_batch
SPEC.loader.exec_module(bench_batch)


class RetryTests(unittest.TestCase):
    def test_default_request_timeout_covers_historical_slow_c32(self):
        source = SCRIPT.read_text()
        self.assertIn(
            'os.environ.get("BENCH_REQUEST_TIMEOUT", "3600")', source
        )

    def test_retry_command_retries_then_succeeds(self):
        failure = subprocess.CalledProcessError(1, "docker pull image")
        with mock.patch.object(
            bench_batch, "sh", side_effect=[failure, "ok"]
        ) as run:
            delays = []
            result = bench_batch.retry_command(
                "docker pull image",
                attempts=2,
                label="pull",
                sleeper=delays.append,
            )
        self.assertEqual(result, "ok")
        self.assertEqual(run.call_count, 2)
        self.assertEqual(delays, [bench_batch.RETRY_DELAY_SECONDS])

    def test_retry_command_uses_redacted_display(self):
        with mock.patch.object(bench_batch, "sh", return_value="ok") as run:
            bench_batch.retry_command(
                "docker run -e HF_TOKEN=secret-token image",
                attempts=1,
                label="snapshot",
                display_cmd="docker run -e HF_TOKEN=<redacted> image",
            )
        self.assertEqual(
            run.call_args.kwargs["display_cmd"],
            "docker run -e HF_TOKEN=<redacted> image",
        )

    def test_transient_unit_failure_restarts_once(self):
        calls = []

        def runner(*args):
            calls.append(args)
            if len(calls) == 1:
                raise RuntimeError(
                    "serve-stream failed: completed=27/32, errors=['timed out']"
                )
            return [Path("result.json")]

        delays = []
        result = bench_batch.run_one_with_retries(
            {"host": "test"},
            {},
            None,
            runner=runner,
            attempts=2,
            sleeper=delays.append,
        )
        self.assertEqual(result, [Path("result.json")])
        self.assertEqual(len(calls), 2)
        self.assertEqual(delays, [bench_batch.RETRY_DELAY_SECONDS])

    def test_deterministic_unit_failure_is_not_retried(self):
        calls = []

        def runner(*args):
            calls.append(args)
            raise RuntimeError("invalid model configuration")

        with self.assertRaisesRegex(RuntimeError, "invalid model configuration"):
            bench_batch.run_one_with_retries(
                {"host": "test"},
                {},
                None,
                runner=runner,
                attempts=2,
                sleeper=lambda _: None,
            )
        self.assertEqual(len(calls), 1)

    def test_download_and_pull_commands_are_retryable(self):
        for command in (
            "docker pull ghcr.io/example/image:latest",
            "docker run curlimages/curl:8.10.1",
            "docker run python:3.11-slim hf download owner/model",
        ):
            error = subprocess.CalledProcessError(1, command)
            self.assertTrue(bench_batch.retryable_run_failure(error), command)
        for error in (
            socket.timeout("timed out"),
            TimeoutError("read operation timed out"),
            urllib.error.URLError(socket.timeout("timed out")),
            RuntimeError("server health timeout after 1800s"),
        ):
            self.assertTrue(bench_batch.retryable_run_failure(error), str(error))

    def test_gguf_download_is_resumable_and_shell_is_valid(self):
        host = {"slug": "test", "models_root": "/models"}
        model = {
            "host_dir": "model",
            "quants": {
                "Q4": {
                    "filename": "model.gguf",
                    "hf_repo": "owner/model",
                }
            },
        }
        completed = subprocess.CompletedProcess("download", 0)
        with mock.patch.object(
            bench_batch, "HF_TOKEN", "secret-token"
        ), mock.patch.object(bench_batch, "host_test", return_value=False), mock.patch.object(
            bench_batch, "sh", return_value=""
        ), mock.patch.object(bench_batch.subprocess, "run", return_value=completed) as run:
            path = bench_batch.ensure_model(host, "model", model, "Q4")

        self.assertEqual(path, "/models/model/model.gguf")
        command = run.call_args.args[0]
        self.assertNotIn("secret-token", command)
        self.assertIn("-e HF_TOKEN ", command)
        argv = shlex.split(command)
        inner = argv[-1]
        self.assertIn("--continue-at -", inner)
        self.assertIn("model.gguf.partial", inner)
        self.assertIn("missing content length", inner)
        subprocess.run(["sh", "-n", "-c", inner], check=True)

    def test_snapshot_download_is_staged_and_token_is_redacted(self):
        host = {"slug": "test", "models_root": "/models"}
        model = {
            "host_dir": "model",
            "quants": {
                "BF16": {
                    "format": "hf-snapshot",
                    "hf_repo": "owner/model",
                }
            },
        }
        with mock.patch.object(
            bench_batch, "HF_TOKEN", "secret-token"
        ), mock.patch.object(
            bench_batch, "host_test", side_effect=[False, True]
        ), mock.patch.object(
            bench_batch, "sh", return_value=""
        ) as shell, mock.patch.object(
            bench_batch, "retry_command", return_value=""
        ) as retry:
            path = bench_batch.ensure_model(host, "model", model, "BF16")

        self.assertEqual(path, "/models/model-BF16")
        retry_kwargs = retry.call_args.kwargs
        self.assertNotIn("secret-token", retry.call_args.args[0])
        self.assertIn("-e HF_TOKEN ", retry.call_args.args[0])
        self.assertNotIn("secret-token", retry_kwargs["display_cmd"])
        self.assertIn("HF_TOKEN=<redacted>", retry_kwargs["display_cmd"])
        self.assertIn("/models/model-BF16.partial:/dst", retry.call_args.args[0])
        final_command = shell.call_args_list[-1].args[0]
        self.assertIn(
            "mv /hostfs/models/model-BF16.partial /hostfs/models/model-BF16",
            final_command,
        )

    def test_archive_download_cleans_partial_extract_directory(self):
        host = {"slug": "test", "models_root": "/models"}
        model = {
            "host_dir": "model",
            "quants": {
                "BF16": {
                    "format": "hf-snapshot",
                    "archive_url": "https://example.invalid/model.tar",
                    "archive_sha256": "a" * 64,
                }
            },
        }
        with mock.patch.object(
            bench_batch, "host_test", return_value=False
        ), mock.patch.object(bench_batch, "sh", return_value="") as shell:
            bench_batch.ensure_model(host, "model", model, "BF16")

        script = shell.call_args.args[0]
        self.assertIn("trap 'rm -rf /models/model-BF16.partial' EXIT", script)
        subprocess.run(["sh", "-n", "-c", script], check=True)


if __name__ == "__main__":
    unittest.main()