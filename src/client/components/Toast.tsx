import { useEffect, useState, useCallback } from 'react';

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

  const addToast = useCallback((msg: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...msg, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            t.type === 'success' ? 'bg-green-600 text-white' :
            t.type === 'error' ? 'bg-red-600 text-white' :
            'bg-blue-600 text-white'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

