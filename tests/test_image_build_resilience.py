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

    def test_concurrent_model_tools_packaging_uses_isolated_temp_dirs(self):
        script = f"""
source <(sed '/^main "\\$@"$/d' {BUILD_SCRIPT})
SCRIPT_DIR={BUILD_SCRIPT.parent}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
cat > "$tmp/bin/jq" <<'SH'
#!/usr/bin/env bash
case "$2" in
    '.model_tools // false') echo true ;;
    '.package_host // ""') echo local ;;
    *) exit 1 ;;
esac
SH
cat > "$tmp/bin/docker" <<'SH'
#!/usr/bin/env bash
set -e
case "${{1:-}}" in
    version|pull|run|push|tag) exit 0 ;;
    image)
        if [[ "$*" == *org.inferstation.model-tools* ]]; then
            echo true
        fi
        exit 0
        ;;
    build)
        dockerfile=""
        while [[ $# -gt 0 ]]; do
            if [[ "$1" == "--file" ]]; then dockerfile="$2"; break; fi
            shift
        done
        [[ -f "$dockerfile" ]]
        printf '%s\\n' "$PWD" >> "$PACKAGE_DIR_LOG"
        exit 0
        ;;
    *) exit 1 ;;
esac
SH
chmod +x "$tmp/bin/jq" "$tmp/bin/docker"
export PATH="$tmp/bin:$PATH"
export PACKAGE_DIR_LOG="$tmp/package-dirs"
printf '{{"model_tools": true, "package_host": "local"}}\\n' > "$tmp/meta.json"

package_model_tools same-profile "$tmp/meta.json" local example/first test 0 1 &
first_pid=$!
package_model_tools same-profile "$tmp/meta.json" local example/second test 0 1 &
second_pid=$!
wait "$first_pid"
wait "$second_pid"

mapfile -t package_dirs < "$PACKAGE_DIR_LOG"
[[ "${{#package_dirs[@]}}" -eq 2 ]]
[[ "${{package_dirs[0]}}" != "${{package_dirs[1]}}" ]]
for package_dir in "${{package_dirs[@]}}"; do
    [[ ! -e "$package_dir" ]]
done
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
        self.assertIn(
            "NIGHTLY_DATE: ${{ needs.prepare.outputs.nightly_date }}", workflow
        )
        self.assertIn("spark-vllm) repos=(vllm-cuda-spark)", workflow)

    def test_nightly_date_is_frozen_once_before_build_queue(self):
        workflow = NIGHTLY_WORKFLOW.read_text()
        self.assertIn("  prepare:", workflow)
        self.assertIn(
            "nightly_date: ${{ steps.context.outputs.nightly_date }}", workflow
        )
        self.assertIn(
            "llama_revision: ${{ steps.context.outputs.llama_revision }}",
            workflow,
        )
        self.assertEqual(
            workflow.count(
                "NIGHTLY_DATE: ${{ needs.prepare.outputs.nightly_date }}"
            ),
            5,
        )
        self.assertIn('DATE="${{ needs.prepare.outputs.nightly_date }}"', workflow)
        verify_job = workflow.split("\n  verify:", 1)[1]
        self.assertNotIn("date -u +%Y%m%d", verify_job)

    def test_llama_revision_is_frozen_and_verified(self):
        workflow = NIGHTLY_WORKFLOW.read_text()
        expected_env = "LLAMA_REVISION: ${{ needs.prepare.outputs.llama_revision }}"
        halo_job = workflow.split("\n  build-halo:", 1)[1].split(
            "\n  build-halo-runtime:", 1
        )[0]
        r9700_job = workflow.split("\n  build-r9700:", 1)[1].split(
            "\n  # Spark NVIDIA", 1
        )[0]
        verify_job = workflow.split("\n  verify:", 1)[1]
        base_job = workflow.split("\n  build-radeon-base:", 1)[1].split(
            "\n  build-halo:", 1
        )[0]
        runtime_verify = workflow.split("\n  verify-halo-runtime:", 1)[1].split(
            "\n  verify:", 1
        )[0]
        for job in (halo_job, r9700_job, verify_job):
            self.assertIn(expected_env, job)
        for job in (base_job, runtime_verify):
            self.assertNotIn(expected_env, job)
        self.assertIn(
            "git ls-remote https://github.com/ggml-org/llama.cpp "
            "refs/heads/master",
            workflow,
        )
        self.assertIn(
            'actual=$(docker image inspect "$ref" --format '
            "'{{ index .Config.Labels \"org.opencontainers.image.revision\" }}')",
            workflow,
        )
        self.assertIn('[[ "$actual" == "$LLAMA_REVISION" ]]', workflow)

        daily = DAILY_SCRIPT.read_text()
        self.assertIn('local sha="${LLAMA_REVISION:-}"', daily)

    def test_llama_rolling_build_uses_exact_revision_as_cachebust(self):
        daily = DAILY_SCRIPT.read_text()
        self.assertIn('[[ "$sha" =~ ^[0-9a-f]{40}$ ]]', daily)
        self.assertEqual(daily.count('--build-arg "CACHEBUST=${sha}"'), 2)

        for dockerfile in LLAMA_ROCM_DOCKERFILES:
            source = dockerfile.read_text()
            self.assertIn("ARG CACHEBUST", source)
            self.assertIn('git fetch --depth=1 origin "${CACHEBUST}"', source)
            self.assertIn(
                'if [ -n "${CACHEBUST}" ]; then '
                'test "$(git rev-parse HEAD)" = "${CACHEBUST}"; fi',
                source,
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