import React from 'react';

export const PERIOD_OPTIONS = [
  { key: 'week',    label: 'This Week' },
  { key: 'month',   label: 'This Month' },
  { key: '3months', label: '3 Months' },
  { key: 'all',     label: 'All Time' },
];

export const BUYER_PERIOD_OPTIONS = [
  { key: 'today',   label: 'Today' },
  ...PERIOD_OPTIONS,
];

export const RETAIL_PERIOD_OPTIONS = [
  { key: 'today',   label: 'Today' },
  { key: 'week',    label: 'This Week' },
  { key: 'month',   label: 'This Month' },
  { key: 'all',     label: 'All Time' },
];

export default function PeriodPills({ value, onChange, options = PERIOD_OPTIONS, className = '' }) {
  return (
    <div
      role="group"
      aria-label="Choose reporting period"
      className={`grid grid-cols-2 gap-2 sm:inline-flex sm:flex-wrap sm:items-center ${className}`}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`period-pill min-h-11 ${value === o.key ? 'active' : ''}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
