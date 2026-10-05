import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) { setMounted(true); document.body.style.overflow = 'hidden'; }
    else { document.body.style.overflow = ''; }
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setMounted(false), 180);
      return () => clearTimeout(t);
    }
  }, [open]);
  if (!mounted) return null;

  return createPortal(
    <div className={`fixed inset-0 z-[90] ${open ? 'animate-fadeIn' : 'opacity-0 pointer-events-none'}`}>
      <div
        className="absolute inset-0 bg-ink-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          className={`${maxWidth} w-full bg-white rounded-3xl shadow-2xl ring-1 ring-black/5 ${open ? 'animate-slideUp' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100">
            <h3 className="text-xl font-bold text-ink-900">{title}</h3>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-ink-100 text-ink-500"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}
