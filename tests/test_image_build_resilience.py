import subprocess
import unittest
import json
from pathlib import Path


ROOT = Path(__file__).parents[1]
BUILD_SCRIPT = ROOT / "dockerfiles/build.sh"
DAILY_SCRIPT = ROOT / "dockerfiles/daily.sh"
NIGHTLY_WORKFLOW = ROOT / ".github/workflows/nightly-build.yml"
SPARK_VLLM_META = ROOT / "dockerfiles/vllm-cuda-spark/meta.json"
HALO_GFX11_DOCKERFILE = ROOT / "dockerfiles/vllm-rocm-halo-wheel/Dockerfile"
HALO_MAIN_DOCKERFILE = ROOT / "dockerfiles/vllm-rocm-halo-main/Dockerfile"
LLAMA_ROCM_DOCKERFILES = [
    ROOT / "dockerfiles/llama-rocm-halo/Dockerfile",
    ROOT / "dockerfiles/llama-rocm-r9700/Dockerfile",
]


class ImageBuildResilienceTests(unittest.TestCase):
    def test_docker_pull_retries_then_succeeds_and_is_bounded(self):
        script = f"""
source <(sed '/^main "\\$@"$/d' {BUILD_SCRIPT})
calls=0
run_on() {{ calls=$((calls + 1)); (( calls >= 3 )); }}
docker_pull_with_retry local '--platform linux/amd64' example/image:tag >/dev/null 2>&1
[[ "$calls" -eq 3 ]]
calls=0
run_on() {{ calls=$((calls + 1)); return 1; }}
if docker_pull_with_retry local '' example/image:tag >/dev/null 2>&1; then
  exit 1
else
  rc=$?
fi
[[ "$rc" -eq 1 && "$calls" -eq 3 ]]
"""
        subprocess.run(["bash", "-c", script], check=True)

    def test_spark_vllm_mirror_uses_native_host_with_remote_login(self):
        meta = json.loads(SPARK_VLLM_META.read_text())
        self.assertEqual(meta["platform"], "linux/arm64")
        self.assertRegex(meta["mirror_host"], r"^spark\d+$")

        workflow = NIGHTLY_WORKFLOW.read_text()
        spark_job = workflow.split("  build-spark:", 1)[1].split("\n  verify-halo-runtime:", 1)[0]
        self.assertIn('INFERSTATION_FORCE_LOCAL_BUILD=0 run_one vllm-cuda-spark', DAILY_SCRIPT.read_text())
        self.assertIn('registry_login_on_host "$mirror_host" "$registry"', BUILD_SCRIPT.read_text())

        script = f"""
source <(sed '/^main "\\$@"$/d' {BUILD_SCRIPT})
tmp=$(mktemp)
run_on() {{ printf '%s\\n' "$1|$2|$(cat)" > "$tmp"; }}
GHCR_PAT=not-a-real-token
GHCR_USER=test-user
registry_login_on_host spark2 ghcr.io/inferstation/vllm-cuda-spark
grep -q '^spark2|docker login ghcr.io -u test-user --password-stdin >/dev/null|not-a-real-token$' "$tmp"
rm -f "$tmp"
"""
        subprocess.run(["bash", "-c", script], check=True)

    def test_spark_vllm_can_recover_a_requested_nightly(self):
        daily = DAILY_SCRIPT.read_text()
        self.assertIn('[[ "$NIGHTLY_DATE" =~ ^[0-9]{8}$ ]]', daily)
        self.assertIn('DATE="$NIGHTLY_DATE"', daily)
        self.assertIn("  spark-vllm)", daily)

        workflow = NIGHTLY_WORKFLOW.read_text()
        self.assertIn("          - spark-vllm", workflow)
        self.assertIn("NIGHTLY_DATE: ${{ inputs.nightly_date }}", workflow)
        self.assertIn("spark-vllm) repos=(vllm-cuda-spark)", workflow)

    def test_llama_rolling_build_uses_exact_revision_as_cachebust(self):
        daily = DAILY_SCRIPT.read_text()
        self.assertIn('[[ "$sha" =~ ^[0-9a-f]{40}$ ]]', daily)
        self.assertEqual(daily.count('--build-arg "CACHEBUST=${sha}"'), 2)

        for dockerfile in LLAMA_ROCM_DOCKERFILES:
            source = dockerfile.read_text()
            self.assertIn("ARG CACHEBUST", source)
            self.assertIn('git fetch --depth=1 origin "${CACHEBUST}"', source)
            self.assertIn(
                'test "$(git rev-parse HEAD)" = "${CACHEBUST}"', source
            )
            self.assertIn(
                'org.opencontainers.image.revision="${CACHEBUST}"', source
            )

    def test_gfx11_patch_covers_all_known_stride_checks(self):
        source = HALO_GFX11_DOCKERFILE.read_text()
        self.assertIn(
            "for value in b_row_stride_bytes group_stride; do",
            source,
        )
        self.assertIn("! grep -rn 'std::in_range<int>(' csrc/rocm/", source)

    def test_halo_main_transformers_pin_can_follow_upstream(self):
        source = HALO_MAIN_DOCKERFILE.read_text()
        self.assertIn("transformers>=5.10.2", source)
        self.assertNotIn("transformers==5.10.2", source)


if __name__ == "__main__":
    unittest.main()