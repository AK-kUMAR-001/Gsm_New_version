import React, { useState, useMemo } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { getProductEmoji } from '../lib/business.js';
import { ChevronDown, ChevronUp, CheckCircle2, Save, Info, Package, Leaf, Plus, Pencil, Trash2 } from 'lucide-react';

const PRODUCT_EMOJIS = ['🌼', '🍃', '🌿', '🧄', '🌱', '🌸', '🌺', '🪴', '🥬', '🧅', '🥕', '🍀', '🍋', '🍅', '🥔', '🌾'];

function isValidSortOrder(value) {
  return value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0;
}

function EmojiPicker({ value, onChange }) {
  return (
    <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
      {PRODUCT_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`Choose ${emoji} icon`}
          aria-pressed={value === emoji}
          onClick={() => onChange(emoji)}
          className={`h-10 rounded-xl border text-xl transition ${
            value === emoji
              ? 'border-brand-green bg-brand-green/10 ring-2 ring-brand-green/20'
              : 'border-ink-200 bg-white hover:bg-ink-50'
          }`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function ActiveToggle({ value, onChange, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!value);
      }}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-green/50 ${
        value ? 'bg-brand-green' : 'bg-ink-200'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          value ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function ProductCard({ product, onSave, onDelete, isOffline }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: product.name || '',
    emoji: product.emoji || getProductEmoji(product.name, []),
    sort_order: product.sort_order ?? 0,
    active: product.active !== false,
  });
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const isPrimary = (form.sort_order ?? 0) <= 2;
  const displayEmoji = form.emoji || getProductEmoji(form.name || product.name, []);

  const handleToggleActive = (val) => {
    setForm((f) => ({ ...f, active: val }));
  };

  const resetForm = () => {
    setForm({
      name: product.name || '',
      emoji: product.emoji || getProductEmoji(product.name, []),
      sort_order: product.sort_order ?? 0,
      active: product.active !== false,
    });
    setSavedOk(false);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.emoji || !isValidSortOrder(form.sort_order)) return;
    setSaving(true);
    setSavedOk(false);
    const patch = {
      name: form.name.trim(),
      emoji: form.emoji,
      sort_order: Number(form.sort_order) || 0,
      active: form.active,
    };
    const res = await onSave(product.id, patch);
    setSaving(false);
    if (res && !res.error) {
      const updated = res.data || {};
      setForm({
        name: updated.name ?? patch.name,
        emoji: updated.emoji ?? patch.emoji ?? '',
        sort_order: updated.sort_order ?? patch.sort_order,
        active: updated.active ?? patch.active,
      });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 1500);
      setTimeout(() => setOpen(false), 600);
    }
  };

  const handleDelete = async () => {
    if (isOffline || saving || !window.confirm(`Delete ${product.name}? If it has stock history, it will be archived to preserve the ledger.`)) return;
    setSaving(true);
    setDeleteError('');
    const result = await onDelete(product.id);
    setSaving(false);
    if (result?.error) {
      setDeleteError(result.error.message || 'The product could not be deleted.');
    } else if (result?.data === 'archived') {
      setForm((current) => ({ ...current, active: false }));
    }
  };

  return (
    <div className="metric-card !p-0 overflow-hidden">
      <div
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_minmax(120px,1fr)_auto] items-center gap-3 px-4 py-3.5 hover:bg-ink-50 transition"
      >
        <div className="w-11 h-11 rounded-xl bg-ink-100 flex items-center justify-center text-2xl shrink-0">
          {displayEmoji}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-ink-900 truncate">{form.name || product.name}</span>
            {savedOk && (
              <span className="pill !text-[10px] !py-0.5 !px-2 bg-brand-green/15 text-green-700 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Saved
              </span>
            )}
          </div>
          <div className="text-xs text-ink-500 mt-0.5">
            Sort order: {form.sort_order ?? 0}
          </div>
        </div>

        <span className={`pill col-start-2 row-start-2 sm:col-start-3 sm:row-start-1 justify-self-center text-xs py-0.5 px-2.5 ${
          isPrimary
            ? 'bg-brand-navy/10 text-brand-navy border border-brand-navy/20'
            : 'bg-amber-500/10 text-amber-700 border border-amber-500/20'
        }`}>
          {isPrimary ? 'Primary' : 'Occasional'}
        </span>

        <div className="col-start-3 row-span-2 sm:col-start-4 sm:row-span-1 flex items-center gap-2 shrink-0">
          <ActiveToggle
            value={form.active}
            onChange={handleToggleActive}
            disabled={saving}
          />
          <button
            type="button"
            aria-label={`Edit ${product.name}`}
            title="Edit product"
            disabled={saving}
            onClick={() => {
              if (!open) resetForm();
              setOpen((current) => !current);
            }}
            className="p-2 rounded-lg text-ink-500 hover:bg-brand-green/10 hover:text-brand-green-dark disabled:opacity-50"
          >
            {open ? <ChevronUp className="w-5 h-5" /> : <Pencil className="w-5 h-5" />}
          </button>
          <button
            type="button"
            aria-label={`Delete ${product.name}`}
            title="Delete product"
            disabled={saving || isOffline}
            onClick={handleDelete}
            className="p-2 rounded-lg text-ink-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-ink-100 space-y-4 animate-slideUp">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor={`product-name-${product.id}`}>Product Name</label>
              <input
                id={`product-name-${product.id}`}
                type="text"
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Malli"
                maxLength={80}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <span className="label">Product Icon</span>
              <EmojiPicker value={form.emoji} onChange={(emoji) => setForm((f) => ({ ...f, emoji }))} />
            </div>
            <div>
              <label className="label" htmlFor={`product-order-${product.id}`}>Sort Order</label>
              <input
                id={`product-order-${product.id}`}
                type="number"
                className="input"
                value={form.sort_order}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                min={0}
                step={1}
                required
              />
            </div>
            <div>
              <label className="label">Active</label>
              <div className="flex items-center gap-3 h-[42px] px-3 rounded-xl border border-ink-200 bg-white">
                <ActiveToggle
                  value={form.active}
                  onChange={(v) => setForm((f) => ({ ...f, active: v }))}
                />
                <span className={`text-sm font-semibold ${
                  form.active ? 'text-brand-green-dark' : 'text-ink-500'
                }`}>
                  {form.active ? 'Active — visible in sales forms' : 'Inactive — hidden from selection'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="text-xs text-ink-500 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              Sort order ≤ 2 badges product as Primary
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-outline"
                onClick={() => { resetForm(); setOpen(false); }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-green min-h-[44px]"
                onClick={handleSave}
                disabled={saving || isOffline || !form.name.trim() || !form.emoji || !isValidSortOrder(form.sort_order)}
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-ink-900/30 border-t-ink-900 rounded-full animate-spin" />
                    Saving…
                  </>
                ) : savedOk ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Saved
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteError && (
        <p className="border-t border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {deleteError}
        </p>
      )}
    </div>
  );
}

function AddProductForm({ onSave, onCancel, isOffline, defaultSortOrder }) {
  const [form, setForm] = useState({
    name: '',
    emoji: PRODUCT_EMOJIS[0],
    sort_order: defaultSortOrder,
    active: true,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.emoji || !isValidSortOrder(form.sort_order)) return;
    setSaving(true);
    const result = await onSave({ ...form, name: form.name.trim(), sort_order: Number(form.sort_order) });
    setSaving(false);
    if (!result?.error) onCancel();
  };

  return (
    <form onSubmit={handleSubmit} className="metric-card space-y-4 border-brand-green/30">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-ink-900">Add a product</h2>
        <button type="button" className="btn-ghost !p-2" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="new-product-name">Product Name</label>
          <input
            id="new-product-name"
            type="text"
            className="input"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="e.g. Malli"
            maxLength={80}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="new-product-order">Sort Order</label>
          <input
            id="new-product-order"
            type="number"
            className="input"
            value={form.sort_order}
            onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))}
            min={0}
            step={1}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <span className="label">Product Icon</span>
          <EmojiPicker value={form.emoji} onChange={(emoji) => setForm((current) => ({ ...current, emoji }))} />
        </div>
        <div className="sm:col-span-2">
          <span className="label">Status</span>
          <div className="flex items-center gap-3 min-h-[44px] px-3 rounded-xl border border-ink-200 bg-white">
            <ActiveToggle value={form.active} onChange={(active) => setForm((current) => ({ ...current, active }))} />
            <span className={`text-sm font-semibold ${form.active ? 'text-brand-green-dark' : 'text-ink-500'}`}>
              {form.active ? 'Active — visible in sales forms' : 'Inactive — hidden from selection'}
            </span>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn-green min-h-[44px]" disabled={saving || isOffline || !form.name.trim() || !form.emoji || !isValidSortOrder(form.sort_order)}>
          {saving ? 'Adding…' : <><Plus className="w-4 h-4" /> Add Product</>}
        </button>
      </div>
    </form>
  );
}

export default function Products() {
  const app = useAppData();
  const { products, activeProducts, updateProduct, insertProduct, deleteProduct, offline } = app;
  const [addOpen, setAddOpen] = useState(false);

  const sortedProducts = useMemo(() => {
    return [...(products || [])].sort((a, b) => {
      const sa = a.sort_order ?? 0;
      const sb = b.sort_order ?? 0;
      if (sa !== sb) return sa - sb;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [products]);

  const activeCount = activeProducts?.length || 0;
  const totalCount = products?.length || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2">
            <Package className="w-7 h-7 text-brand-navy" />
            Product Catalog
          </h1>
          <p className="text-ink-500 text-sm mt-1">
            Manage the products GSM Traders buys and sells
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="metric-card !p-3 flex items-center gap-3 !rounded-2xl">
            <div className="w-10 h-10 rounded-xl bg-brand-green/20 flex items-center justify-center">
              <Leaf className="w-5 h-5 text-brand-green-dark" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-ink-500">Active Products</div>
              <div className="text-xl font-bold text-ink-900">
                {activeCount}
                <span className="text-sm text-ink-400 font-semibold ml-1">/ {totalCount}</span>
              </div>
            </div>
          </div>
          <button type="button" onClick={() => setAddOpen((open) => !open)} className="btn-green min-h-[44px]" disabled={offline}>
            <Plus className="w-4 h-4" /> Add Product
          </button>
        </div>
      </div>

      {addOpen && (
        <AddProductForm
          onSave={insertProduct}
          onCancel={() => setAddOpen(false)}
          isOffline={offline}
          defaultSortOrder={Math.max(0, ...sortedProducts.map((product) => Number(product.sort_order) || 0)) + 1}
        />
      )}

      {sortedProducts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sortedProducts.slice(0, 12).map((p) => {
            const emoji = p.emoji || getProductEmoji(p.name, products);
            const isActive = p.active !== false;
            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition ${
                  isActive
                    ? 'bg-white border-ink-100 shadow-card'
                    : 'bg-ink-50 border-ink-100 opacity-60'
                }`}
              >
                <span className="text-lg">{emoji}</span>
                <span className="text-sm font-semibold text-ink-700">{p.name}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        {sortedProducts.length === 0 && (
          <div className="metric-card text-center py-12">
            <Package className="w-12 h-12 mx-auto text-ink-300 mb-3" />
            <div className="font-semibold text-ink-700">No products yet</div>
            <div className="text-sm text-ink-500 mt-1">Products will appear here once synced</div>
          </div>
        )}

        {sortedProducts.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            onSave={updateProduct}
            onDelete={deleteProduct}
            isOffline={offline}
          />
        ))}
      </div>
    </div>
  );
}
