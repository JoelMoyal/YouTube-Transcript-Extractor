import React, { useRef, useState, useEffect } from 'react';
import { motion, useInView } from 'framer-motion';

/**
 * BlurFade — Magic UI
 * Fades + blurs in children when they enter the viewport.
 */
export function BlurFade({
  children,
  delay = 0,
  duration = 0.5,
  yOffset = 16,
  blur = '8px',
  inViewMargin = '-80px',
  once = true,
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once, margin: inViewMargin });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: yOffset, filter: `blur(${blur})` }}
      animate={inView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
      transition={{
        duration,
        delay,
        ease: [0.21, 0.47, 0.32, 0.98],
      }}
    >
      {children}
    </motion.div>
  );
}
