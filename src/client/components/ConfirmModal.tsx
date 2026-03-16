import { Modal } from './Modal';
import { useTheme } from '../contexts/ThemeContext';

interface ConfirmModalProps {
    readonly isOpen: boolean;
    readonly title: string;
    readonly message: string;
    readonly confirmLabel?: string;
    readonly cancelLabel?: string;
    readonly isDestructive?: boolean;
    readonly onConfirm: () => void;
    readonly onClose: () => void;
}

export function ConfirmModal({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    isDestructive = false,
    onConfirm,
    onClose
}: ConfirmModalProps) {
    const { darkMode } = useTheme();

    return (
        <Modal title={title} isOpen={isOpen} onClose={onClose}>
            <div className="space-y-6">
                <p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {message}
                </p>
                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${darkMode
                            ? 'border-gray-800 text-gray-400 hover:bg-gray-800'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                        className={`rounded-xl px-4 py-2 text-sm font-medium text-white transition-all active:scale-95 ${isDestructive
                            ? 'bg-red-600 hover:bg-red-500 shadow-lg shadow-red-500/20'
                            : 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20'
                            }`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
