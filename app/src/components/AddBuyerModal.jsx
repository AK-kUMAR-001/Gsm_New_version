import React, { useState, useEffect } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import Modal from '../components/Modal.jsx';
import { Users, Plus } from 'lucide-react';

export default function AddBuyerModal({ open, onClose }) {
  const { insertBuyer } = useAppData();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setPhone('');
      setAddress('');
      setBusy(false);
    }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const { error } = await insertBuyer({
      name: name.trim(),
      phone: phone.trim() || null,
      address: address.trim() || null,
    });
    setBusy(false);
    if (!error) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add New Buyer">
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label">Name <span className="text-red-500">*</span></label>
          <input
            required
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Buyer full name"
            className="input"
          />
        </div>
        <div>
          <label className="label">Phone</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            className="input"
          />
        </div>
        <div>
          <label className="label">Address</label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Shop address, market, etc."
            rows={3}
            className="input resize-none"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-outline flex-1"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="btn-green flex-1"
          >
            <Users className="w-4 h-4" />
            {busy ? 'Saving…' : 'Add Buyer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
