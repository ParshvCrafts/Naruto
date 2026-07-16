"""extract_from_images.py — Naruto hand-seal landmark extractor.

Converts labeled sign IMAGES into the SAME 126-float landmark vectors the live
app/trainer produce, so image data can augment the live-collected training set.

Feature layout (matches trainer.js extract()):
    [0:63]   = right-hand 21 landmarks (x,y,z), wrist-centered, scaled by |lm9-wrist|
    [63:126] = left-hand  21 landmarks, same normalization
    missing hand -> zeros

Detector: MediaPipe HOLISTIC in static_image_mode — the exact model the app runs
at inference. Using Holistic (not standalone Hands) keeps train/serve parity:
the right/left hand-slot assignment and per-hand landmark geometry match what the
live pipeline produces. (Standalone Hands was evaluated and rejected: for the
pressed-together seals it collapses both hands into one blob, producing one-hand
vectors that skew classes the live pipeline sees as two-handed. Live-collected
data already covers the classes Holistic under-detects here, so yield loss on
those classes does not unbalance the merged training set.)

Output: JSON  {classId: [[126 floats], ...], ...}  — importable by trainer.js.

Usage:
    python extract_from_images.py <dataset_root> <out.json> [--limit N]
"""
import os, sys, glob, json, argparse
import numpy as np
import cv2
import mediapipe as mp

# folder-name -> classId (datasets use one subdir per class)
FOLDER_MAP = {
    'rat':0,'ne':0,'ox':1,'ushi':1,'tiger':2,'tora':2,'hare':3,'u':3,'rabbit':3,
    'dragon':4,'tatsu':4,'snake':5,'serpent':5,'mi':5,'horse':6,'uma':6,
    'ram':7,'sheep':7,'hitsuji':7,'monkey':8,'saru':8,'bird':9,'tori':9,
    'dog':10,'inu':10,'boar':11,'i':11,'kage':12,'shadow':12,'shadowclone':12,
    'zero':13,'none':13,'neutral':13,'nothing':13,'rest':13,
}
NAMES = {0:'rat',1:'ox',2:'tiger',3:'hare',4:'dragon',5:'snake',6:'horse',
         7:'ram',8:'monkey',9:'bird',10:'dog',11:'boar',12:'kage',13:'none'}

# ── normalization (byte-identical to trainer.js normalize/extract) ──────────────
def normalize(lms):
    """lms: list of 21 (x,y,z) tuples or None -> np.float32[63]."""
    vec = np.zeros(63, dtype=np.float32)
    if lms is None or len(lms) < 21:
        return vec
    wx, wy, wz = lms[0]
    dx, dy, dz = lms[9][0]-wx, lms[9][1]-wy, lms[9][2]-wz
    scale = (dx*dx+dy*dy+dz*dz) ** 0.5 or 1.0
    for i, (x, y, z) in enumerate(lms):
        vec[i*3]   = (x-wx)/scale
        vec[i*3+1] = (y-wy)/scale
        vec[i*3+2] = (z-wz)/scale
    return vec

def to_xyz(landmark_list):
    return [(p.x, p.y, p.z) for p in landmark_list.landmark]

def extract_vec(right, left):
    v = np.zeros(126, dtype=np.float32)
    v[0:63]   = normalize(right)
    v[63:126] = normalize(left)
    return v

def class_from_folder(path):
    parts = os.path.normpath(path).split(os.sep)
    for token in reversed(parts[:-1]):          # skip filename, walk up dirs
        key = token.lower().replace('_', '').replace('-', '').replace(' ', '')
        if key in FOLDER_MAP:
            return FOLDER_MAP[key]
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('out')
    ap.add_argument('--limit', type=int, default=0, help='max images per class (0=all)')
    args = ap.parse_args()

    imgs = [f for f in glob.glob(os.path.join(args.root, '**', '*'), recursive=True)
            if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    print(f"found {len(imgs)} images under {args.root}", file=sys.stderr)

    samples = {str(i): [] for i in range(14)}
    stats = {}            # cid -> [tried, kept]
    per_class = {}

    with mp.solutions.holistic.Holistic(
            static_image_mode=True, model_complexity=1,
            min_detection_confidence=0.5) as hol:
        for f in imgs:
            cid = class_from_folder(f)
            if cid is None:
                continue
            if args.limit and per_class.get(cid, 0) >= args.limit:
                continue
            img = cv2.imread(f)
            if img is None:
                continue
            per_class[cid] = per_class.get(cid, 0) + 1
            st = stats.setdefault(cid, [0, 0]); st[0] += 1

            res = hol.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            right = to_xyz(res.right_hand_landmarks) if res.right_hand_landmarks else None
            left  = to_xyz(res.left_hand_landmarks)  if res.left_hand_landmarks  else None

            # Seal classes need >=1 hand; None(13) accepts zero-hand frames too
            # (matches trainer.js shouldCollect: hands intentionally off-screen).
            if cid != 13 and right is None and left is None:
                continue
            samples[str(cid)].append(extract_vec(right, left).tolist())
            st[1] += 1

    with open(args.out, 'w') as fh:
        json.dump(samples, fh)

    print(f"\n{'id':>2} {'class':7} {'tried':>6} {'kept':>6} {'yield':>6}", file=sys.stderr)
    tot = 0
    for cid in sorted(stats):
        t, k = stats[cid]; tot += k
        print(f"{cid:2} {NAMES.get(cid,'?'):7} {t:6} {k:6} {100*k/t:5.0f}%", file=sys.stderr)
    print(f"\nTOTAL kept: {tot} -> {args.out}", file=sys.stderr)

if __name__ == '__main__':
    main()
