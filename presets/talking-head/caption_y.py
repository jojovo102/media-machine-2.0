"""The caption line's height at given times, from the editor's own layout.py (the seam on split, the collar on wide and
tight, an F row's own line), so our captions sit exactly where Jason's would. Prints [y, layout mode] per time.
  python caption_y.py <editor preset folder> <job folder> t1 t2 ...
"""
import importlib.util, json, sys
from pathlib import Path
preset, job, times = Path(sys.argv[1]), Path(sys.argv[2]), [float(t) for t in sys.argv[3:]]
spec = importlib.util.spec_from_file_location('layout', preset / 'layout.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)
plan = json.loads((job / 'graphics-plan.json').read_text())
face = json.loads((job / 'face-frame.json').read_text()) if (job / 'face-frame.json').exists() else None
rows = plan.get('layout') or []
mode = lambda t: next((r['mode'] for r in rows if r['start'] - 1e-6 <= t < r['end']), 'W')
print(json.dumps([[L.caption_y_at(t, plan, face), mode(t)] for t in times]))
