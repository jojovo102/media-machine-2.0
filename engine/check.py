#!/usr/bin/env python3
"""Checks that can fail, on a finished reel (run check-reel.ts first).

usage: check.py <batch dir> <reel n> [speed]   (run by check.ts, which re-transcribes the reel first)
1. The reel's words against the script, word by word (difflib): what is extra, what is missing.
2. Said twice: any run of 3+ words the reel says more often than the script does.
3. Stutters and false starts: a word repeated, or a broken-off word followed by the full word ("domina dominava").
4. Cut points: the voice level in the 40 ms either side of every cut. Loud on both sides = a cut inside a word.
5. Pieces shorter than half a second.
6. First and last words of the reel against the script's.
"""
import collections, difflib, json, os, re, sys, unicodedata

d, n = sys.argv[1], sys.argv[2]
SPEED = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
work = os.path.join(d, 'work')


def norm(w):
    w = unicodedata.normalize('NFD', w.lower())
    w = ''.join(c for c in w if unicodedata.category(c) != 'Mn')
    w = w.replace('’', "'")
    return re.sub(r"[^a-z0-9']", '', w)


def toks(text):
    out = []
    for w in re.split(r"\s+|(?<=')", text):
        w = norm(w)
        if w:
            out.append(w)
    return out


scripts = json.load(open(os.path.join(work, 'scripts.json')))['scripts']
reels = json.load(open(os.path.join(work, 'reels.json')))
reel = next(r for r in reels if str(r['n']) == str(n))
script = next((s for s in scripts if s['title'] == reel['title']), scripts[0])
script_text = ' '.join(s['text'] for s in script['sentences'])
st = toks(script_text)
chk = json.load(open(os.path.join(work, 'check', f'reel-{n}.check.json')))
words = [w for w in chk['words'] if not w['filler']]
rt = [t for w in words for t in toks(w['w'])]
fails, notes = [], []

# 1. against the script
sm = difflib.SequenceMatcher(a=st, b=rt, autojunk=False)
extra, missing = [], []
for tag, a0, a1, b0, b1 in sm.get_opcodes():
    if tag in ('replace', 'insert'):
        extra.append(' '.join(rt[b0:b1]))
    if tag in ('replace', 'delete'):
        missing.append(' '.join(st[a0:a1]))
print(f'reel {n}: {len(rt)} words heard, script has {len(st)}; {sm.ratio()*100:.0f}% the same words in the same order')
if extra:
    print('  heard but not in the script (his own words, or a mishearing):')
    for e in extra:
        print('    +', e)
if missing:
    print('  in the script but not heard:')
    for m in missing:
        print('    -', m)

# 2. said twice: the same run of words twice, long enough to be a second take of one sentence (5+ words, or 4+ within
# 10 s), and not twice in the script. Different sentences that share a few words ("anche aiutare a correggere" /
# "anche aiutare a fare") are not a double take.
times = [w['start'] for w in words for t in toks(w['w'])]
script_str = ' ' + ' '.join(st) + ' '
seen = set()
for i in range(len(rt)):
    for j in range(i + 1, len(rt)):
        k = 0
        while j + k < len(rt) and i + k < j and rt[i + k] == rt[j + k]:
            k += 1
        if k < 4 or (i, k) in seen:
            continue
        b = 0
        while i - b - 1 >= 0 and rt[i - b - 1] == rt[j - b - 1] and i - b - 1 + k + b + 1 <= j:
            b += 1
        run, start = rt[i - b:i + k], i - b
        phrase = ' '.join(run)
        # the script says it twice itself, give or take a word at either end ("chiamiamo la Madonna del Rosario" for
        # "chiamiamo Madonna del Rosario", and "ma la Madonna del Rosario" later)
        cores = [phrase] + ([' '.join(run[1:]), ' '.join(run[:-1])] if len(run) >= 4 else [])
        if any(script_str.count(' ' + c + ' ') >= 2 for c in cores):
            continue
        apart = times[j] - times[i]
        if len(run) >= 5 or apart <= 10:
            seen.update((i + d, k - d) for d in range(k))
            fails.append(f'said twice: "{phrase}" at {times[i - b]:.1f} s and {times[j - b]:.1f} s')

# 3. stutters and false starts (on the reel's own words, in order). A word said twice is two sayings, the second
# starting at least 0.15 s after the first: the transcriber sometimes writes one word twice 0.05 s apart
# ("chiudere@13.74 chiudere@13.79", 2026-10-21), which is not a stutter.
script_pairs = set(zip(st, st[1:]))
tt = [w['start'] for w in words for t in toks(w['w'])]
for k, (a, b) in enumerate(zip(rt, rt[1:])):
    if tt[k + 1] - tt[k] < 0.15:
        continue
    if a == b and (a, b) not in script_pairs and len(a) > 1:
        fails.append(f'stutter: "{a} {b}" at {tt[k]:.1f} s')
    elif len(a) >= 3 and b.startswith(a) and a != b and (a, b) not in script_pairs:
        fails.append(f'false start: "{a}... {b}" at {tt[k]:.1f} s')

# 4. cut points on the reel's clock
lv = json.load(open(os.path.join(work, 'check', f'reel-{n}.levels.json')))
voiced = sorted(lv)
thr = voiced[int(len(voiced) * 0.35)] + 8  # a little above the quiet floor: speech
cuts, pos = [], 0.0
for p in reel['pieces'][:-1]:
    pos += (p['b'] - p['a']) / SPEED
    cuts.append(pos)
inside = []
for t in cuts:
    i = int(round(t * 100))
    before, after = lv[max(0, i - 4):i], lv[i:i + 4]
    if before and after and min(before) > thr and min(after) > thr:
        inside.append(t)
print(f'  {len(cuts)} cuts; {len(cuts) - len(inside)} in a pause or a dip, {len(inside)} with voice on both sides')
for t in inside:
    near = [w['w'] for w in words if w['start'] - 0.6 <= t <= w['end'] + 0.6]
    fails.append(f'cut inside the voice at {int(t // 60)}:{t % 60:04.1f} ({" ".join(near)})')

# 5. short pieces
for k, p in enumerate(reel['pieces']):
    if (p['b'] - p['a']) / SPEED < 0.5:
        notes.append(f'piece {k + 1} is {(p["b"] - p["a"]) / SPEED:.2f} s long')

# 6. first and last words
if rt[:3] != st[:3]:
    notes.append(f'starts with "{" ".join(rt[:5])}", the script with "{" ".join(st[:5])}" (a hook in his own words: look at cut-n.md)')
if rt[-3:] != st[-3:]:
    notes.append(f'ends with "{" ".join(rt[-3:])}", the script with "{" ".join(st[-3:])}"')

print('  FAILS:' if fails else '  no fails')
for f in fails:
    print('   x', f)
for x in notes:
    print('   note:', x)
sys.exit(1 if fails else 0)
