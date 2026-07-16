"""eval_harness.py — decide whether image-extracted landmarks improve accuracy.

Gold standard: hold out a stratified slice of the LIVE-collected samples (the true
inference distribution). Train two classifiers on the SAME holdout:
  * baseline  = live-train only
  * augmented = live-train + image-extracted samples
Report accuracy + per-class recall + confusion on conflicting signs.
The augmented set only earns deployment if it beats baseline on the LIVE holdout.

Usage:
  python eval_harness.py <live_samples.json> [aug1.json aug2.json ...]
"""
import sys, json
import numpy as np
from sklearn.neural_network import MLPClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score

NAMES = {0:'rat',1:'ox',2:'tiger',3:'hare',4:'dragon',5:'snake',6:'horse',
         7:'ram',8:'monkey',9:'bird',10:'dog',11:'boar',12:'kage',13:'none'}
# historically confused / sequence-critical signs
FOCUS = [1,3,8, 5,7,4, 2,6,11]

def load(path):
    with open(path) as fh: d = json.load(fh)
    X, y = [], []
    for k, rows in d.items():
        for v in rows:
            if len(v) == 126:
                X.append(v); y.append(int(k))
    return np.array(X, np.float32), np.array(y)

def make_model():
    return MLPClassifier(hidden_layer_sizes=(128,64,32), activation='relu',
                         alpha=1e-3, batch_size=32, max_iter=300,
                         early_stopping=True, n_iter_no_change=15, random_state=42)

def report(tag, model, Xte, yte):
    p = model.predict(Xte)
    acc = accuracy_score(yte, p)
    f1 = f1_score(yte, p, average='macro')
    print(f"\n[{tag}] holdout acc={acc:.3f}  macro-F1={f1:.3f}")
    labels = sorted(set(yte))
    rec = {}
    cm = confusion_matrix(yte, p, labels=labels)
    for i, lab in enumerate(labels):
        tot = cm[i].sum()
        rec[lab] = cm[i, i] / tot if tot else 0.0
    print("  focus-sign recall:")
    for c in FOCUS:
        if c in rec:
            print(f"    {NAMES[c]:7} {rec[c]*100:5.1f}%")
    return acc, f1, rec, p

def main():
    live = sys.argv[1]
    augs = sys.argv[2:]
    Xl, yl = load(live)
    print(f"live samples: {len(Xl)} across {len(set(yl))} classes")

    # stratified holdout from LIVE (true inference distribution)
    Xtr, Xte, ytr, yte = train_test_split(Xl, yl, test_size=0.2,
                                          stratify=yl, random_state=42)
    print(f"live-train={len(Xtr)}  live-holdout={len(Xte)}")

    base = make_model().fit(Xtr, ytr)
    b_acc, b_f1, b_rec, _ = report("BASELINE live-only", base, Xte, yte)

    if augs:
        Xa_all, ya_all = [Xtr], [ytr]
        for a in augs:
            Xa, ya = load(a)
            print(f"  + aug {a}: {len(Xa)} samples")
            Xa_all.append(Xa); ya_all.append(ya)
        Xaug = np.vstack(Xa_all); yaug = np.concatenate(ya_all)
        aug = make_model().fit(Xaug, yaug)
        a_acc, a_f1, a_rec, _ = report("AUGMENTED live+images", aug, Xte, yte)

        print("\n=== DELTA (augmented - baseline) on LIVE holdout ===")
        print(f"  accuracy : {b_acc:.3f} -> {a_acc:.3f}  ({(a_acc-b_acc)*100:+.1f} pts)")
        print(f"  macro-F1 : {b_f1:.3f} -> {a_f1:.3f}  ({(a_f1-b_f1)*100:+.1f} pts)")
        print("  focus-sign recall delta:")
        for c in FOCUS:
            if c in b_rec and c in a_rec:
                print(f"    {NAMES[c]:7} {b_rec[c]*100:5.1f}% -> {a_rec[c]*100:5.1f}%  ({(a_rec[c]-b_rec[c])*100:+.1f})")

if __name__ == '__main__':
    main()
