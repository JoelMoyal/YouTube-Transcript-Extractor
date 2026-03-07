import React from 'react';

/**
 * BorderBeam — Magic UI
 * Animated beam of light that travels around a border.
 * Drop inside any `position: relative; overflow: hidden` container.
 */
export function BorderBeam({
  size = 200,
  duration = 8,
  delay = 0,
  colorFrom = 'rgba(60,140,255,0.8)',
  colorTo = 'rgba(91,155,213,0.0)',
  borderWidth = 1.5,
}) {
  const id = React.useId().replace(/:/g, '');
  return (
    <>
      <style>{`
        @keyframes border-beam-${id} {
          100% { offset-distance: 100%; }
        }
        .border-beam-${id} {
          position: absolute;
          inset: 0;
          pointer-events: none;
          border-radius: inherit;
          border: ${borderWidth}px solid transparent;
          /* clip so the beam stays inside the card edge */
          mask: linear-gradient(white, white) padding-box,
                linear-gradient(white, white);
          mask-composite: exclude;
          -webkit-mask-composite: destination-out;
        }
        .border-beam-${id}::after {
          content: '';
          position: absolute;
          inset: -${borderWidth}px;
          border-radius: inherit;
          offset-path: rect(0 auto auto 0 round inherit);
          offset-distance: 0%;
          width: ${size}px;
          height: ${size}px;
          background: radial-gradient(closest-side, ${colorFrom}, ${colorTo});
          animation: border-beam-${id} ${duration}s linear ${delay}s infinite;
        }
      `}</style>
      <div className={`border-beam-${id}`} aria-hidden="true" />
    </>
  );
}
