import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import {
  firstIncompleteBusinessDay,
  RETAIL_START_WORKFLOW_INTENT,
} from '../lib/businessDayWorkflow.js';
import { formatDateCompact, todayIST } from '../lib/business.js';
import QuickBuyerEntryModal from './QuickBuyerEntryModal.jsx';
import StartRetailDayModal from './StartRetailDayModal.jsx';
import BusinessDayLeaveControl from './BusinessDayLeaveControl.jsx';

const EMPTY_PRICES = [];

export default function DailyBusinessWorkflow() {
  const navigate = useNavigate();
  const {
    activeBuyers,
    activeProducts,
    inventorySettings,
    inventoryCounts,
    inventoryMovements,
    retailDaySessions,
    dailyBuyerProgress,
    businessDayHolidays,
    businessDayStartDate,
    businessDayWorkflowError,
    inventoryLoading,
    loading,
    offline,
    saveRetailDayPrices,
    showToast,
  } = useAppData();
  const [pausedKey, setPausedKey] = useState('');
  const [buyerOpen, setBuyerOpen] = useState(false);
  const [retailOpen, setRetailOpen] = useState(false);
  const [retailError, setRetailError] = useState('');
  const retailRedirectStarted = useRef(false);

  const trackedProducts = useMemo(() => {
    const activeIds = new Set(activeProducts.map((product) => product.id));
    return inventorySettings
      .filter((setting) => activeIds.has(setting.product_id))
      .map((setting) => ({ id: setting.product_id, enabled_at: setting.enabled_at }));
  }, [activeProducts, inventorySettings]);

  const pending = useMemo(() => firstIncompleteBusinessDay({
    startDate: businessDayStartDate,
    today: todayIST(),
    holidays: businessDayHolidays,
    activeBuyers,
    buyerProgress: dailyBuyerProgress,
    trackedProducts,
    inventoryCounts,
    retailDaySessions,
  }), [
    activeBuyers,
    businessDayHolidays,
    businessDayStartDate,
    dailyBuyerProgress,
    inventoryCounts,
    retailDaySessions,
    trackedProducts,
  ]);
  const pendingStock = useMemo(() => {
    const quantities = new Map();
    const costs = new Map();
    if (!pending) return { quantities, costs };
    for (const movement of inventoryMovements) {
      if (movement.movement_date !== pending.date) continue;
      quantities.set(
        movement.product_id,
        (quantities.get(movement.product_id) || 0) + Number(movement.quantity_delta || 0),
      );
      costs.set(
        movement.product_id,
        (costs.get(movement.product_id) || 0) + Number(movement.cost_delta || 0),
      );
    }
    return { quantities, costs };
  }, [inventoryMovements, pending]);

  const buyerKey = pending?.step === 'buyer' ? `${pending.date}:${pending.buyer.id}` : '';
  const retailKey = pending?.step === 'retail' ? `${pending.date}:retail` : '';
  const currentKey = buyerKey || retailKey;

  useEffect(() => {
    if (!businessDayHolidays.some((holiday) => holiday.sale_date === todayIST())) return;
    try {
      sessionStorage.removeItem(RETAIL_START_WORKFLOW_INTENT);
    } catch (error) {
      showToast(`Could not clear the retail-start request for today's holiday: ${error.message || 'Browser storage is unavailable.'}`, 'warn');
    }
  }, [businessDayHolidays, showToast]);

  useEffect(() => {
    if (loading || inventoryLoading || businessDayWorkflowError || offline || pending?.step !== 'stock') return;
    navigate(`/inventory?workflowDate=${pending.date}`);
  }, [businessDayWorkflowError, inventoryLoading, loading, navigate, offline, pending?.date, pending?.step]);

  useEffect(() => {
    if (pending?.step !== 'buyer' || pausedKey === buyerKey) {
      setBuyerOpen(false);
      return;
    }
    setBuyerOpen(true);
  }, [buyerKey, pausedKey, pending?.step]);

  useEffect(() => {
    if (pending?.step !== 'retail' || pausedKey === retailKey) {
      setRetailOpen(false);
      return;
    }
    setRetailError('');
    if (pending.date === todayIST() && !retailRedirectStarted.current) {
      try {
        if (sessionStorage.getItem(RETAIL_START_WORKFLOW_INTENT) === '1') {
          retailRedirectStarted.current = true;
          sessionStorage.removeItem(RETAIL_START_WORKFLOW_INTENT);
          navigate('/retail?start=1', { replace: true });
          return;
        }
      } catch (error) {
        showToast(`Could not resume the requested retail start: ${error.message || 'Browser storage is unavailable.'}`, 'error');
      }
    }
    setRetailOpen(true);
  }, [navigate, pausedKey, pending?.date, pending?.step, retailKey, showToast]);

  const closeBuyer = () => {
    setBuyerOpen(false);
    setPausedKey(buyerKey);
  };

  const closeRetail = () => {
    setRetailOpen(false);
    setPausedKey(retailKey);
  };

  const resume = () => {
    setPausedKey('');
    if (pending?.step === 'buyer') setBuyerOpen(true);
    if (pending?.step === 'retail') setRetailOpen(true);
  };

  const startRetail = async (prices) => {
    const result = await saveRetailDayPrices(prices, pending.date);
    if (result.error) {
      setRetailError(result.error.message || 'Could not save retail prices.');
      return result;
    }
    setRetailOpen(false);
    return result;
  };

  if (loading || inventoryLoading) return null;

  if (businessDayWorkflowError) {
    return (
      <section className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert">
        <h2 className="font-bold">Daily entry workflow is unavailable</h2>
        <p className="mt-1">{businessDayWorkflowError}</p>
      </section>
    );
  }

  if (!businessDayStartDate) {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
        Daily entry workflow has no configured start date. Refresh the app or contact the administrator.
      </section>
    );
  }

  if (!pending) {
    const todayIsHoliday = businessDayHolidays.some((holiday) => holiday.sale_date === todayIST());
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-green-200 bg-green-50 p-4">
        <div>
          <h2 className="font-bold text-green-900">Daily entries are up to date</h2>
          <p className="mt-1 text-sm text-green-800">All required dates through {formatDateCompact(todayIST())} are complete.</p>
        </div>
        {todayIsHoliday ? (
          <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-800">Today is marked as leave</span>
        ) : (
          <BusinessDayLeaveControl date={todayIST()} />
        )}
      </section>
    );
  }

  const stepLabel = pending.step === 'stock'
    ? 'Physical stock counts'
    : pending.step === 'buyer'
      ? `Buyer entry · ${pending.buyer.name}`
      : 'Retail prices and session';
  const paused = pausedKey === currentKey;

  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <div className="min-w-[220px] flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Daily entry sequence</p>
          <h2 className="mt-1 text-lg font-extrabold text-blue-950">{formatDateCompact(pending.date)}</h2>
          <p className="mt-1 text-sm font-semibold text-blue-900">
            {pending.step === 'stock' ? `${stepLabel} · ${pending.missingStockProductIds.length} remaining` : stepLabel}
          </p>
          <p className="mt-1 text-xs text-blue-800">
            Work proceeds oldest date first: stock, active buyers one at a time, then retail.
          </p>
          {retailError && <p className="mt-2 text-sm text-red-700" role="alert">{retailError}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {paused && (
            <button type="button" onClick={resume} className="btn-navy">
              Resume this step
            </button>
          )}
          <BusinessDayLeaveControl
            date={pending.date}
            onMarked={() => {
              setBuyerOpen(false);
              setRetailOpen(false);
              setPausedKey('');
            }}
          />
        </div>
      </section>

      <QuickBuyerEntryModal
        open={pending.step === 'buyer' && buyerOpen}
        onClose={closeBuyer}
        buyerId={pending.step === 'buyer' ? pending.buyer.id : null}
        initialDate={pending.date}
        dailyWorkflow
      />
      <StartRetailDayModal
        open={pending.step === 'retail' && retailOpen}
        onClose={closeRetail}
        products={activeProducts.filter((product) => trackedProducts.some((tracked) => tracked.id === product.id))}
        stockByProduct={pendingStock.quantities}
        stockCostByProduct={pendingStock.costs}
        saleDate={pending.date}
        initialPrices={EMPTY_PRICES}
        onStart={startRetail}
        onLeave={() => {
          setRetailOpen(false);
          setPausedKey('');
        }}
        allowLeave
        busy={false}
        error={retailError}
      />
    </>
  );
}
