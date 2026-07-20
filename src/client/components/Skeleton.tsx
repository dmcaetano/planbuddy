import type { CSSProperties } from "react";

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

/** A single shimmering placeholder block. Respects prefers-reduced-motion via global.css. */
export function Skeleton({ className = "", style }: SkeletonProps) {
  return <div className={`skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}

interface SkeletonListProps {
  /** Number of placeholder cards to render. */
  rows?: number;
  /** Number of body lines per card, in addition to the title line. */
  lines?: number;
  /** Accessible label announced while the region is busy. */
  label?: string;
}

/** List-shaped skeleton for initial-fetch loading states — a stack of card-shaped shimmer blocks. */
export function SkeletonList({ rows = 3, lines = 2, label = "Loading" }: SkeletonListProps) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }).map((_, row) => (
        <div className="card skeleton-card" key={row}>
          <Skeleton className="skeleton-line skeleton-line--title" />
          {Array.from({ length: lines }).map((_, line) => (
            <Skeleton className="skeleton-line" key={line} style={line === lines - 1 ? { width: "70%" } : undefined} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
