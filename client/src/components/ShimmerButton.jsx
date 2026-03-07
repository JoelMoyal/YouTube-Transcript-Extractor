import React from 'react';

/**
 * ShimmerButton — Magic UI
 * Primary CTA button with a diagonal shimmer sweep on hover.
 */
export function ShimmerButton({
  children,
  onClick,
  disabled,
  type = 'button',
  shimmerColor = 'rgba(255,255,255,0.25)',
  background = '#3C8CFF',
  hoverBackground = '#1F6BFF',
  style = {},
  ...props
}) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <>
      <style>{`
        @keyframes shimmer-sweep {
          0%   { transform: translateX(-100%) skewX(-12deg); }
          100% { transform: translateX(250%) skewX(-12deg); }
        }
        .shimmer-btn {
          position: relative;
          overflow: hidden;
          cursor: pointer;
          border: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-family: inherit;
          font-weight: 600;
          transition: background 0.18s ease, transform 0.12s ease, box-shadow 0.18s ease;
          -webkit-font-smoothing: antialiased;
        }
        .shimmer-btn:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(60,140,255,0.38);
        }
        .shimmer-btn:not(:disabled):active {
          transform: translateY(0);
        }
        .shimmer-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .shimmer-btn-sweep {
          position: absolute;
          inset: 0;
          width: 45%;
          background: linear-gradient(
            to right,
            transparent,
            ${shimmerColor},
            transparent
          );
          transform: translateX(-100%) skewX(-12deg);
          pointer-events: none;
        }
        .shimmer-btn:not(:disabled):hover .shimmer-btn-sweep {
          animation: shimmer-sweep 0.7s ease forwards;
        }
      `}</style>
      <button
        type={type}
        className="shimmer-btn"
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: hovered ? hoverBackground : background,
          ...style,
        }}
        {...props}
      >
        <span className="shimmer-btn-sweep" aria-hidden="true" />
        {children}
      </button>
    </>
  );
}
