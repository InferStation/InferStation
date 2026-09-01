import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
BUILD_SCRIPT = ROOT / "dockerfiles/build.sh"
HALO_GFX11_DOCKERFILE = ROOT / "dockerfiles/vllm-rocm-halo-wheel/Dockerfile"
HALO_MAIN_DOCKERFILE = ROOT / "dockerfiles/vllm-rocm-halo-main/Dockerfile"


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