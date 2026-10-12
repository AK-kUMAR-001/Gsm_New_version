import React from 'react';

export const PERIOD_OPTIONS = [
  { key: 'week',    label: 'This Week' },
  { key: 'month',   label: 'This Month' },
  { key: '3months', label: '3 Months' },
  { key: 'all',     label: 'All Time' },
];

export const RETAIL_PERIOD_OPTIONS = [
  { key: 'today',   label: 'Today' },
  { key: 'week',    label: 'This Week' },
  { key: 'month',   label: 'This Month' },
  { key: 'all',     label: 'All Time' },
];

export default function PeriodPills({ value, onChange, options = PERIOD_OPTIONS, className = '' }) {
  return (
    <div className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`period-pill ${value === o.key ? 'active' : ''}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
