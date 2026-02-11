'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

export function Tabs({ value, defaultValue, onValueChange, className, children }: {
  value?: string;
  defaultValue: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = React.useState(defaultValue);
  const current = value ?? internal;

  return (
    <TabsContext.Provider
      value={{
        value: current,
        setValue: (next) => {
          if (value === undefined) {
            setInternal(next);
          }
          onValueChange?.(next);
        }
      }}
    >
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('inline-flex h-10 items-center rounded-md bg-secondary p-1 text-muted-foreground', className)} {...props} />;
}

export function TabsTrigger({ value, className, ...props }: React.ComponentProps<'button'> & { value: string }) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) {
    throw new Error('TabsTrigger must be used within Tabs');
  }

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
        ctx.value === value ? 'bg-card text-foreground shadow-sm' : 'hover:text-foreground',
        className
      )}
      onClick={() => ctx.setValue(value)}
      type="button"
      {...props}
    />
  );
}

export function TabsContent({ value, className, ...props }: React.ComponentProps<'div'> & { value: string }) {
  const ctx = React.useContext(TabsContext);
  if (!ctx || ctx.value !== value) {
    return null;
  }

  return <div className={cn('mt-2', className)} {...props} />;
}
