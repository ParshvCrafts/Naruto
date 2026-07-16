"""train_and_export.py — train the gesture model, export TF.js weights.bin.

The network architecture is byte-for-byte the same as trainer.js buildModel()
and the existing models/gesture-model.json:
  Dense(128,relu) -> BatchNorm -> Dropout(0.3)
  -> Dense(64,relu) -> BatchNorm -> Dropout(0.2)
  -> Dense(32,relu) -> Dense(14,softmax)

Because the architecture is unchanged, models/gesture-model.json (the TF.js
topology + weight manifest) stays exactly as-is. We only regenerate the binary
weights, written in the manifest's declared tensor order:
  d1.kernel, d1.bias, bn1.gamma, bn1.beta, d2.kernel, d2.bias,
  bn2.gamma, bn2.beta, d3.kernel, d3.bias, d4.kernel, d4.bias,
  bn1.moving_mean, bn1.moving_variance, bn2.moving_mean, bn2.moving_variance
(all trainable tensors first, non-trainable BN running stats last — the tfjs
convention). Each tensor is raw little-endian float32, concatenated, no header.
This is the exact format tf.loadLayersModel() reads, so no tensorflowjs package
is needed.

Same 3x jitter augmentation (+-2%), adam / categorical_crossentropy.

Usage:
  python train_and_export.py <out_weights.bin> <samples1.json> [samples2.json ...]
"""
import sys, json
import numpy as np
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

NCLASS = 14
NAMES = {0:'rat',1:'ox',2:'tiger',3:'hare',4:'dragon',5:'snake',6:'horse',
         7:'ram',8:'monkey',9:'bird',10:'dog',11:'boar',12:'kage',13:'none'}

def load_many(paths):
    X, y = [], []
    for p in paths:
        with open(p) as fh: d = json.load(fh)
        for k, rows in d.items():
            for v in rows:
                if len(v) == 126:
                    X.append(v); y.append(int(k))
    return np.array(X, np.float32), np.array(y, np.int64)

def augment(X, y, copies=3, jit=0.02):
    Xs, ys = [X], [y]
    for _ in range(copies):
        Xs.append(X + np.random.uniform(-jit, jit, X.shape).astype(np.float32))
        ys.append(y)
    return np.vstack(Xs), np.concatenate(ys)

def build():
    d1  = tf.keras.layers.Dense(128, activation='relu', name='d1')
    bn1 = tf.keras.layers.BatchNormalization(name='bn1')
    d2  = tf.keras.layers.Dense(64, activation='relu', name='d2')
    bn2 = tf.keras.layers.BatchNormalization(name='bn2')
    d3  = tf.keras.layers.Dense(32, activation='relu', name='d3')
    d4  = tf.keras.layers.Dense(NCLASS, activation='softmax', name='d4')
    m = tf.keras.Sequential([
        tf.keras.layers.Input((126,)),
        d1, bn1, tf.keras.layers.Dropout(0.3),
        d2, bn2, tf.keras.layers.Dropout(0.2),
        d3, d4,
    ])
    m.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
    return m, (d1, bn1, d2, bn2, d3, d4)

def export_bin(layers, out_path):
    d1, bn1, d2, bn2, d3, d4 = layers
    d1k, d1b = d1.get_weights()
    bn1g, bn1b, bn1mm, bn1mv = bn1.get_weights()
    d2k, d2b = d2.get_weights()
    bn2g, bn2b, bn2mm, bn2mv = bn2.get_weights()
    d3k, d3b = d3.get_weights()
    d4k, d4b = d4.get_weights()
    ordered = [d1k, d1b, bn1g, bn1b, d2k, d2b, bn2g, bn2b,
               d3k, d3b, d4k, d4b, bn1mm, bn1mv, bn2mm, bn2mv]
    blob = b''.join(np.asarray(w, '<f4').tobytes() for w in ordered)
    with open(out_path, 'wb') as fh:
        fh.write(blob)
    print(f"wrote {len(blob)} bytes -> {out_path}")
    return len(blob)

def main():
    out_bin, paths = sys.argv[1], sys.argv[2:]
    X, y = load_many(paths)
    print(f"loaded {len(X)} samples from {len(paths)} file(s)")
    binc = np.bincount(y, minlength=NCLASS)
    print("per-class:", {NAMES[i]: int(binc[i]) for i in range(NCLASS)})

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)
    Xtr, ytr = augment(Xtr, ytr)
    Ytr = tf.keras.utils.to_categorical(ytr, NCLASS)

    model, layers = build()
    model.fit(Xtr, Ytr, epochs=100, batch_size=16, validation_split=0.1, verbose=2,
              callbacks=[tf.keras.callbacks.EarlyStopping(
                  monitor='val_accuracy', patience=15, restore_best_weights=True)])

    pred = model.predict(Xte, verbose=0).argmax(1)
    acc = (pred == yte).mean()
    print(f"\nHELD-OUT accuracy: {acc:.4f}")
    labs = sorted(set(yte.tolist()))
    print(classification_report(yte, pred, labels=labs,
          target_names=[NAMES[i] for i in labs], digits=3, zero_division=0))

    export_bin(layers, out_bin)

if __name__ == '__main__':
    main()
