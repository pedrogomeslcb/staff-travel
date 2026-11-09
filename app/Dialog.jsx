'use client';

import {useRef,useId,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';

export default function Dialog({title,onClose,children,wide=false}) {
  const ref=useRef(null),heading=useId(),closeAction=useRef(onClose);
  const [mounted,setMounted]=useState(false);
  closeAction.current=onClose;
  useEffect(()=>{setMounted(true);},[]);
  useEffect(()=>{
    if(!mounted)return;
    const previous=document.activeElement,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    ref.current?.focus();
    function keydown(e) {
      if (e.key==='Escape') {e.preventDefault();closeAction.current();}
      if (e.key==='Tab') {
        const items=[...ref.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')].filter(el=>el.getClientRects().length);
        const first=items[0],last=items[items.length-1];
        if (e.shiftKey && (document.activeElement===first||document.activeElement===ref.current)) {e.preventDefault();last?.focus();}
        else if (!e.shiftKey && (document.activeElement===last||document.activeElement===ref.current)) {e.preventDefault();first?.focus();}
      }
    }
    document.addEventListener('keydown',keydown);
    return ()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);previous?.focus();};
  },[mounted]);
  if(!mounted)return null;
  return createPortal(<div className="fixed inset-0 bg-slate-900/40 flex justify-center items-center p-4 z-[100]"><div ref={ref} role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1} className={'bg-white rounded-2xl w-full max-h-[90vh] overflow-y-auto outline-none '+(wide?'max-w-2xl':'max-w-sm')}><div className="p-5 border-b flex justify-between gap-4"><h2 id={heading} className="text-xl font-semibold">{title}</h2><button type="button" aria-label="Close dialog" onClick={onClose} className="px-2">✕</button></div>{children}</div></div>,document.body);
}

