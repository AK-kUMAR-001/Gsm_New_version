import React, { useState } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { todayIST } from '../lib/business.js';
import Modal from './Modal.jsx';

const LEAVE_CONFIRMATION_CODE = 'gsm1234';

export default function BusinessDayLeaveControl({ date, onMarked, inline = false }) {
  const { markBusinessDayHoliday } = useAppData();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (code !== LEAVE_CONFIRMATION_CODE) {
      setError('The confirmation code does not match.');
      return;
    }
    setSaving(true);
    setError('');
    const result = await markBusinessDayHoliday(date);
    setSaving(false);
    if (result.error) {
      setError(result.error.message || 'Could not mark this date as a holiday.');
      return;
    }
    setCode('');
    setOpen(false);
    onMarked?.();
  };

  const submit = (event) => {
    event.preventDefault();
    void confirm();
  };

  const dismiss = () => {
    if (saving) return;
    setOpen(false);
    setCode('');
    setError('');
  };

  const confirmation = (
    <div className={`space-y-4 ${inline ? 'rounded-xl border border-red-200 bg-red-50 p-3' : ''}`}>
      <p className="text-sm text-ink-600">
        This marks the date as a holiday and skips stock, buyer sales, and retail entry. You can reopen it from
        the Retail week view later.
      </p>
      <label className="block">
        <span className="label">Type the confirmation code</span>
        <input
          type="password"
          autoComplete="off"
          autoFocus
          required={!inline}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && inline) {
              event.preventDefault();
              event.stopPropagation();
              void confirm();
            }
          }}
          className="input"
        />
      </label>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-outline" onClick={dismiss} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => { void confirm(); }}
          className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Confirm leave'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(''); setOpen(true); }}
        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
      >
        {date === todayIST() ? 'Today Leave' : 'Mark as Leave'}
      </button>
      {inline ? open && confirmation : (
        <Modal
          open={open}
          onClose={dismiss}
          title={date === todayIST() ? 'Mark today as leave?' : 'Mark this date as leave?'}
          maxWidth="max-w-sm"
        >
          <form onSubmit={submit} className="space-y-4">
            {confirmation}
            <button type="submit" className="sr-only">Confirm leave</button>
          </form>
        </Modal>
      )}
    </>
  );
}
