import React, { useRef, useEffect, useState } from 'react';
import { useInView, useMotionValue, useTransform, animate } from 'framer-motion';
import { motion } from 'framer-motion';

/**
 * NumberTicker — Magic UI
 * Counts up to `value` when scrolled into view.
 */
export function NumberTicker({
  value,
  startValue = 0,
  delay = 0,
  decimalPlaces = 0,
  suffix = '',
  prefix = '',
  style = {},
}) {
  const ref = useRef(null);
  const motionValue = useMotionValue(startValue);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const [display, setDisplay] = useState(
    prefix + startValue.toFixed(decimalPlaces) + suffix
  );

  useEffect(() => {
    if (!inView) return;
    const controls = animate(motionValue, value, {
      duration: 1.6,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate(v) {
        setDisplay(prefix + v.toFixed(decimalPlaces) + suffix);
      },
    });
    return controls.stop;
  }, [inView, value, delay, decimalPlaces, prefix, suffix, motionValue]);

  return (
    <span ref={ref} style={style}>
      {display}
    </span>
  );
}
