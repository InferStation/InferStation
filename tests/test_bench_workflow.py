import json
import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path

import yaml


WORKFLOW = Path(__file__).parents[1] / ".github/workflows/bench-batch.yml"
MATRIX_SCRIPT = Path(__file__).parents[1] / "scripts/bench-matrix.py"
SPEC = importlib.util.spec_from_file_location("bench_matrix", MATRIX_SCRIPT)
assert SPEC and SPEC.loader
bench_matrix = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bench_matrix
SPEC.loader.exec_module(bench_matrix)


class WorkflowMatrixTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workflow = yaml.safe_load(WORKFLOW.read_text())
        cls.workflow = workflow

    def matrix(self, target="all", runner=""):
        return bench_matrix.build_matrix(target, runner)["include"]

    def test_schedule_selects_all_six_runners(self):
        rows = self.matrix()
        self.assertEqual(len(rows), 6)
        self.assertEqual(len({row["label"] for row in rows}), 6)

    def test_target_selects_only_that_runner_pool(self):
        rows = self.matrix(target="halo")
        self.assertEqual(
            {row["label"] for row in rows},
            {"inferstation-halo3", "inferstation-halo4"},
        )

    def test_runner_label_selects_one_physical_runner(self):
        rows = self.matrix(target="spark", runner="inferstation-spark1")
        self.assertEqual([row["label"] for row in rows], ["inferstation-spark1"])

    def test_incompatible_target_and_runner_fail_before_dispatch(self):
        with self.assertRaisesRegex(ValueError, "no runner matches"):
            self.matrix(target="halo", runner="inferstation-spark1")

    def test_bench_uses_dynamic_matrix(self):
        matrix = self.workflow["jobs"]["bench"]["strategy"]["matrix"]
        self.assertIn("fromJSON(needs.schedule-gate.outputs.matrix)", matrix)

    def test_schedule_gate_calls_versioned_matrix_generator(self):
        steps = self.workflow["jobs"]["schedule-gate"]["steps"]
        self.assertEqual(steps[0]["uses"], "actions/checkout@v4")
        self.assertIn("python3 scripts/bench-matrix.py", steps[1]["run"])

    def test_matrix_cli_outputs_compact_json(self):
        result = subprocess.run(
            [
                sys.executable,
                str(MATRIX_SCRIPT),
                "--target",
                "spark",
                "--runner-label",
                "inferstation-spark1",
            ],
            check=True,
            text=True,
            capture_output=True,
        )
        self.assertEqual(
            json.loads(result.stdout)["include"][0]["label"],
            "inferstation-spark1",
        )

    def test_runner_targeted_recovery_is_unsharded(self):
        step = next(
            step for step in self.workflow["jobs"]["bench"]["steps"]
            if step.get("name") == "Run bench-batch directly"
        )
        self.assertIn('|| -n "$BENCH_RUNNER_LABEL"', step["run"])


if __name__ == "__main__":
    unittest.main()