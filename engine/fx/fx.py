"""The effects, frame by frame (2026-10-24). Called by engine/fx.ts, never by hand:
    python fx.py <work dir>
The work dir holds f/00001.jpg... (the shot at 30 fps, 1080x1920), m/00001.png... (the person, white), a/*.png (the
pictures Chrome drew for this effect) and spec.json ({effect, fps, face: [cx, cy, w, h] in pixels, cut, ...}).
Writes raw rgb24 frames to stdout for ffmpeg. numpy and Pillow only (the editor's venv has both).
"""
import json, math, os, random, sys
import numpy as np
from PIL import Image, ImageFilter

D = sys.argv[1]
S = json.load(open(os.path.join(D, 'spec.json')))
FPS, W, H = S.get('fps', 30), 1080, 1920
FR = sorted(os.listdir(os.path.join(D, 'f')))
N = len(FR)
out = sys.stdout.buffer
random.seed(7)


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def ease_in(x):
    x = min(1.0, max(0.0, x))
    return x * x * x


def ease_out(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


def frame(i):
    return np.asarray(Image.open(os.path.join(D, 'f', FR[i])).convert('RGB'), dtype=np.float32) / 255


def mask_img(i):
    return Image.open(os.path.join(D, 'm', FR[i].replace('.jpg', '.png'))).convert('L')


def mask(i, soften=1.5):
    return np.asarray(mask_img(i).filter(ImageFilter.GaussianBlur(soften)), dtype=np.float32)[..., None] / 255


def asset(name):
    return Image.open(os.path.join(D, 'a', name)).convert('RGBA')


def rgba(img):
    a = np.asarray(img, dtype=np.float32) / 255
    return a[..., :3], a[..., 3:4]


def over(dst, src_rgb, src_a):
    return dst * (1 - src_a) + src_rgb * src_a


def place(dst, img, x, y, alpha=1.0):
    """An RGBA picture laid on dst with its top left at x, y (clipped to the frame)."""
    rgb, a = rgba(img)
    h, w = rgb.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x0 >= x1 or y0 >= y1:
        return dst
    sx, sy = x0 - x, y0 - y
    region = dst[y0:y1, x0:x1]
    dst[y0:y1, x0:x1] = over(region, rgb[sy:sy + y1 - y0, sx:sx + x1 - x0], a[sy:sy + y1 - y0, sx:sx + x1 - x0] * alpha)
    return dst


def zoom(img, z, cx, cy):
    """img (float HxWx3) pushed in z times towards cx, cy, the window kept inside the picture."""
    if z <= 1.0001:
        return img
    w, h = W / z, H / z
    x0 = min(W - w, max(0, cx - w / 2))
    y0 = min(H - h, max(0, cy - h / 2))
    pil = Image.fromarray((img * 255).astype(np.uint8))
    return np.asarray(pil.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + w, y0 + h)), dtype=np.float32) / 255


def resize(img, s):
    pil = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    return np.asarray(pil.resize((max(1, int(W * s)), max(1, int(H * s))), Image.BICUBIC), dtype=np.float32) / 255


def emit(img):
    out.write((np.clip(img, 0, 1) * 255).astype(np.uint8).tobytes())


def label(img):
    if os.path.exists(os.path.join(D, 'a', 'label.png')):
        rgb, a = rgba(asset('label.png'))
        img = over(img, rgb, a)
    return img


def fill_behind(img, m, grow=40):
    """The background with the person painted out (a wide blur of what is around them), for moves that would
    otherwise show a second, bigger copy of the person."""
    md = np.asarray(Image.fromarray((m[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(grow / 3)), dtype=np.float32)[..., None] / 255
    md = np.clip(md * 1.6, 0, 1)
    keep = 1 - md
    small = lambda a: Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((W // 8, H // 8), Image.BILINEAR)
    k = np.asarray(small(img * keep).filter(ImageFilter.GaussianBlur(14)).resize((W, H), Image.BILINEAR), dtype=np.float32) / 255
    wgt = np.asarray(small(np.repeat(keep, 3, 2)).filter(ImageFilter.GaussianBlur(14)).resize((W, H), Image.BILINEAR), dtype=np.float32) / 255
    fill = k / np.maximum(wgt, 1e-3)
    return img * keep + fill * md


E = S['effect']
fx, fy, fw, fh = S.get('face', [W / 2, H * 0.3, 300, 300])

for i in range(N):
    t = i / FPS
    img = frame(i)

    if E == 'depth':
        # the word between the wall and the speaker: it lands slightly big and settles
        m = mask(i)
        p = ease((t - 0.2) / 0.45)
        txt = asset('word.png')
        s = 1.18 - 0.18 * p
        tw, th = int(W * s), int(H * s)
        bg = place(img.copy(), txt.resize((tw, th), Image.BICUBIC), (W - tw) // 2, (H - th) // 2, alpha=p)
        img = over(bg, img, m)

    elif E == 'digital-zoom':
        # a punch in, the camera's own recording frame and the zoom counter
        z = 1 + 0.3 * ease((t - 0.55) / 0.3)
        img = zoom(img, z, fx, fy + fh * 0.4)
        rgb, a = rgba(asset('rec.png'))
        img = over(img, rgb, a)
        k = int(round((z - 1) * 100))
        rgb, a = rgba(asset(f'x{k:02d}.png'))
        img = over(img, rgb, a)

    elif E == 'zoom-through':
        # into the speaker's face at the end of one shot, out of it at the start of the next
        cut = S['cut']
        if t < cut:
            z = 1 + 5 * ease_in((t - (cut - 0.4)) / 0.4)
        else:
            z = 1 + 5 * (1 - ease_out((t - cut) / 0.45))
        img = zoom(img, z, fx, fy)
        if z > 1.3 and i > 0:
            prev = zoom(frame(i - 1), z * 0.9, fx, fy)
            img = img * 0.6 + prev * 0.4   # motion blur on the fast part

    elif E == 'vertigo':
        # the speaker grows towards the camera while the place behind stays where it is (a dolly zoom); growing, they
        # always cover their own outline in the picture behind, so nothing has to be painted out
        m = mask(i)
        z = 1 + 0.24 * ease(t / max(0.1, N / FPS))
        big, bm = resize(img, z), resize(np.repeat(m, 3, 2), z)[..., :1]
        bw, bh = big.shape[1], big.shape[0]
        x0 = int(fx * z - fx)
        y0 = bh - H   # grows from the bottom edge up
        img = over(img, big[y0:y0 + H, x0:x0 + W], bm[y0:y0 + H, x0:x0 + W])
    elif E == 'green-screen':
        # the speaker on another place, the place drifting slowly
        m = mask(i, 1.2)
        place_img = asset('place.png').convert('RGB')
        pw, ph = place_img.size
        sc = max(W / pw, H / ph) * (1.04 + 0.06 * t / max(0.1, N / FPS))
        pl = place_img.resize((int(pw * sc), int(ph * sc)), Image.BICUBIC)
        x0, y0 = (pl.width - W) // 2, (pl.height - H) // 2
        bg = np.asarray(pl.crop((x0, y0, x0 + W, y0 + H)), dtype=np.float32) / 255
        img = over(bg, img, m)

    elif E == 'headline-wall':
        # clippings land on the wall behind the speaker one after another
        m = mask(i)
        bg = img.copy()
        for k in range(S['clips']):
            p = ease((t - 0.15 - 0.28 * k) / 0.22)
            if p <= 0:
                continue
            c = asset(f'clip{k}.png')
            s = 1.25 - 0.25 * p
            cw, ch = int(W * s), int(H * s)
            bg = place(bg, c.resize((cw, ch), Image.BICUBIC), (W - cw) // 2, (H - ch) // 2, alpha=p)
        img = over(bg, img, m)

    elif E == 'paper-cut':
        # the speaker cut out with scissors onto paper, moving at 12 pictures a second, the words pasted in
        j = int(t * 12) * FPS // 12
        j = min(N - 1, j)
        src = frame(j)
        mi = mask_img(j)
        rnd = random.Random(j)
        dx, dy = rnd.randint(-5, 5), rnd.randint(-5, 5)
        m = np.asarray(mi.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)[..., None] / 255
        edge = np.asarray(mi.filter(ImageFilter.MaxFilter(29)).filter(ImageFilter.GaussianBlur(1)), dtype=np.float32)[..., None] / 255
        shadow = np.asarray(mi.filter(ImageFilter.MaxFilter(29)).filter(ImageFilter.GaussianBlur(14)), dtype=np.float32)[..., None] / 255
        paper = np.asarray(asset('paper.png').convert('RGB'), dtype=np.float32) / 255
        img = paper * (1 - 0.35 * np.roll(shadow, (18, 10), (0, 1)))
        img = over(img, np.ones_like(img) * 0.98, np.roll(np.roll(edge, dy, 0), dx, 1))
        img = over(img, np.roll(np.roll(src, dy, 0), dx, 1), np.roll(np.roll(m, dy, 0), dx, 1))
        k = min(S['letters'], int(max(0, t - 0.35) * 9))
        if k > 0:
            rgb, a = rgba(asset(f'word{k:02d}.png'))
            img = over(img, rgb, a)

    elif E == 'frame-break':
        # the picture shrinks into a phone, and the speaker's head comes out over its top edge
        m = mask(i)
        p = ease((t - 0.25) / 0.5)
        s = 1 - 0.36 * p
        bgp = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(30)), dtype=np.float32) / 255 * 0.45
        small, sm = resize(img, s), resize(np.repeat(m, 3, 2), s)[..., :1]
        sw, sh = small.shape[1], small.shape[0]
        x, y = (W - sw) // 2, int((H - sh) * 0.62)
        inset = int(sh * (fy / H) * p)   # the screen's top edge comes down to the eyes: the head is out of it
        canvas = bgp.copy()
        canvas[y + inset:y + sh, x:x + sw] = small[inset:, :]
        if p > 0:
            canvas = place(canvas, asset('phone.png').resize((sw + 36, sh - inset + 36), Image.BICUBIC), x - 18, y + inset - 18, alpha=p)
        person = np.zeros_like(img)
        pa = np.zeros((H, W, 1), np.float32)
        person[y:y + sh, x:x + sw] = small
        pa[y:y + sh, x:x + sw] = sm
        img = over(canvas, person, pa)

    elif E == 'doodle-boil':
        # a hand-drawn line around the speaker and scribbles beside them, redrawn 8 times a second
        m = mask(i)
        b = int(t * 8)
        rnd = random.Random(b)
        mi = mask_img(i)
        r = 15 + rnd.randint(0, 6)
        outer = np.asarray(mi.filter(ImageFilter.MaxFilter(2 * r + 1)), dtype=np.float32) / 255
        inner = np.asarray(mi.filter(ImageFilter.MaxFilter(2 * (r - 7) + 1)), dtype=np.float32) / 255
        ring = np.clip(outer - inner, 0, 1)[..., None]
        ring = np.roll(np.roll(ring, rnd.randint(-4, 4), 0), rnd.randint(-4, 4), 1)
        grow = ease(t / 0.4)
        yy = np.linspace(0, 1, H)[:, None, None]
        ring = ring * (yy > 1 - grow)   # drawn on from the bottom up
        img = over(img, np.array([1.0, 0.82, 0.25]) * np.ones_like(img), ring * 0.95)
        rgb, a = rgba(asset(f'doodle{b % 3}.png'))
        img = over(img, rgb, a * min(1, t / 0.3))

    elif E == 'orbit':
        # cards going round the speaker at chest height: behind them on the far side, in front on the near side
        m = mask(i)
        n = S['cards']
        cy = fy + fh * 1.9
        back, front = [], []
        for k in range(n):
            th = t * 1.6 + 2 * math.pi * k / n
            depth = math.sin(th)
            s = 0.78 + 0.22 * depth
            c = asset(f'card{k}.png')
            cw, ch = int(c.width * s), int(c.height * s)
            c = c.resize((max(1, int(cw * (0.75 + 0.25 * abs(math.cos(th + 1.57))))), ch), Image.BICUBIC)
            x, y = int(fx + 400 * math.cos(th) - c.width / 2), int(cy + 90 * depth - c.height / 2)
            (front if depth > 0 else back).append((depth, c, x, y))
        bg = img.copy()
        for _, c, x, y in sorted(back, key=lambda q: q[0]):
            bg = place(bg, c, x, y, alpha=min(1, t / 0.3) * 0.85)
        img = over(bg, img, m)
        for _, c, x, y in sorted(front, key=lambda q: q[0]):
            img = place(img, c, x, y, alpha=min(1, t / 0.3))

    elif E == 'pull-back':
        # the picture pulls back and turns out to be in the editor
        p = ease((t - 0.7) / 0.7)
        s = 1 - 0.5 * p
        ui = np.asarray(asset('editor.png').convert('RGB'), dtype=np.float32) / 255
        small = resize(img, s)
        sw, sh = small.shape[1], small.shape[0]
        cx, cy = W // 2, int(H / 2 - 330 * p)
        canvas = ui.copy() if p > 0 else img
        if p > 0:
            x, y = cx - sw // 2, cy - sh // 2
            canvas[max(0, y):y + sh, max(0, x):x + sw] = small[max(0, -y):, max(0, -x):][:H - max(0, y), :W - max(0, x)]
        img = canvas

    emit(label(img))
