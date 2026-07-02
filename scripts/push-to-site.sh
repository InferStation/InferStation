#!/usr/bin/env bash
# Push fresh bench JSON from the local repo to the InferStation site host,
# then regenerate the runs manifest in-place. No Next.js build needed —
# the site loads /data/runs.json at runtime.
#
# Run this from any bench host (e.g. dgx-spark-01) after bench-batch finishes.
set -euo pipefail

REPO="${REPO:-$HOME/InferStation}"
SITE_HOST="${SITE_HOST:-amd@10.161.176.110}"
SITE_ROOT="${SITE_ROOT:-/home/lkang/inferstation/site}"

cd "$REPO"

# 1. Copy per-run JSON files into the site's raw asset dir.
rsync -az "$REPO/data/runs/" "$SITE_HOST:$SITE_ROOT/data/runs-src/"

# 2. Regenerate the manifest on the site host (no Node needed — pure python3).
ssh "$SITE_HOST" "python3 - <<'PY'
import json, os, pathlib, datetime
root = pathlib.Path('$SITE_ROOT')
src  = root / 'data' / 'runs-src'
out_raw = root / 'data' / 'raw'
out_raw.mkdir(parents=True, exist_ok=True)
# Wipe stale per-id files so deletions propagate.
for f in out_raw.glob('*.json'):
    f.unlink()
summaries = []
for p in src.rglob('*.json'):
    try:
        rec = json.loads(p.read_text())
    except Exception as e:
        print(f'skip {p}: {e}')
        continue
    rel = str(p.relative_to(src))
    rid = rel.removesuffix('.json').replace(os.sep, '__')
    rec_full = {**rec, 'id': rid, 'source_path': f'data/runs/{rel}'}
    (out_raw / f'{rid}.json').write_text(json.dumps(rec_full))
    summary = dict(rec_full)
    summary.pop('raw_llamabench', None)
    summaries.append(summary)
summaries.sort(key=lambda r: (r.get('run_date',''), r['id']), reverse=True)
manifest = {'generated_at': datetime.datetime.utcnow().isoformat()+'Z', 'runs': summaries}
(root / 'data' / 'runs.json').write_text(json.dumps(manifest))
print(f'wrote {len(summaries)} runs')
PY"

echo "[push-to-site] done."
