'use client';

import Link from 'next/link';
import { ClipboardList, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppShellProps {
  title: string;
  description?: string;
  active: 'docs' | 'list';
  badges?: React.ReactNode;
  side?: React.ReactNode;
  footer?: React.ReactNode;
  lockViewport?: boolean;
  children: React.ReactNode;
}

const navItems = [
  { key: 'docs', label: '汇总', href: '/', icon: FileText },
  { key: 'list', label: '列表', href: '/list', icon: ClipboardList },
] as const;

export default function AppShell({
  title,
  description,
  active,
  badges,
  side,
  footer,
  lockViewport,
  children,
}: AppShellProps) {
  const outerClassName = cn(
    lockViewport ? 'h-screen' : 'min-h-screen',
    'shell-surface'
  );
  const innerClassName = cn(
    'relative z-10 mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8',
    lockViewport ? 'h-full min-h-0 overflow-hidden' : 'min-h-screen'
  );
  const mainClassName = cn(
    'flex min-w-0 flex-1 flex-col gap-6',
    lockViewport ? 'min-h-0 overflow-hidden' : ''
  );

  return (
    <div className={outerClassName}>
      <div className={innerClassName}>
        <header className="card-surface ui-reveal flex flex-wrap items-center justify-between gap-4 rounded-3xl px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
              <FileText className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-[10px] uppercase tracking-[0.4em] text-slate-400">PRD Studio</div>
              <div className="font-display text-lg text-slate-900 dark:text-slate-50">AI PRD</div>
            </div>
          </div>
          <nav className="flex items-center gap-1 rounded-full border border-slate-200/70 bg-white/70 p-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 shadow-sm backdrop-blur">
            {navItems.map((item) => {
              const isActive = item.key === active;
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-3 py-1.5 transition',
                    isActive
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className={mainClassName}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl text-slate-900 dark:text-slate-50">{title}</h1>
              {description && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
            </div>
            {badges && <div className="flex flex-wrap items-center gap-2">{badges}</div>}
          </div>

          {side ? (
            <div
              className={cn(
                'grid gap-6 lg:grid-cols-[280px_1fr]',
                lockViewport ? 'flex-1 min-h-0' : ''
              )}
            >
              <div>{side}</div>
              <div className={lockViewport ? 'min-h-0 h-full' : undefined}>{children}</div>
            </div>
          ) : (
            <div className={lockViewport ? 'flex-1 min-h-0 h-full' : undefined}>{children}</div>
          )}
          {footer && (
            <div className="card-surface mt-2 flex flex-col gap-3 rounded-2xl px-4 py-3 text-xs text-slate-500 dark:text-slate-300">
              {footer}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
