import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './ui';

interface ModalProps {
  readonly title: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
}

export function Modal({ title, isOpen, onClose, children, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = dialogRef.current;
    if (!dialog) return;

    document.body.style.overflow = 'hidden';
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        // JSDOM and older browsers may not implement showModal/close.
        dialog.setAttribute('open', '');
      }
    }

    // Ensure focus starts inside the dialog for accessibility and tests (JSDOM doesn't
    // reliably move focus when calling showModal()).
    const focusTarget =
      dialog.querySelector<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ??
      dialog;
    focusTarget.focus();

    const handleCancel = (event: Event) => {
      // Prevent native close so the parent controls open state.
      event.preventDefault();
      onClose();
    };

    const handleBackdropClick = (event: MouseEvent) => {
      // Native <dialog> backdrop clicks bubble as clicks with target === dialog.
      if (event.target === dialog) onClose();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'auto';
      if (dialog?.open) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
      }
      lastFocusedRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClass = {
    sm: 'max-w-lg',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
  }[size];

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={cn(
        'w-[calc(100%-2rem)] overflow-hidden rounded-3xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 sm:w-full',
        'backdrop:bg-black/60 backdrop:backdrop-blur-sm',
        sizeClass,
      )}
    >
      <div className="flex items-center justify-between border-b border-gray-100 bg-white px-6 py-5 dark:border-gray-800 dark:bg-gray-900/50">
        <h2 id={titleId} className="text-xl font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white dark:focus-visible:ring-offset-gray-900"
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
    </dialog>,
    document.body,
  );
}
