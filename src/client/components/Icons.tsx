import type { SVGProps } from 'react';

function IconBase(props: SVGProps<SVGSVGElement>) {
  return <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} {...props} />;
}

export function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-18v7h6V2h-6Z" />
    </IconBase>
  );
}

export function InstancesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M7 7h10M7 12h10M7 17h10" strokeLinecap="round" />
      <path d="M4 5.5h.01M4 10.5h.01M4 15.5h.01" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function FiltersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4 6h16l-6 7v5l-4-2v-3L4 6Z" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function SchedulerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function ActivityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4 13h4l2-5 4 10 2-5h4" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path
        d="M10.3 3.6c.5-1 1.9-1 2.4 0l.7 1.5c.2.3.5.6.9.7l1.6.2c1.1.1 1.5 1.5.7 2.2l-1.2 1.1c-.3.3-.5.7-.4 1.1l.3 1.6c.2 1.1-.9 1.9-1.9 1.4l-1.4-.8c-.4-.2-.8-.2-1.2 0l-1.4.8c-1 .5-2.1-.3-1.9-1.4l.3-1.6c.1-.4-.1-.8-.4-1.1L5 8.2c-.8-.7-.4-2.1.7-2.2l1.6-.2c.4-.1.8-.3.9-.7l.7-1.5Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="1.75" />
    </IconBase>
  );
}

export function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" strokeLinecap="round" />
    </IconBase>
  );
}

export function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </IconBase>
  );
}

export function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10Z" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function KeyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="8.5" cy="11.5" r="3.5" />
      <path d="M12 11.5h8M17 11.5v3M20 11.5v2" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M12 3 5 6v5c0 4.5 2.7 7.6 7 10 4.3-2.4 7-5.5 7-10V6l-7-3Z" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function SparklesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3ZM5 16l.9 2.1L8 19l-2.1.9L5 22l-.9-2.1L2 19l2.1-.9L5 16Zm14-1 1.1 2.6L23 18.7l-2.9 1.1L19 22l-1.1-2.2L15 18.7l2.9-1.1L19 15Z" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </IconBase>
  );
}