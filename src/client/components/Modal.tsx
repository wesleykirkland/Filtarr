import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function Modal({ title, isOpen, onClose, children }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm sm:p-6 dark:text-gray-100 text-gray-900">
      <div className="relative mx-auto my-8 w-full max-w-2xl overflow-hidden rounded-3xl bg-white dark:bg-gray-900 shadow-2xl transition-all">
        <div className="flex items-center justify-between border-b dark:border-gray-800 border-gray-100 dark:bg-gray-900/50 bg-white px-6 py-5">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 dark:text-gray-400 text-gray-500 dark:hover:bg-gray-800 hover:bg-gray-100 dark:hover:text-white hover:text-gray-900 focus:outline-none"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
