import React from 'react';
import logo from '../assets/logo.png';

export default function Logo({ className = '', compact = false }) {
  return (
    <img
      src={logo}
      alt="Al Wekala Market"
      width="282"
      height="230"
      loading="eager"
      fetchPriority="high"
      decoding="async"
      className={`brand-logo ${compact ? 'compact' : 'full'} ${className}`.trim()}
    />
  );
}
