#!/usr/bin/env python3
"""Evaluate predicted alpha against independent, aligned ground truth. Never resize silently."""
import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage

SHA256 = re.compile(r"^[a-f0-9]{64}$", re.I)
REQUIRED_STRATA = (
    "hair-straight", "hair-wavy", "hair-curly", "hair-coily", "flyaways", "braids",
    "dark-light-hair-background", "backlight", "low-light", "similar-colours",
    "glasses", "headphones", "hats-headwraps", "hands-crossing-face", "finger-gaps",
    "thin-straps", "lace", "transparent-fabric", "textured-clothes", "motion-blur",
    "partial-occlusion", "multiple-people", "scene-cuts",
)
RUNTIME_FIELDS = (
    "inference_ms", "mask_age_ms", "camera_fps", "render_fps", "preview_fps",
    "dropped_frames", "memory_mb", "battery_pct",
)


def unit(image):
    a = np.asarray(image, dtype=np.float32)
    if a.ndim != 2 or a.size == 0 or not np.isfinite(a).all():
        raise ValueError("alpha must be non-empty, single-channel and finite")
    return np.clip(a / (255.0 if a.max() > 1 else 1.0), 0, 1)


def boundary(mask):
    mask = np.asarray(mask, dtype=bool)
    return mask ^ ndimage.binary_erosion(mask, structure=np.ones((3, 3), bool), border_value=0)


def _components(mask):
    return ndimage.label(np.asarray(mask, dtype=bool), structure=np.ones((3, 3), bool))


def topology_metrics(prediction, target):
    p, g = prediction >= .5, target >= .5
    pl, pn = _components(p)
    gl, gn = _components(g)
    pa = np.bincount(pl.ravel())[1:] if pn else np.array([], dtype=int)
    ga = np.bincount(gl.ravel())[1:] if gn else np.array([], dtype=int)
    ph_mask = ndimage.binary_fill_holes(p) & ~p
    gh_mask = ndimage.binary_fill_holes(g) & ~g
    ph_labels, ph = _components(ph_mask)
    gh_labels, gh = _components(gh_mask)

    connectivity_error = abs(pn - gn) / max(1, pn, gn)
    hole_count_error = abs(ph - gh) / max(1, ph, gh)
    small_labels = []
    if len(ga):
        largest = int(ga.max())
        small_labels = [i + 1 for i, area in enumerate(ga) if area < .10 * largest]
    small_hits = sum(float(p[gl == label].mean()) >= .5 for label in small_labels)
    small_recall = small_hits / len(small_labels) if small_labels else 1.0

    false_components = 0
    for label in range(1, pn + 1):
        region = pl == label
        overlap = np.bincount(gl[region].ravel(), minlength=gn + 1)
        best = int(overlap[1:].max()) if gn else 0
        if best / max(1, int(region.sum())) < .25:
            false_components += 1
    false_rate = false_components / max(1, pn)

    retained_holes = 0
    for label in range(1, gh + 1):
        region = gh_labels == label
        if region.any() and float((~p[region]).mean()) >= .5:
            retained_holes += 1
    hole_retention = retained_holes / gh if gh else 1.0
    error = float(np.clip(np.mean([
        connectivity_error, hole_count_error, 1.0 - small_recall, false_rate
    ]), 0, 1))
    return {
        "connectivity_error_rate": float(connectivity_error),
        "hole_count_error_rate": float(hole_count_error),
        "hole_retention": float(hole_retention),
        "small_subject_recall": float(small_recall),
        "false_component_rate": float(false_rate),
        "topology_error_rate": error,
        "topologyErrorRate": error,
        "predicted_components": int(pn),
        "target_components": int(gn),
        "predicted_holes": int(ph),
        "target_holes": int(gh),
    }


def alpha_metrics(prediction, target, tolerance=2):
    p, g = unit(prediction), unit(target)
    if p.shape != g.shape:
        raise ValueError(f"shape mismatch: {p.shape} vs {g.shape}")
    e = p - g
    px, py = np.gradient(p)
    gx, gy = np.gradient(g)
    pb, gb = boundary(p >= .5), boundary(g >= .5)
    if not pb.any() and not gb.any():
        precision = recall = 1.0
    elif not pb.any() or not gb.any():
        precision = recall = 0.0
    else:
        st = np.ones((2 * max(0, int(tolerance)) + 1,) * 2, bool)
        precision = float((pb & ndimage.binary_dilation(gb, structure=st)).sum()) / max(1, int(pb.sum()))
        recall = float((gb & ndimage.binary_dilation(pb, structure=st)).sum()) / max(1, int(gb.sum()))
    f1 = 2 * precision * recall / max(1e-12, precision + recall)

    edge_zone = ndimage.binary_dilation(gb, iterations=max(0, int(tolerance))) if tolerance else gb
    edge_band_mae = float(np.abs(e[edge_zone]).mean()) if edge_zone.any() else float(np.abs(e).mean())
    semi_gt, semi_pred = (g > .05) & (g < .95), (p > .05) & (p < .95)
    semi_mae = float(np.abs(e[semi_gt]).mean()) if semi_gt.any() else None
    semi_recall = float((semi_pred & semi_gt).sum() / max(1, int(semi_gt.sum()))) if semi_gt.any() else None

    calibration = 0.0
    for lo in np.arange(0, 1, .1):
        hi = min(1.0, lo + .1)
        mask = (p >= lo) & (p < hi if hi < 1 else p <= hi)
        if mask.any():
            calibration += float(mask.mean()) * abs(float(p[mask].mean()) - float(g[mask].mean()))

    result = {
        "mae": float(np.abs(e).mean()),
        "alphaMAD": float(np.abs(e).mean()),
        "mse": float((e * e).mean()),
        "sad_per_1000px": float(np.abs(e).sum() / 1000),
        "gradient_mae": float((np.abs(px - gx).mean() + np.abs(py - gy).mean()) / 2),
        "boundary_precision": precision,
        "boundary_recall": recall,
        "boundary_f1": float(f1),
        "boundaryF1": float(f1),
        "edge_band_mae": edge_band_mae,
        "edgeBandMAD": edge_band_mae,
        "alpha_calibration_mae": float(calibration),
        "semi_transparent_pixel_count_prediction": int(semi_pred.sum()),
        "semi_transparent_pixel_count_target": int(semi_gt.sum()),
        "semi_transparent_mae": semi_mae,
        "semi_transparent_recall": semi_recall,
    }
    result.update(topology_metrics(p, g))
    return result


def sequence_metrics(records):
    groups = defaultdict(list)
    for record in records:
        if record.get("sequence") is not None:
            groups[str(record["sequence"])].append(record)
    result = {}
    for name, frames in groups.items():
        frames.sort(key=lambda r: int(r.get("frame", 0)))
        if len(frames) < 2:
            continue
        delta, pred_flicker, target_flicker = [], [], []
        for a, b in zip(frames, frames[1:]):
            p0, p1 = unit(a["prediction_array"]), unit(b["prediction_array"])
            t0, t1 = unit(a["target_array"]), unit(b["target_array"])
            if p0.shape != p1.shape or t0.shape != t1.shape or p0.shape != t0.shape:
                raise ValueError("sequence dimensions differ: " + name)
            dp, dt = p1 - p0, t1 - t0
            delta.append(np.abs(dp - dt).mean())
            pred_flicker.append(np.abs(dp).mean())
            target_flicker.append(np.abs(dt).mean())
        result[name] = {
            "temporal_delta_mae": float(np.mean(delta)),
            "temporalDeltaMAE": float(np.mean(delta)),
            "prediction_flicker": float(np.mean(pred_flicker)),
            "target_flicker": float(np.mean(target_flicker)),
            "frame_pairs": len(delta),
            "motion_compensated_flicker": None,
            "motion_compensation_note": "Not computed: aligned source RGB frames and validated optical flow are not supplied.",
        }
    return result


def bootstrap_ci(values, seed=20261126, samples=1000):
    values = np.asarray(values, dtype=np.float64)
    if len(values) < 2:
        return None
    rng = np.random.default_rng(seed)
    draws = rng.choice(values, size=(samples, len(values)), replace=True).mean(axis=1)
    return {"low_95": float(np.quantile(draws, .025)), "high_95": float(np.quantile(draws, .975))}


def percentiles(values):
    a = np.asarray(values, dtype=np.float64)
    if not len(a):
        return None
    return {"count": int(len(a)), "p50": float(np.percentile(a, 50)),
            "p75": float(np.percentile(a, 75)), "p95": float(np.percentile(a, 95)),
            "max": float(np.max(a))}


def validate_commercial_entry(item, line_no):
    required = (
        "participant_id", "source_video_id", "clip_id", "split", "strata",
        "annotation_confidence", "annotation_protocol_sha256",
        "inter_annotator_review_sha256", "independent_annotators", "frame_alignment_verified",
    )
    missing = [key for key in required if key not in item]
    if missing:
        raise ValueError(f"manifest line {line_no} missing commercial benchmark fields: {', '.join(missing)}")
    if item["split"] not in ("test", "benchmark"):
        raise ValueError(f"manifest line {line_no} is not a held-out test/benchmark split")
    for key in ("participant_id", "source_video_id", "clip_id"):
        if not isinstance(item[key], str) or not item[key].strip():
            raise ValueError(f"manifest line {line_no} has an empty {key}")
    if not isinstance(item["strata"], list) or not item["strata"] or not all(isinstance(x, str) and x for x in item["strata"]):
        raise ValueError(f"manifest line {line_no} needs one or more named strata")
    confidence = item["annotation_confidence"]
    if not isinstance(confidence, (int, float)) or not np.isfinite(confidence) or not 0 <= confidence <= 1:
        raise ValueError(f"manifest line {line_no} has invalid annotation confidence")
    if not isinstance(item["independent_annotators"], int) or item["independent_annotators"] < 2:
        raise ValueError(f"manifest line {line_no} requires at least two independent annotators")
    for key in ("annotation_protocol_sha256", "inter_annotator_review_sha256"):
        if not SHA256.match(str(item[key])):
            raise ValueError(f"manifest line {line_no} has invalid {key}")
    if item["frame_alignment_verified"] is not True:
        raise ValueError(f"manifest line {line_no} frame alignment is not verified")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("manifest", type=Path)
    ap.add_argument("--output", type=Path)
    ap.add_argument("--boundary-tolerance", type=int, default=2)
    ap.add_argument("--require-commercial-clearance", action="store_true")
    args = ap.parse_args()

    root = args.manifest.resolve().parent
    entries = []
    seen_ids = set()
    participant_splits, source_splits = defaultdict(set), defaultdict(set)
    for line_no, line in enumerate(args.manifest.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        item = json.loads(line)
        for key in ("id", "prediction", "target", "usage_rights", "provenance"):
            if key not in item:
                raise ValueError(f"manifest line {line_no} missing {key}")
        if not isinstance(item["id"], str) or not item["id"] or item["id"] in seen_ids:
            raise ValueError(f"manifest line {line_no} has an empty or duplicate frame id")
        seen_ids.add(item["id"])
        if item["usage_rights"] not in ("commercial-cleared", "research-only", "permission-pending"):
            raise ValueError(f"manifest line {line_no} has an unknown usage_rights value")
        if not isinstance(item["provenance"], str) or not item["provenance"].strip():
            raise ValueError(f"manifest line {line_no} has empty provenance")
        if args.require_commercial_clearance:
            if item["usage_rights"] != "commercial-cleared" or not item.get("consent_or_lawful_basis"):
                raise ValueError(f"manifest line {line_no} lacks clearance declaration or lawful-basis record")
            validate_commercial_entry(item, line_no)
            participant_splits[str(item["participant_id"])].add(item["split"])
            source_splits[str(item["source_video_id"])].add(item["split"])

        prediction_path = (root / item["prediction"]).resolve()
        target_path = (root / item["target"]).resolve()
        if root not in prediction_path.parents or root not in target_path.parents:
            raise ValueError(f"manifest line {line_no} contains an asset path outside the manifest directory")
        prediction = cv2.imread(str(prediction_path), cv2.IMREAD_GRAYSCALE)
        target = cv2.imread(str(target_path), cv2.IMREAD_GRAYSCALE)
        if prediction is None or target is None:
            raise FileNotFoundError(f"cannot read pair on manifest line {line_no}")
        entries.append({
            "id": item["id"], "clip_id": str(item.get("clip_id", item["id"])),
            "participant_id": item.get("participant_id"), "source_video_id": item.get("source_video_id"),
            "sequence": item.get("sequence"), "frame": item.get("frame"),
            "split": item.get("split"), "strata": item.get("strata", ["unstratified"]),
            "usage_rights": item["usage_rights"], "annotation_confidence": item.get("annotation_confidence"),
            "independent_annotators": item.get("independent_annotators"),
            "metrics": alpha_metrics(prediction, target, args.boundary_tolerance),
            "runtime": item.get("runtime", {}),
            "prediction_array": prediction, "target_array": target,
        })

    if not entries:
        raise ValueError("manifest contains no frame pairs")
    if args.require_commercial_clearance:
        covered = {stratum for entry in entries for stratum in entry["strata"]}
        missing = sorted(set(REQUIRED_STRATA) - covered)
        if missing:
            raise ValueError("commercial held-out manifest is missing required strata: " + ", ".join(missing))
    for participant, splits in participant_splits.items():
        if len(splits) > 1:
            raise ValueError("participant leakage across splits: " + participant)
    for source, splits in source_splits.items():
        if len(splits) > 1:
            raise ValueError("source-video leakage across splits: " + source)

    metric_names = list(entries[0]["metrics"])
    aggregate = {
        key: float(np.mean([entry["metrics"][key] for entry in entries if entry["metrics"][key] is not None]))
        for key in metric_names if any(entry["metrics"][key] is not None for entry in entries)
    }
    by_stratum, by_clip, runtime = defaultdict(list), defaultdict(list), defaultdict(list)
    for entry in entries:
        for stratum in entry["strata"]:
            by_stratum[stratum].append(entry)
        by_clip[entry["clip_id"]].append(entry)
        for key in RUNTIME_FIELDS:
            value = entry["runtime"].get(key) if isinstance(entry["runtime"], dict) else None
            if isinstance(value, (int, float)) and np.isfinite(value) and value >= 0:
                if key == "battery_pct" and value > 100:
                    raise ValueError("runtime battery_pct must be between 0 and 100")
                runtime[key].append(float(value))

    strata_report = {}
    for stratum, rows in sorted(by_stratum.items()):
        clip_groups = defaultdict(list)
        for row in rows:
            clip_groups[row["clip_id"]].append(row)
        clip_stats = []
        for clip_rows in clip_groups.values():
            clip_stats.append({
                key: float(np.mean([row["metrics"][key] for row in clip_rows if row["metrics"][key] is not None]))
                for key in metric_names if any(row["metrics"][key] is not None for row in clip_rows)
            })
        stats = {
            key: float(np.mean([item[key] for item in clip_stats if key in item]))
            for key in metric_names if any(key in item for item in clip_stats)
        }
        strata_report[stratum] = {
            "frame_count": len(rows), "clip_count": len(clip_groups),
            "participant_count": len({row["participant_id"] for row in rows if row["participant_id"]}),
            "source_video_count": len({row["source_video_id"] for row in rows if row["source_video_id"]}),
            "independent_annotators_min": min((row.get("independent_annotators", 0) for row in rows), default=0),
            "aggregation": "equal-weight mean of per-clip metrics", "metrics": stats,
        }

    clip_report, clip_mae = {}, []
    for clip_id, rows in sorted(by_clip.items()):
        stats = {
            key: float(np.mean([row["metrics"][key] for row in rows if row["metrics"][key] is not None]))
            for key in metric_names if any(row["metrics"][key] is not None for row in rows)
        }
        clip_report[clip_id] = {"frame_count": len(rows), "metrics": stats}
        clip_mae.append(stats["mae"])

    temporal = sequence_metrics(entries)
    for entry in entries:
        entry.pop("prediction_array")
        entry.pop("target_array")
    report = {
        "protocol": "Genesis independent-alpha-ground-truth evaluation v2",
        "manifest_sha256": hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
        "required_strata": list(REQUIRED_STRATA),
        "frame_count": len(entries), "clip_count": len(by_clip),
        "participant_count": len({e["participant_id"] for e in entries if e["participant_id"]}),
        "source_video_count": len({e["source_video_id"] for e in entries if e["source_video_id"]}),
        "aggregate_mean": aggregate, "per_stratum": strata_report, "per_clip": clip_report,
        "clip_mae_bootstrap_ci95": bootstrap_ci(clip_mae), "sequences": temporal,
        "runtime_percentiles": {key: percentiles(values) for key, values in runtime.items()},
        "runtime_fields_not_supplied": [key for key in RUNTIME_FIELDS if key not in runtime],
        "frames": entries,
        "warning": "Only meaningful for independent, aligned alpha ground truth with verified data rights. Motion compensation, ghost duration and reacquisition are not inferred when source/track annotations are absent.",
    }
    encoded = json.dumps(report, indent=2, allow_nan=False)
    if args.output:
        args.output.write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
