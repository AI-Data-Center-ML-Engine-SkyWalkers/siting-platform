import { useCallback, useEffect, useId, useRef, useState } from 'react';

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A slider whose fill and thumb follow the value on a spring, with a glowing gradient track,
 * a value bubble while dragging, and full keyboard support (arrows, Page Up/Down, Home/End).
 */
export default function PremiumSlider({ id, label, value, onChange, min = 0, max = 100, step = 5, hint, format = (v) => v }) {
  const autoId = useId();
  const sliderId = id || autoId;
  const trackRef = useRef(null);
  const shownRef = useRef(value);
  const [shown, setShown] = useState(value);
  const [dragging, setDragging] = useState(false);

  // Spring toward the target value: slight overshoot, settles quickly
  useEffect(() => {
    if (reduceMotion()) { shownRef.current = value; setShown(value); return undefined; }
    let raf;
    let v = shownRef.current;
    let vel = 0;
    const tick = () => {
      vel = vel * 0.7 + (value - v) * 0.2;
      v += vel;
      if (Math.abs(value - v) < (max - min) * 0.0005 && Math.abs(vel) < (max - min) * 0.0005) v = value;
      shownRef.current = v;
      setShown(v);
      if (v !== value) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, min, max]);

  const snap = useCallback((raw) => {
    const clamped = Math.min(max, Math.max(min, raw));
    const snapped = Math.round((clamped - min) / step) * step + min;
    return Number(snapped.toFixed(4));
  }, [min, max, step]);

  const fromPointer = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return snap(min + ratio * (max - min));
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    trackRef.current.setPointerCapture?.(e.pointerId);
    trackRef.current.focus();
    setDragging(true);
    const next = fromPointer(e.clientX);
    if (next !== value) onChange(next);
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    const next = fromPointer(e.clientX);
    if (next !== value) onChange(next);
  };
  const endDrag = (e) => {
    if (!dragging) return;
    trackRef.current.releasePointerCapture?.(e.pointerId);
    setDragging(false);
  };

  const onKeyDown = (e) => {
    const big = step * 2;
    const moves = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big };
    let next = null;
    if (e.key in moves) next = snap(value + moves[e.key]);
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next !== null) {
      e.preventDefault();
      if (next !== value) onChange(next);
    }
  };

  const pct = Math.min(100, Math.max(0, ((shown - min) / (max - min)) * 100));
  const labelId = `${sliderId}-label`;

  return (
    <div className="pslider">
      <div className="pslider-head">
        <label id={labelId} onClick={() => trackRef.current?.focus()}>{label}</label>
        <output aria-hidden="true">{format(value)}</output>
      </div>
      <div
        id={sliderId}
        ref={trackRef}
        className={`ptrack${dragging ? ' dragging' : ''}`}
        role="slider"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={String(format(value))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <span className="ptrack-rail" />
        <span className="ptrack-fill" style={{ width: `${pct}%` }} />
        <span className="ptrack-thumb" style={{ left: `${pct}%` }} />
        <span className="ptrack-bubble" style={{ left: `${pct}%` }}>{format(value)}</span>
      </div>
      {hint && <p className="pslider-hint">{hint}</p>}
    </div>
  );
}
