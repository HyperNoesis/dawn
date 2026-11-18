#!/usr/bin/env python3
"""
Same-input engine comparison (v0.94): MODNet, RVM, PP-MattingV2, PP-Matting HRNet, BiRefNet-lite on identical images.
CPU onnxruntime. Speed here says NOTHING about phones. Weights: node scripts/fetch-models.js --only ppmatting-v2,ppmatting-hrnet,birefnet-lite (modnet/rvm ship in models/).

  python3 tools/matting-bench/compare_engines.py --models models --images img1.jpg img2.jpg [--gt-dir gt] --out out_dir

With --gt-dir (PNG alpha named <image stem>.png) real SAD/MAD/gradient numbers are reported against that ground truth.
WITHOUT ground truth the script reports only agreement between engines and edge statistics. Those are NOT accuracy numbers.
"""
import argparse, json, os, sys, time
import numpy as np, cv2
import onnxruntime as ort
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bench import errors, gradient_error, still_size  # same formulas as js/providers/matting-metrics.js


def session(path):
    so = ort.SessionOptions(); so.log_severity_level = 3
    return ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])


def to_chw(rgb, mean, std):
    x = (rgb.astype(np.float32) / 255.0 - np.array(mean, np.float32)) / np.array(std, np.float32)
    return np.ascontiguousarray(x.transpose(2, 0, 1)[None])


def run_pp(sess, bgr):
    h, w = bgr.shape[:2]; tw, th = still_size(w, h)
    rgb = cv2.cvtColor(cv2.resize(bgr, (tw, th), interpolation=cv2.INTER_LINEAR), cv2.COLOR_BGR2RGB)
    a = sess.run(None, {"img": to_chw(rgb, [.5] * 3, [.5] * 3)})[0][0, 0]
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_LINEAR)


def run_modnet(sess, bgr, ref=512):
    h, w = bgr.shape[:2]
    s = ref / min(h, w); tw, th = max(32, int(w * s) // 32 * 32), max(32, int(h * s) // 32 * 32)
    rgb = cv2.cvtColor(cv2.resize(bgr, (tw, th), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
    a = sess.run(None, {"input": to_chw(rgb, [.5] * 3, [.5] * 3)})[0][0, 0]
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_LINEAR)


def run_rvm(sess, bgr, long_edge=512):
    h, w = bgr.shape[:2]
    s = long_edge / max(h, w); tw, th = max(32, int(w * s) // 4 * 4), max(32, int(h * s) // 4 * 4)
    rgb = cv2.cvtColor(cv2.resize(bgr, (tw, th), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
    x = to_chw(rgb, [0] * 3, [1] * 3)
    z = np.zeros((1, 1, 1, 1), np.float32)
    feeds = {"src": x, "r1i": z, "r2i": z, "r3i": z, "r4i": z, "downsample_ratio": np.array([1.0], np.float32)}
    a = sess.run(None, feeds)[1][0, 0]
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_LINEAR)


def run_birefnet(sess, bgr, fit="letterbox"):
    """fit='stretch' squashes to 1024x1024 (v0.93 behaviour); 'letterbox' keeps the aspect ratio (v0.94 fix)."""
    h, w = bgr.shape[:2]; S = 1024
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    if fit == "stretch":
        img = cv2.resize(rgb, (S, S), interpolation=cv2.INTER_AREA); box = (0, 0, S, S)
    else:
        s = S / max(h, w); nw, nh = max(1, round(w * s)), max(1, round(h * s))
        img = np.zeros((S, S, 3), np.uint8) + np.array([124, 116, 104], np.uint8)   # ImageNet mean colour = zero after norm
        x0, y0 = (S - nw) // 2, (S - nh) // 2
        img[y0:y0 + nh, x0:x0 + nw] = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA); box = (x0, y0, nw, nh)
    o = sess.run(None, {"input_image": to_chw(img, [.485, .456, .406], [.229, .224, .225])})[0][0, 0].astype(np.float32)
    if o.min() < 0 or o.max() > 1:  # logits
        o = 1 / (1 + np.exp(-np.clip(o, -30, 30)))
    x0, y0, bw, bh = box
    return cv2.resize(o[y0:y0 + bh, x0:x0 + bw], (w, h), interpolation=cv2.INTER_LINEAR)


def edge_stats(a):
    a = np.clip(a, 0, 1)
    frac = ((a > 0.05) & (a < 0.95)).mean() * 100          # % of pixels with fractional alpha
    g = cv2.Sobel(a.astype(np.float32), cv2.CV_32F, 1, 0) ** 2 + cv2.Sobel(a.astype(np.float32), cv2.CV_32F, 0, 1) ** 2
    return {"fractional_pct": float(frac), "edge_energy": float(np.sqrt(g).mean())}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", default="models"); ap.add_argument("--images", nargs="+", required=True)
    ap.add_argument("--gt-dir"); ap.add_argument("--out", default="compare_out"); ap.add_argument("--skip", default="")
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    skip = set(filter(None, a.skip.split(",")))
    M = lambda n: os.path.join(a.models, n)
    eng = {}
    if "modnet" not in skip: eng["modnet"] = (session(M("modnet.onnx")), run_modnet)
    if "rvm" not in skip: eng["rvm"] = (session(M("rvm_mobilenetv3_fp32.onnx")), run_rvm)
    if "ppv2" not in skip: eng["ppmatting-v2"] = (session(M("ppmatting_v2.onnx")), run_pp)
    if "hrnet" not in skip: eng["ppmatting-hrnet"] = (session(M("ppmatting_v1.onnx")), run_pp)
    if "birefnet" not in skip:
        bs = session(M("birefnet_lite_fp16.onnx"))
        eng["birefnet-letterbox"] = (bs, lambda s, b: run_birefnet(s, b, "letterbox"))
        eng["birefnet-stretch"] = (bs, lambda s, b: run_birefnet(s, b, "stretch"))
    report = {"note": "CPU onnxruntime; no ground truth unless gt_dir given; agreement is not accuracy", "images": {}}
    for p in a.images:
        stem = os.path.splitext(os.path.basename(p))[0]; bgr = cv2.imread(p); res = {}; alphas = {}
        gt = None
        if a.gt_dir and os.path.exists(os.path.join(a.gt_dir, stem + ".png")):
            gt = cv2.imread(os.path.join(a.gt_dir, stem + ".png"), 0)
        for name, (s, fn) in eng.items():
            fn(s, bgr)                                     # warm-up (allocations), not timed
            t = time.perf_counter(); al = np.clip(fn(s, bgr), 0, 1); ms = (time.perf_counter() - t) * 1000
            alphas[name] = al; res[name] = {"ms": round(ms, 1), **edge_stats(al)}
            if gt is not None:
                g = cv2.resize(gt, (bgr.shape[1], bgr.shape[0])); u8 = (al * 255 + .5).astype(np.uint8)
                res[name].update({"mad": errors(u8, g)["mad"], "sad": errors(u8, g)["sad"], "grad": gradient_error(u8, g)})
        ref = alphas.get("birefnet-letterbox")
        if ref is not None:
            for n, al in alphas.items():
                res[n]["mad_vs_birefnet_x1000"] = round(float(np.abs(al - ref).mean() * 1000), 2)
        report["images"][stem] = res
        # contact sheet: each alpha as a cut-out on green + the alpha plane
        tiles = []
        for n, al in alphas.items():
            cut = (bgr * al[..., None] + np.array([60, 200, 60], np.float32) * (1 - al[..., None])).astype(np.uint8)
            cv2.putText(cut, n, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, .7, (255, 255, 255), 2); tiles.append(cut)
            cv2.imwrite(os.path.join(a.out, "%s_%s_alpha.png" % (stem, n)), (al * 255 + .5).astype(np.uint8))
        cols = 3; rows = [np.hstack(tiles[i:i + cols] + [np.zeros_like(tiles[0])] * (cols - len(tiles[i:i + cols]))) for i in range(0, len(tiles), cols)]
        cv2.imwrite(os.path.join(a.out, "%s_sheet.jpg" % stem), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])
    json.dump(report, open(os.path.join(a.out, "compare_report.json"), "w"), indent=1)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
