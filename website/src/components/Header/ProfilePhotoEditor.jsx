import React, { useEffect, useRef, useState } from 'react';
import { getProfilePhotoCrop, validateProfilePhoto } from './ProfilePhoto.js';
import styles from './ProfileModal.module.css';

const clamp = value => Math.min(1, Math.max(0, value));

export default function ProfilePhotoEditor({ file, busy, onSave, onCancel }) {
  const [image, setImage] = useState(null);
  const [error, setError] = useState('');
  const [crop, setCrop] = useState({ zoom: 1, offsetX: 0.5, offsetY: 0.5 });
  const drag = useRef(null);

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

  const startDrag = event => {
    if (busy || !image || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      crop, size: event.currentTarget.getBoundingClientRect().width };
  };
  const moveDrag = event => {
    const start = drag.current;
    if (!start || busy || !image || start.pointerId !== event.pointerId || !start.size) return;
    const source = getProfilePhotoCrop(image.width, image.height, start.crop);
    setCrop({ ...start.crop,
      offsetX: image.width > source.size ? clamp(start.crop.offsetX - (event.clientX - start.x) * source.size / start.size / (image.width - source.size)) : 0.5,
      offsetY: image.height > source.size ? clamp(start.crop.offsetY - (event.clientY - start.y) * source.size / start.size / (image.height - source.size)) : 0.5,
    });
  };
  const endDrag = event => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (event.type === 'pointercancel') setCrop(drag.current.crop);
    drag.current = null;
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
      <div className={styles.cropPreview} role="img" aria-label="Photo crop preview" tabIndex={busy ? -1 : 0}
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
          onChange={event => { drag.current = null; setCrop(value => ({ ...value, zoom: Number(event.target.value) })); }} />
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
