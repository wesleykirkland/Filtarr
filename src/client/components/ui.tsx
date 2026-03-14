import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950';

const baseSurface = 'border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

export function buttonStyles({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}) {
  const sizeStyles: Record<ButtonSize, string> = {
    sm: 'rounded-lg px-3 py-1.5 text-xs',
    md: 'rounded-lg px-4 py-2 text-sm',
    lg: 'rounded-xl px-5 py-2.5 text-sm',
  };

  const variantStyles: Record<ButtonVariant, string> = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary:
      'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800',
    ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white',
    danger:
      'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50',
    success: 'bg-green-600 text-white hover:bg-green-700',
  };

  return cn(
    'inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    focusRing,
    sizeStyles[size],
    variantStyles[variant],
    fullWidth && 'w-full',
    className,
  );
}

export function inputStyles(className?: string) {
  return cn(
    'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500',
    'focus:border-blue-500 dark:focus:border-blue-400',
    focusRing,
    className,
  );
}

export function checkboxStyles(className?: string) {
  return cn(
    'h-4 w-4 rounded border border-gray-300 bg-white text-blue-600 dark:border-gray-700 dark:bg-gray-800',
    focusRing,
    className,
  );
}

export function badgeStyles(
  variant: 'default' | 'info' | 'success' | 'warning' | 'danger' = 'default',
  className?: string,
) {
  const variants = {
    default: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    info: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
    success: 'bg-green-500/15 text-green-700 dark:text-green-300',
    warning: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300',
    danger: 'bg-red-500/15 text-red-700 dark:text-red-300',
  };

  return cn(
    'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide',
    variants[variant],
    className,
  );
}

export function Button({
  type = 'button',
  variant,
  size,
  fullWidth,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}) {
  return (
    <button
      type={type}
      className={buttonStyles({ variant, size, fullWidth, className })}
      {...props}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={inputStyles(className)} {...props} />,
);

Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={inputStyles(cn('min-h-28 resize-y', className))} {...props} />
));

Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={inputStyles(cn('pr-9', className))} {...props} />
  ),
);

Select.displayName = 'Select';

export function Field({
  label,
  htmlFor,
  description,
  children,
  className,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      {description && <p className="text-xs text-gray-500 dark:text-gray-500">{description}</p>}
      {children}
    </div>
  );
}

export function CheckboxField({
  id,
  label,
  description,
  checked,
  onChange,
  className,
}: {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly className?: string;
}) {
  return (
    <label className={cn('flex items-start gap-3 rounded-lg', className)} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={checkboxStyles('mt-0.5')}
      />
      <span>
        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-gray-500">{description}</span>}
      </span>
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors',
        focusRing,
        checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export function Card({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <section className={cn('rounded-2xl p-6', baseSurface, className)}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children,
  variant = 'default',
  className,
}: {
  readonly children: ReactNode;
  readonly variant?: 'default' | 'info' | 'success' | 'warning' | 'danger';
  readonly className?: string;
}) {
  return <span className={badgeStyles(variant, className)}>{children}</span>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-gray-500">{description}</p>}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-gray-300 bg-gray-50/80 p-12 text-center dark:border-gray-800 dark:bg-gray-900/30">
      {icon ? (
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-300">
          {icon}
        </div>
      ) : null}
      <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-gray-500">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ value: T; label: string; description?: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div role="tablist" aria-label="Sections" className="grid gap-2 md:grid-cols-4">
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(item.value)}
              className={cn(
                'rounded-xl px-4 py-3 text-left transition-colors',
                focusRing,
                selected
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
              )}
            >
              <div className="text-sm font-semibold">{item.label}</div>
              {item.description ? (
                <div className={cn('mt-1 text-xs', selected ? 'text-blue-100' : 'text-gray-500')}>
                  {item.description}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
