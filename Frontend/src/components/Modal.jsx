import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, subtitle, icon, onClose, wide, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' lg' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <button className="icon-btn close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <div className="modal-head">
          <div className="badge-ico">{icon}</div>
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        </div>
        {children}
      </div>
    </div>
  );
}
