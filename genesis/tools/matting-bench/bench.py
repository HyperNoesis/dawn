#!/usr/bin/env python3
"""
Offline matting benchmark (v0.94). Same metric formulas as js/providers/matting-metrics.js, so numbers are comparable with the lab page.

Needs: numpy, opencv-python, onnxruntime (CPU build is fine).

  python3 tools/matting-bench/bench.py --selftest
  python3 tools/matting-bench/bench.py --model models/ppmatting_v2.onnx --clip clip.mp4 [--gt-dir gt/ --clip-name clip] [--out report.json]

Ground truth: PNG alpha (grayscale) files named <clip-name>_f<frameNo>.png in --gt-dir (frameNo counts from 0).
Without ground truth you still get latency and the flicker score (no accuracy numbers).
Weights are NOT in the repo: node scripts/fetch-models.js --only ppmatting-v2   (SHA-256 checked).
Preprocessing = upstream PaddleSeg: RGB, (x/255-0.5)/0.5, short side <= 512, sides floored to a multiple of 32.
"""
import argparse, json, sys, time
import numpy as np


# ---- metrics (mirror of matting-metrics.js; alpha planes are uint8/float in 0..255) ----
def errors(pred, gt, trimap=None):
    d = (pred.astype(np.float64) - gt.astype(np.float64)) / 255.0
    if trimap is not None:
        d = d[trimap == 128]
    n = d.size
    return {"sad": float(np.abs(d).sum() / 1000), "mad": float(np.abs(d).mean() * 1000) if n else 0.0,
            "mse": float((d * d).mean() * 1000) if n else 0.0, "pixels": int(n)}


def sobel(a):
    a = a.astype(np.float64)
    out = np.zeros_like(a)
    gx = (-a[:-2, :-2] - 2 * a[1:-1, :-2] - a[2:, :-2] + a[:-2, 2:] + 2 * a[1:-1, 2:] + a[2:, 2:])
    gy = (-a[:-2, :-2] - 2 * a[:-2, 1:-1] - a[:-2, 2:] + a[2:, :-2] + 2 * a[2:, 1:-1] + a[2:, 2:])
    out[1:-1, 1:-1] = np.sqrt(gx * gx + gy * gy) / (255 * 4)
    return out


def gradient_error(pred, gt):
    d = sobel(pred) - sobel(gt)
    return float((d * d).sum() / 1000 * 100)


def dtssd(pred_seq, gt_seq):
    if len(pred_seq) != len(gt_seq) or len(pred_seq) < 2:
        raise ValueError("need >= 2 frames of each")
    s, c = 0.0, 0
    for f in range(1, len(pred_seq)):
        d = ((pred_seq[f].astype(np.float64) - pred_seq[f - 1]) - (gt_seq[f].astype(np.float64) - gt_seq[f - 1])) / 255.0
        s += float((d * d).sum()); c += d.size
    return float(np.sqrt(s / c) * 100)


def flicker(seq, luma_seq=None, still=6):
    if len(seq) < 2:
        return 0.0
    s, c = 0.0, 0
    for f in range(1, len(seq)):
        diff = np.abs(seq[f].astype(np.float64) - seq[f - 1])
        if luma_seq is not None:
            keep = np.abs(luma_seq[f].astype(np.float64) - luma_seq[f - 1]) <= still
            diff = diff[keep]
        s += float(diff.sum()); c += diff.size
    return float(s / (c * 255) * 100) if c else 0.0


def latency(ms):
    a = np.sort(np.array([v for v in ms if np.isfinite(v)], dtype=np.float64))
    if a.size == 0:
        return {"n": 0, "mean": 0, "p50": 0, "p95": 0, "max": 0, "fps": 0}
    mean = float(a.mean())
    return {"n": int(a.size), "mean": mean, "p50": float(np.percentile(a, 50)), "p95": float(np.percentile(a, 95)),
            "max": float(a[-1]), "fps": 1000 / mean if mean > 0 else 0}


# ---- model ----
def still_size(w, h, max_short=512, mult=32):
    if not (w >= mult and h >= mult):
        return None
    rw, rh = w, h
    short = min(w, h)
    if short > max_short:
        s = max_short / short
        rw, rh = round(w * s), round(h * s)
    rw -= rw % mult; rh -= rh % mult
    return max(mult, rw), max(mult, rh)


class Matter:
    def __init__(self, path):
        import onnxruntime as ort
        self.sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name  # "img"
        self.out = self.sess.get_outputs()[0].name  # "alpha"

    def __call__(self, bgr):
        import cv2
        h, w = bgr.shape[:2]
        size = still_size(w, h)
        if size is None:
            raise ValueError("frame smaller than 32 px")
        tw, th = size
        rgb = cv2.cvtColor(cv2.resize(bgr, (tw, th), interpolation=cv2.INTER_LINEAR), cv2.COLOR_BGR2RGB)
        x = (rgb.astype(np.float32) / 255.0 - 0.5) / 0.5
        x = np.ascontiguousarray(x.transpose(2, 0, 1)[None])
        a = self.sess.run([self.out], {self.inp: x})[0][0, 0]
        a = cv2.resize(a, (w, h), interpolation=cv2.INTER_LINEAR)
        return np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8)


def selftest():
    rng = np.random.default_rng(0)
    gt = np.zeros((64, 64), np.uint8); gt[16:48, 16:48] = 255
    assert errors(gt, gt)["mad"] == 0 and gradient_error(gt, gt) == 0
    noisy = np.clip(gt.astype(int) + rng.integers(-20, 20, gt.shape), 0, 255).astype(np.uint8)
    assert errors(noisy, gt)["mad"] > 0 and gradient_error(noisy, gt) > 0
    seq = [gt] * 3
    assert dtssd(seq, seq) == 0 and flicker(seq) == 0
    shaky = [gt, noisy, gt]
    assert flicker(shaky) > 0 and dtssd(shaky, seq) > 0
    assert still_size(1920, 1080) == (896, 512) and still_size(640, 480) == (640, 480) and still_size(20, 900) is None
    l = latency([10, 20, 30, 40])
    assert abs(l["p50"] - 25) < 1e-9 and l["n"] == 4
    print("bench.py selftest passed")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--model"); ap.add_argument("--clip")
    ap.add_argument("--gt-dir"); ap.add_argument("--clip-name")
    ap.add_argument("--max-frames", type=int, default=300)
    ap.add_argument("--out", default="bench_report.json")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not (a.model and a.clip):
        ap.error("--model and --clip are required (or use --selftest)")
    import cv2, os
    m = Matter(a.model)
    cap = cv2.VideoCapture(a.clip)
    if not cap.isOpened():
        sys.exit("cannot open clip " + a.clip)
    preds, lumas, ms = [], [], []
    while len(preds) < a.max_frames:
        ok, fr = cap.read()
        if not ok:
            break
        t = time.perf_counter()
        preds.append(m(fr))
        ms.append((time.perf_counter() - t) * 1000)
        lumas.append(cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY))
    rep = {"model": a.model, "clip": a.clip, "frames": len(preds), "latency": latency(ms),
           "flicker": flicker(preds, lumas),
           "note": "CPU onnxruntime on this machine; speed here says nothing about a phone."}
    if a.gt_dir and a.clip_name:
        errs = []
        for f, p in enumerate(preds):
            fn = os.path.join(a.gt_dir, "%s_f%d.png" % (a.clip_name, f))
            if os.path.exists(fn):
                g = cv2.imread(fn, cv2.IMREAD_GRAYSCALE)
                if g.shape != p.shape:
                    g = cv2.resize(g, (p.shape[1], p.shape[0]))
                e = errors(p, g); e["grad"] = gradient_error(p, g); e["frame"] = f; errs.append(e)
        if errs:
            rep["labelled_frames"] = len(errs)
            rep["mean_mad"] = float(np.mean([e["mad"] for e in errs]))
            rep["mean_sad"] = float(np.mean([e["sad"] for e in errs]))
            rep["mean_grad"] = float(np.mean([e["grad"] for e in errs]))
            rep["per_frame"] = errs
    json.dump(rep, open(a.out, "w"), indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k != "per_frame"}, indent=1))


if __name__ == "__main__":
    main()
