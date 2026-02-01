'use client';

import Link from 'next/link';
import { ClipboardList, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppShellProps {
  title: string;
  description?: string;
  active: 'chat' | 'list';
  badges?: React.ReactNode;
  side?: React.ReactNode;
  footer?: React.ReactNode;
  lockViewport?: boolean;
  children: React.ReactNode;
}

const navItems = [
  { key: 'chat', label: '聊需求', href: '/', icon: MessageCircle },
  { key: 'list', label: '需求列表', href: '/list', icon: ClipboardList },
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
    'bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950'
  );
  const innerClassName = cn(
    'mx-auto flex max-w-7xl gap-6 px-4 py-8',
    lockViewport ? 'h-full box-border overflow-hidden' : 'min-h-screen'
  );
  const mainClassName = cn(
    'flex min-w-0 flex-1 flex-col gap-6',
    lockViewport ? 'min-h-0 overflow-hidden' : ''
  );

  return (
    <div className={outerClassName}>
      <div className={innerClassName}>
        <aside className="hidden min-h-0 w-56 flex-col gap-6 rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/70 md:flex">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
              PRD Studio
            </div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              需求助手
            </div>
          </div>
          <nav className="space-y-2">
            {navItems.map((item) => {
              const isActive = item.key === active;
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition',
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-slate-50'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto space-y-3 text-xs text-slate-500 dark:text-slate-400">
            {footer}
          </div>
        </aside>

        <main className={mainClassName}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">
                {title}
              </h1>
              {description && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {description}
                </p>
              )}
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
              <div className={lockViewport ? 'min-h-0' : undefined}>{children}</div>
            </div>
          ) : (
            <div className={lockViewport ? 'flex-1 min-h-0' : undefined}>{children}</div>
          )}
        </main>
      </div>
    </div>
  );
}