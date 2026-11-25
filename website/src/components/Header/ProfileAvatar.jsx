import React, { useState } from 'react';

export default function ProfileAvatar({ profile = {}, className, tone, fallback }) {
  const [failedUrl, setFailedUrl] = useState('');
  const words = String(profile.full_name || '').trim().split(/\s+/).filter(Boolean);
  const initials = words.length
    ? [words[0], ...(words.length > 1 ? [words[words.length - 1]] : [])].map(word => Array.from(word)[0]).join('').toUpperCase()
    : String(profile.email || '?').slice(0, 2).toUpperCase();
  const src = profile.avatar_url;
  return (
    <span className={className} data-member-tone={tone} aria-hidden="true" style={{ borderRadius: '50%' }}>
      {src && src !== failedUrl ? (
        <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(src)}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
      ) : (fallback || initials)}
    </span>
  );
}
