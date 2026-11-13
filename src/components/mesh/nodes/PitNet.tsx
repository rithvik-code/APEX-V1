import { useCallback, useEffect, useRef, useState } from "react";
import { dynoPoint, dynoSweep } from "../../../lib/scene";

/* A tiny 1-16-16-2 MLP with real backprop. It never sees the torque formula —
 * only samples — and learns the engine's power band by gradient descent. */

const H = 16;
const SAMPLES = 48;
const EPOCHS = 260;
const LR = 0.04;
const MOMENTUM = 0.9;
const POWER_NORM = 1100;
const TORQUE_NORM = 700;

function rand(n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (Math.random() * 2 - 1) * 0.9;
  return out;
}

type Net = {
  w1: Float64Array;
  b1: Float64Array;
  w2: Float64Array;
  b2: Float64Array;
  w3: Float64Array;
  b3: Float64Array;
  v1: Float64Array;
  v2: Float64Array;
  v3: Float64Array;
};

function newNet(): Net {
  return {
    w1: rand(H),
    b1: new Float64Array(H),
    w2: rand(H * H),
    b2: new Float64Array(H),
    w3: rand(2 * H),
    b3: new Float64Array(2),
    v1: new Float64Array(H),
    v2: new Float64Array(H * H),
    v3: new Float64Array(2 * H),
  };
}

function forward(net: Net, x: number, out1: Float64Array, out2: Float64Array, out: Float64Array): void {
  for (let j = 0; j < H; j++) {
    const z = net.w1[j] * x + net.b1[j];
    out1[j] = Math.tanh(z);
  }
  for (let k = 0; k < H; k++) {
    let sum = net.b2[k];
    for (let j = 0; j < H; j++) sum += net.w2[k * H + j] * out1[j];
    out2[k] = Math.tanh(sum);
  }
  for (let o = 0; o < 2; o++) {
    let sum = net.b3[o];
    for (let k = 0; k < H; k++) sum += net.w3[o * H + k] * out2[k];
    out[o] = sum;
  }
}

function trainEpoch(net: Net, xs: number[], ys: Float64Array[]): number {
  const out1 = new Float64Array(H);
  const out2 = new Float64Array(H);
  const out = new Float64Array(2);
  const g1 = new Float64Array(H);
  const g2 = new Float64Array(H * H);
  const gb1 = new Float64Array(H);
  const gb2 = new Float64Array(H);
  const g3 = new Float64Array(2 * H);
  const gb3 = new Float64Array(2);
  let loss = 0;

  for (let s = 0; s < xs.length; s++) {
    forward(net, xs[s], out1, out2, out);
    const d3 = [out[0] - ys[s][0], out[1] - ys[s][1]];
    loss += d3[0] * d3[0] + d3[1] * d3[1];
    const d2 = new Float64Array(H);
    const d1 = new Float64Array(H);
    for (let o = 0; o < 2; o++) {
      gb3[o] += d3[o];
      for (let k = 0; k < H; k++) g3[o * H + k] += d3[o] * out2[k];
    }
    for (let k = 0; k < H; k++) {
      let acc = 0;
      for (let o = 0; o < 2; o++) acc += net.w3[o * H + k] * d3[o];
      d2[k] = (1 - out2[k] * out2[k]) * acc;
      gb2[k] += d2[k];
      for (let j = 0; j < H; j++) g2[k * H + j] += d2[k] * out1[j];
    }
    for (let j = 0; j < H; j++) {
      let acc = 0;
      for (let k = 0; k < H; k++) acc += net.w2[k * H + j] * d2[k];
      d1[j] = (1 - out1[j] * out1[j]) * acc;
      gb1[j] += d1[j] * 1;
      net.v1[j] = MOMENTUM * net.v1[j] - LR * (d1[j] * xs[s] / xs.length);
    }
  }

  const n = xs.length;
  for (let o = 0; o < 2; o++) {
    net.b3[o] -= LR * (gb3[o] / n);
    for (let k = 0; k < H; k++) {
      const grad = g3[o * H + k] / n;
      const idx = o * H + k;
      net.v3[idx] = MOMENTUM * net.v3[idx] - LR * grad;
      net.w3[idx] += net.v3[idx];
    }
  }
  for (let k = 0; k < H; k++) {
    net.b2[k] -= LR * (gb2[k] / n);
    for (let j = 0; j < H; j++) {
      const grad = g2[k * H + j] / n;
      const idx = k * H + j;
      net.v2[idx] = MOMENTUM * net.v2[idx] - LR * grad;
      net.w2[idx] += net.v2[idx];
    }
  }
  for (let j = 0; j < H; j++) {
    net.b1[j] -= LR * (gb1[j] / n);
    net.w1[j] += net.v1[j];
  }
  return loss / (n * 2);
}

export function PitNet(_props: Record<string, never>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const netRef = useRef<Net | null>(null);
  const rafRef = useRef(0);
  const [mod, setMod] = useState(1);
  const [status, setStatus] = useState<"cold" | "training" | "ready">("cold");
  const [epoch, setEpoch] = useState(0);
  const [loss, setLoss] = useState(0);
  const [peak, setPeak] = useState({ net: 0, true: 0 });
  const modRef = useRef(mod);
  modRef.current = mod;

  const trueCurve = useCallback((engineMod: number) => {
    return dynoSweep(SAMPLES - 1).map((point) => {
      const torque = point.torqueNm * engineMod;
      return { rpm: point.rpm, torque, power: (torque * point.rpm) / 7127 };
    });
  }, []);

  const draw = useCallback(
    (epochNow: number, lossNow: number, engineMod: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const w = canvas.width;
      const h = canvas.height;
      const padX = 34 * dpr;
      const padY = 20 * dpr;
      ctx.clearRect(0, 0, w, h);

      // axes
      ctx.strokeStyle = "rgba(233, 237, 232, 0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, padY);
      ctx.lineTo(padX, h - padY);
      ctx.lineTo(w - padX, h - padY);
      ctx.stroke();

      const truth = trueCurve(engineMod);
      const maxPower = 1100;
      const px = (rpm: number) => padX + (rpm / 12000) * (w - 2 * padX);
      const py = (power: number) => h - padY - (power / maxPower) * (h - 2 * padY);

      // truth curve (faint)
      ctx.strokeStyle = "rgba(233, 237, 232, 0.35)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      truth.forEach((point, i) => {
        const x = px(point.rpm);
        const y = py(point.power);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // net curve (acid, glowing)
      const net = netRef.current;
      if (net) {
        const out1 = new Float64Array(H);
        const out2 = new Float64Array(H);
        const out = new Float64Array(2);
        ctx.strokeStyle = "rgba(200, 255, 22, 0.95)";
        ctx.lineWidth = 2 * dpr;
        ctx.shadowColor = "rgba(200, 255, 22, 0.55)";
        ctx.shadowBlur = 9 * dpr;
        ctx.beginPath();
        const steps = 72;
        for (let i = 0; i <= steps; i++) {
          const rpmNorm = i / steps;
          forward(net, rpmNorm, out1, out2, out);
          const power = Math.max(0, out[1]) * POWER_NORM;
          const x = px(rpmNorm * 12000);
          const y = py(power);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // labels
      ctx.fillStyle = "rgba(233, 237, 232, 0.5)";
      ctx.font = `${9.5 * dpr}px IBM Plex Mono, monospace`;
      ctx.fillText("0", padX - 6, h - padY + 14);
      ctx.fillText("12000 RPM", w - padX - 62, h - padY + 14);
      ctx.fillText("HP", 6, padY + 4);
      ctx.fillStyle = "rgba(200, 255, 22, 0.9)";
      ctx.fillText(`EPOCH ${epochNow} · LOSS ${lossNow.toFixed(5)}`, w - padX - 168, padY + 2);
      ctx.fillStyle = "rgba(233, 237, 232, 0.4)";
      ctx.fillText("—— TRUTH   ——— PIT NET", w - padX - 168, padY + 16);
    },
    [trueCurve],
  );

  const train = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const engineMod = modRef.current;
    const net = newNet();
    netRef.current = net;
    const sweep = dynoSweep(SAMPLES - 1);
    const xs = sweep.map((point) => (point.rpm - 1000) / 11000);
    const ys = sweep.map((point) => {
      const torque = point.torqueNm * engineMod;
      return Float64Array.from([
        torque / TORQUE_NORM,
        ((torque * point.rpm) / 7127) / POWER_NORM,
      ]);
    });
    setStatus("training");
    setEpoch(0);
    let e = 0;
    const lossHistory: number[] = [];
    const step = () => {
      const frames = 5;
      let lastLoss = 0;
      for (let f = 0; f < frames && e < EPOCHS; f++, e++) {
        lastLoss = trainEpoch(net, xs, ys);
        lossHistory.push(lastLoss);
      }
      setEpoch(e);
      setLoss(lastLoss);

      // net peak power + true peak for readouts
      const out1 = new Float64Array(H);
      const out2 = new Float64Array(H);
      const out = new Float64Array(2);
      let netPeak = 0;
      for (let i = 0; i <= 60; i++) {
        forward(net, i / 60, out1, out2, out);
        netPeak = Math.max(netPeak, Math.max(0, out[1]) * POWER_NORM);
      }
      let truePeak = 0;
      for (const point of sweep) {
        const torque = point.torqueNm * engineMod;
        truePeak = Math.max(truePeak, (torque * point.rpm) / 7127);
      }
      setPeak({ net: Math.round(netPeak), true: Math.round(truePeak) });

      draw(e, lastLoss, engineMod);
      if (e < EPOCHS) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setStatus("ready");
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [draw]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <div className="mesh-preview">
      <div className="mesh-pitnet__head">
        <span>
          ARCH <b>1·16·16·2 TANH</b> · DATA <b>{SAMPLES} DYNO SAMPLES</b> · OPTIM <b>SGD+MOMENTUM</b>
        </span>
      </div>
      <canvas ref={canvasRef} className="mesh-pitnet" />
      <div className="mesh-pitnet__controls">
        <label>
          ENGINE MOD ×{mod.toFixed(2)}
          <input
            type="range"
            min={0.6}
            max={1.4}
            step={0.05}
            value={mod}
            onChange={(event) => {
              const value = Number(event.target.value);
              setMod(value);
              modRef.current = value;
              draw(epoch, loss, value);
            }}
          />
        </label>
        <button type="button" className="mesh-cta mesh-cta--slim" onClick={train} disabled={status === "training"}>
          {status === "training" ? `TRAINING · ${Math.round((epoch / EPOCHS) * 100)}%` : status === "cold" ? "TRAIN THE NET" : "RE-TRAIN ON NEW BAND"}
        </button>
      </div>
      <div className="mesh-pitnet__reads">
        <div>
          <span>NET PEAK POWER</span>
          <b>{peak.net} HP</b>
        </div>
        <div>
          <span>TRUE PEAK</span>
          <b>{peak.true} HP</b>
        </div>
        <div>
          <span>FINAL LOSS</span>
          <b>{status === "cold" ? "—" : loss.toFixed(5)}</b>
        </div>
      </div>
      <p className="mesh-fine">
        THE NET OBSERVES ONLY (RPM → TORQUE, POWER) SAMPLES FROM THE DYNO — THE
        FORMULA IS NEVER SHOWN. DRAG THE MOD AND IT RE-LEARNS THE NEW BAND LIVE.
      </p>
    </div>
  );
}
