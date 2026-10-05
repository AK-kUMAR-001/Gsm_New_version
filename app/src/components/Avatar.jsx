import React from 'react';
import { initials, getInitialsColor } from '../lib/business.js';

export default function Avatar({ name, src = null, sizeClass = 'w-10 h-10 text-base', ring = false }) {
  const cls = `${sizeClass} ${getInitialsColor(name)} flex items-center justify-center rounded-full font-bold text-white shrink-0 ${ring ? 'ring-2 ring-white shadow-md' : ''}`;
  if (src) return <img alt={name || ''} src={src} className={`${cls} object-cover`} />;
  return <div className={cls}>{initials(name)}</div>;
}
