import React, { useEffect, useRef, useState } from 'react';
import { getProfilePhotoCrop, validateProfilePhoto } from './ProfilePhoto.js';
import styles from './ProfileModal.module.css';

const clamp = value => Math.min(1, Math.max(0, value));

export default function ProfilePhotoEditor({ file, busy, onSave, onCancel }) {
  const [image, setImage] = useState(null);
  const [error, setError] = useState('');
  const [crop, setCrop] = useState({ zoom: 1, offsetX: 0.5, offsetY: 0.5 });
  const drag = useRef(null);
  const pointers = useRef(new Map());

  useEffect(() => {
    let active = true;
    let url;
    const load = async () => {
      try {
        validateProfilePhoto(file);
        url = URL.createObjectURL(file);
        const picture = new Image();
        picture.src = url;
        await picture.decode();
        if (!picture.naturalWidth || !picture.naturalHeight) throw new Error('Empty image');
        if (active) setImage({ url, width: picture.naturalWidth, height: picture.naturalHeight });
      } catch { if (active) setError('This photo could not be opened. Choose another image.'); }
    };
    void load();
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [file]);

  const beginGesture = (element, selection) => {
    const active = [...pointers.current.values()];
    const rect = element.getBoundingClientRect();
    if (active.length === 2) {
      drag.current = { kind: 'pinch', crop: selection, size: rect.width, left: rect.left || 0, top: rect.top || 0,
        x: (active[0].x + active[1].x) / 2, y: (active[0].y + active[1].y) / 2,
        distance: Math.max(1, Math.hypot(active[1].x - active[0].x, active[1].y - active[0].y)) };
    } else {
      drag.current = active.length ? { kind: 'pan', crop: selection, size: rect.width, ...active[0] } : null;
    }
  };
  const startDrag = event => {
    if (busy || !image || event.button !== 0) return;
    if (!pointers.current.has(event.pointerId) && pointers.current.size >= 2) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture(event.currentTarget, crop);
  };
  const moveDrag = event => {
    const start = drag.current;
    if (!start || busy || !image || !pointers.current.has(event.pointerId) || !start.size) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const source = getProfilePhotoCrop(image.width, image.height, start.crop);
    if (start.kind === 'pinch') {
      const [first, second] = [...pointers.current.values()];
      if (!first || !second) return;
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const zoom = Math.min(3, Math.max(1, start.crop.zoom * distance / start.distance));
      const size = getProfilePhotoCrop(image.width, image.height, { zoom }).size;
      const anchorX = source.x + (start.x - start.left) / start.size * source.size;
      const anchorY = source.y + (start.y - start.top) / start.size * source.size;
      setCrop({ zoom,
        offsetX: image.width > size ? clamp((anchorX - ((first.x + second.x) / 2 - start.left) / start.size * size) / (image.width - size)) : 0.5,
        offsetY: image.height > size ? clamp((anchorY - ((first.y + second.y) / 2 - start.top) / start.size * size) / (image.height - size)) : 0.5,
      });
      return;
    }
    setCrop({ ...start.crop,
      offsetX: image.width > source.size ? clamp(start.crop.offsetX - (event.clientX - start.x) * source.size / start.size / (image.width - source.size)) : 0.5,
      offsetY: image.height > source.size ? clamp(start.crop.offsetY - (event.clientY - start.y) * source.size / start.size / (image.height - source.size)) : 0.5,
    });
  };
  const endDrag = event => {
    if (!pointers.current.has(event.pointerId)) return;
    if (event.type === 'pointercancel') {
      if (drag.current) setCrop(drag.current.crop);
      pointers.current.clear(); drag.current = null;
      return;
    }
    pointers.current.delete(event.pointerId);
    beginGesture(event.currentTarget, crop);
  };
  const moveWithKeys = event => {
    if (busy || !image || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 0.1 : 0.03;
    setCrop(value => ({ ...value,
      offsetX: clamp(value.offsetX + (event.key === 'ArrowLeft' ? amount : event.key === 'ArrowRight' ? -amount : 0)),
      offsetY: clamp(value.offsetY + (event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0)),
    }));
  };
  const source = image ? getProfilePhotoCrop(image.width, image.height, crop) : null;

  return <section className={styles.photoEditor} aria-label="Adjust profile photo" aria-busy={busy}>
    {error ? <p className={styles.errorMessage} role="alert">{error}</p> : image ? <>
      <div className={styles.cropPreview} role="img" aria-label="Circular photo crop preview" tabIndex={busy ? -1 : 0}
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
        onLostPointerCapture={endDrag} onKeyDown={moveWithKeys}>
        <img src={image.url} alt="" draggable={false} style={{
          width: `${image.width / source.size * 100}%`, height: `${image.height / source.size * 100}%`,
          left: `${-source.x / source.size * 100}%`, top: `${-source.y / source.size * 100}%`,
        }} />
      </div>
      <p className={styles.photoHint}>Drag to reposition.</p>
      <label className={styles.zoomControl}>Zoom
        <input aria-label="Photo zoom" type="range" min="1" max="3" step="0.05" value={crop.zoom} disabled={busy}
          onChange={event => { pointers.current.clear(); drag.current = null; setCrop(value => ({ ...value, zoom: Number(event.target.value) })); }} />
      </label>
    </> : <p className={styles.photoHint} role="status">Loading photo…</p>}
    <div className={styles.cropActions}>
      <button className={styles.photoRemove} type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      <button className={styles.photoButton} type="button" onClick={() => onSave(crop)} disabled={busy || !image || Boolean(error)}>
        {busy ? 'Saving…' : 'Save photo'}
      </button>
    </div>
  </section>;
}
