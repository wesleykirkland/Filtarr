import { useEffect, useState, useCallback, useRef } from 'react';
import { buttonStyles } from './ui';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

let addToastFn: ((msg: Omit<ToastMessage, 'id'>) => void) | null = null;

export function toast(type: ToastMessage['type'], message: string) {
  addToastFn?.({ type, message });
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timeoutMap = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const removeToast = useCallback((id: string) => {
    const timeoutId = timeoutMap.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutMap.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((msg: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...msg, id }]);
    const timeoutId = setTimeout(() => removeToast(id), 4000);
    timeoutMap.current.set(id, timeoutId);
  }, [removeToast]);

  useEffect(() => {
    addToastFn = addToast;
    return () => {
      addToastFn = null;
      timeoutMap.current.forEach((timeoutId) => clearTimeout(timeoutId));
      timeoutMap.current.clear();
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-relevant="additions text"
      className="fixed bottom-4 right-4 z-50 space-y-2"
    >
      {toasts.map((t) => {
        let toneClass = 'bg-blue-600 text-white';
        if (t.type === 'success') {
          toneClass = 'bg-green-600 text-white';
        } else if (t.type === 'error') {
          toneClass = 'bg-red-600 text-white';
        }
        const commonProps = {
          className: `flex min-w-72 items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${toneClass}`,
        } as const;

        const content = (
          <>
            <span>{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => removeToast(t.id)}
              className={buttonStyles({
                variant: 'ghost',
                size: 'sm',
                className:
                  '!rounded-md !px-2 !py-1 !text-white/80 hover:!bg-white/10 hover:!text-white focus-visible:ring-white/70',
              })}
            >
              ×
            </button>
          </>
        );

        return t.type === 'error' ? (
          <div key={t.id} role="alert" {...commonProps}>
            {content}
          </div>
        ) : (
          <output key={t.id} {...commonProps}>
            {content}
          </output>
        );
      })}
    </div>
  );
}
