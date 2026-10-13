import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A titled group of settings inside an editor tab. */
export function Section({ title, description, children, className, actions }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn('flex flex-col gap-4 border-b border-border pb-6', className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="editor-section-title">{title}</h3>
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** A secondary group, with more space above its heading than below it. */
export function Subsection({ title, children, className, headingLevel = 4 }: { title: ReactNode; children: ReactNode; className?: string; headingLevel?: 3 | 4 }) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return <div className={cn('editor-subsection', className)}>
    <Heading className="editor-subsection-title">{title}</Heading>
    {children}
  </div>;
}

export function Grid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', className)}>{children}</div>;
}

export function Note({ children, tone = 'muted', className }: { children: ReactNode; tone?: 'muted' | 'warning'; className?: string }) {
  return <p className={cn('text-[13px]', tone === 'warning' ? 'font-medium text-destructive' : 'text-muted-foreground', className)}>{children}</p>;
}
