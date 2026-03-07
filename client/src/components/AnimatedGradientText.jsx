import React from 'react';

/**
 * AnimatedGradientText — Magic UI
 * Eyebrow badge with a slowly cycling gradient shimmer behind the text.
 */
export function AnimatedGradientText({ children, className = '' }) {
  return (
    <>
      <style>{`
        @keyframes agt-spin {
          from { --agt-angle: 0deg; }
          to   { --agt-angle: 360deg; }
        }
        @property --agt-angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
        .agt-wrap {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          position: relative;
          border-radius: 999px;
          padding: 5px 14px 5px 10px;
          cursor: default;
          background: rgba(255,255,255,0.72);
          backdrop-filter: blur(4px);
          border: 1px solid rgba(60,140,255,0.18);
        }
        .agt-shimmer {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: conic-gradient(
            from var(--agt-angle),
            transparent 25%,
            rgba(60,140,255,0.15) 50%,
            rgba(123,211,255,0.10) 75%,
            transparent
          );
          animation: agt-spin 4s linear infinite;
          pointer-events: none;
        }
        .agt-content {
          position: relative;
          z-index: 1;
          font-size: 12px;
          font-weight: 600;
          color: #3C8CFF;
          letter-spacing: 0.01em;
          line-height: 1;
        }
        .agt-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #3C8CFF;
          flex-shrink: 0;
          animation: pulse 2s ease-in-out infinite;
        }
      `}</style>
      <span className={`agt-wrap ${className}`}>
        <span className="agt-shimmer" aria-hidden="true" />
        <span className="agt-dot" aria-hidden="true" />
        <span className="agt-content">{children}</span>
      </span>
    </>
  );
}
