// script.js
document.addEventListener('DOMContentLoaded', function () {
  const $ = id => document.getElementById(id);

  // Elements
  const itemType = $('itemType');
  const priceInput = $('price');
  const desiredInput = $('desired');
  const actualWeightInput = $('actualWeight');
  const lengthInput = $('length');
  const widthInput = $('width');
  const heightInput = $('height');
  const zoneSelect = $('zone');
  const includeShippingCheckbox = $('includeShippingInCollection');

  const commissionRateInput = $('commissionRate');
  const collectionRateInput = $('collectionRate');
  const closingFeeDisplay = $('closingFeeDisplay');
  const gstRateInput = $('gstRate');

  const calcBtn = $('calcBtn');
  const resetBtn = $('resetBtn');
  const copyBtn = $('copyBtn');

  // Outputs
  const finalPayoutEl = $('finalPayout');
  const reqPriceEl = $('reqPrice');
  const outChargeable = $('outChargeable');
  const outShipping = $('outShipping');
  const outCommission = $('outCommission');
  const outCollection = $('outCollection');
  const outClosing = $('outClosing');
  const outFeesBeforeGst = $('outFeesBeforeGst');
  const outGst = $('outGst');
  const outTotalDeduct = $('outTotalDeduct');
  const errEl = $('err');

  // Collection fee cap
  const COLLECTION_CAP = 30; // ₹30 cap

  // Default item library
  const ITEMS = {
    Jar: { actualWeight: 350, length: 12, width: 12, height: 15 }
  };

  // Populate item defaults
  function populateItemDefaults(name) {
    const it = ITEMS[name];
    if (!it) return;
    actualWeightInput.value = it.actualWeight;
    lengthInput.value = it.length;
    widthInput.value = it.width;
    heightInput.value = it.height;
  }

  // Closing fee slab by selling price
  function closingFeeForPrice(P) {
    if (isNaN(P) || P <= 0) return 0;
    if (P <= 250) return 5;
    if (P <= 500) return 10;
    if (P <= 1000) return 15;
    return 20;
  }

  // Volumetric weight (kg) = L(cm) * W(cm) * H(cm) / 5000
  function volumetricKg(L, W, H) {
    return (L * W * H) / 5000.0;
  }

  // Shipping fee table (editable). Values are examples.
  function computeShippingFee(chargeableKg, zone) {
    if (chargeableKg <= 0.5) return zone === 'local' ? 30 : zone === 'zonal' ? 40 : 45;
    if (chargeableKg <= 1) return zone === 'local' ? 35 : zone === 'zonal' ? 50 : 60;
    if (chargeableKg <= 2) return zone === 'local' ? 45 : zone === 'zonal' ? 70 : 85;
    if (chargeableKg <= 3) return zone === 'local' ? 70 : zone === 'zonal' ? 110 : 150;
    // >3kg: base + per-kg
    const base = zone === 'local' ? 70 : zone === 'zonal' ? 110 : 150;
    const perKg = zone === 'local' ? 20 : zone === 'zonal' ? 30 : 40;
    const extra = Math.ceil(chargeableKg - 3);
    return base + extra * perKg;
  }

  // Safe parse
  function parseNum(el) {
    const v = parseFloat(el.value);
    return isNaN(v) ? NaN : v;
  }

  // Currency format INR
  const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
  function fmt(v) {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return currency.format(Math.round((v + Number.EPSILON) * 100) / 100);
  }

  // Read rates
  function readRates() {
    const commissionRate = (parseNum(commissionRateInput) || 0) / 100;
    const collectionRate = (parseNum(collectionRateInput) || 0) / 100;
    const gstRate = (parseNum(gstRateInput) || 0) / 100;
    const includeShipping = includeShippingCheckbox.checked;
    return { commissionRate, collectionRate, gstRate, includeShipping };
  }

  // Forward compute: given price P, shippingFee and rates
  function computeFromPrice(P, shippingFee, rates) {
    const comm = P * rates.commissionRate;
    const coll = rates.includeShipping ? (P + shippingFee) * rates.collectionRate : P * rates.collectionRate;
    const collCapped = Math.min(coll, COLLECTION_CAP);
    const closing = closingFeeForPrice(P);
    const feesBeforeGst = comm + collCapped + closing + shippingFee;
    const gst = feesBeforeGst * rates.gstRate;
    const totalDeduct = feesBeforeGst + gst;
    const payout = P - totalDeduct;
    return { comm, collRaw: coll, coll: collCapped, closing, feesBeforeGst, gst, totalDeduct, payout };
  }

  // Reverse compute required price for desired payout D (piecewise to handle cap)
  function computeRequiredPrice(D, shippingFee, rates) {
    // two possible branches:
    // Branch A: collection is uncapped (collection = collRate * (P or P+shipping))
    // Branch B: collection caps at COLLECTION_CAP

    const a = rates.commissionRate + rates.collectionRate; // coefficient on P inside feesBeforeGst when collection applies to P only
    const multiplier = 1 + rates.gstRate;

    // We'll handle both cases depending on whether collection includes shipping
    if (!rates.includeShipping) {
      // collection = collRate * P
      // Branch A (uncapped):
      const C = shippingFee + /*closing is function of P — but closing is slab-based (depends on P).*/ 0;
      // Because closingFee depends on P, we cannot directly plug it in algebraically without piecewise on slabs.
      // Approach: try solving within each closing-fee slab. We'll iterate over price-slab ranges (small fixed set).
      const slabs = [
        { min: 0.01, max: 250, close: 5 },
        { min: 250.01, max: 500, close: 10 },
        { min: 500.01, max: 1000, close: 15 },
        { min: 1000.01, max: 1e7, close: 20 }
      ];

      for (let s of slabs) {
        const close = s.close;
        const Cconst = close + shippingFee;
        const denom = 1 - multiplier * (rates.commissionRate + rates.collectionRate);
        if (denom > 0) {
          const Pcand = (D + multiplier * Cconst) / denom;
          // check slab consistency and collection cap condition
          if (Pcand >= s.min && Pcand <= s.max) {
            const collRaw = rates.collectionRate * Pcand;
            if (collRaw <= COLLECTION_CAP) {
              return { P: Pcand, branch: 'uncapped', slab: s, note: '' };
            }
            // else collRaw > cap -> not valid for this branch
          }
        }
      }

      // Branch B: collection capped -> coll = COLLECTION_CAP (const)
      // Then feesBeforeGst = commissionRate*P + COLLECTION_CAP + closing + shippingFee
      // Again closing depends on slab -> solve per slab
      for (let s of slabs) {
        const close = s.close;
        const Cconst = COLLECTION_CAP + close + shippingFee;
        const denom2 = 1 - multiplier * rates.commissionRate;
        if (denom2 > 0) {
          const Pcand2 = (D + multiplier * Cconst) / denom2;
          if (Pcand2 >= s.min && Pcand2 <= s.max) {
            // check cap consistency (collection raw for this P must be >= cap)
            const collRaw = rates.collectionRate * Pcand2;
            if (collRaw >= COLLECTION_CAP - 1e-6) { // allow small tolerance
              return { P: Pcand2, branch: 'capped', slab: s, note: '' };
            }
          }
        }
      }

      return { error: 'Could not find a consistent price for given desired payout. Check rates/desired payout.' };
    } else {
      // includeShipping = true -> collection = collRate * (P + shipping)
      // For uncapped: collection = collRate * P + collRate * shipping
      // FeesBeforeGst = (commission + collection) + closing + shipping = (commissionRate + collectionRate)*P + (closing + shipping + collectionRate*shipping)
      // Again closing depends on P (slab), so iterate slabs
      const slabs = [
        { min: 0.01, max: 250, close: 5 },
        { min: 250.01, max: 500, close: 10 },
        { min: 500.01, max: 1000, close: 15 },
        { min: 1000.01, max: 1e7, close: 20 }
      ];

      for (let s of slabs) {
        const close = s.close;
        const Cconst = close + shippingFee + rates.collectionRate * shippingFee; // constant term
        const denom = 1 - multiplier * (rates.commissionRate + rates.collectionRate);
        if (denom > 0) {
          const Pcand = (D + multiplier * Cconst) / denom;
          if (Pcand >= s.min && Pcand <= s.max) {
            const collRaw = rates.collectionRate * (Pcand + shippingFee);
            if (collRaw <= COLLECTION_CAP) {
              return { P: Pcand, branch: 'uncapped', slab: s, note: '' };
            }
          }
        }
      }

      // Capped branch: collection = COLLECTION_CAP constant
      for (let s of slabs) {
        const close = s.close;
        const Cconst = COLLECTION_CAP + close + shippingFee;
        const denom2 = 1 - multiplier * rates.commissionRate;
        if (denom2 > 0) {
          const Pcand2 = (D + multiplier * Cconst) / denom2;
          if (Pcand2 >= s.min && Pcand2 <= s.max) {
            // check cap consistency: collRaw >= COLLECTION_CAP
            const collRaw = rates.collectionRate * (Pcand2 + shippingFee);
            if (collRaw >= COLLECTION_CAP - 1e-6) {
              return { P: Pcand2, branch: 'capped', slab: s, note: '' };
            }
          }
        }
      }

      return { error: 'Could not find a consistent price (includeShipping mode). Check rates/desired payout.' };
    }
  }

  // Update UI given inputs
  function refresh() {
    // populate closing fee display when price known
    const Pinput = parseNum(priceInput);
    const closeAuto = closingFeeForPrice(Pinput);
    closingFeeDisplay.textContent = closeAuto ? '₹' + closeAuto : '—';

    // Item dims & weights
    const actualG = parseNum(actualWeightInput);
    const L = parseNum(lengthInput);
    const W = parseNum(widthInput);
    const H = parseNum(heightInput);

    const actualKg = isNaN(actualG) ? NaN : actualG / 1000.0;
    const volKg = (isNaN(L) || isNaN(W) || isNaN(H)) ? NaN : volumetricKg(L, W, H);
    const chargeableKg = Math.max(isNaN(actualKg) ? 0 : actualKg, isNaN(volKg) ? 0 : volKg);

    const zone = zoneSelect.value;
    const shippingFee = computeShippingFee(chargeableKg, zone);

    outChargeable.textContent = isNaN(chargeableKg) ? '-' : (Math.round(chargeableKg * 1000) / 1000) + ' kg';
    outShipping.textContent = fmt(shippingFee);

    const rates = readRates();

    const P = parseNum(priceInput);
    const D = parseNum(desiredInput);

    // If price provided -> forward calc
    if (!isNaN(P)) {
      const res = computeFromPrice(P, shippingFee, rates);
      finalPayoutEl.textContent = fmt(res.payout);
      reqPriceEl.textContent = (function () {
        const req = computeRequiredPrice(res.payout, shippingFee, rates);
        return req.error ? '-' : fmt(req.P);
      })();

      outCommission.textContent = fmt(res.comm);
      outCollection.textContent = fmt(res.coll);
      outClosing.textContent = '₹' + res.closing;
      outFeesBeforeGst.textContent = fmt(res.feesBeforeGst);
      outGst.textContent = fmt(res.gst);
      outTotalDeduct.textContent = fmt(res.totalDeduct);
      errEl.style.display = 'none';
      errEl.textContent = '';
      return;
    }

    // If desired provided -> reverse calc
    if (!isNaN(D)) {
      const req = computeRequiredPrice(D, shippingFee, rates);
      if (req.error) {
        errEl.style.display = 'block';
        errEl.textContent = req.error;
        finalPayoutEl.textContent = '-';
        reqPriceEl.textContent = '-';
        outCommission.textContent = '-';
        outCollection.textContent = '-';
        outClosing.textContent = '-';
        outFeesBeforeGst.textContent = '-';
        outGst.textContent = '-';
        outTotalDeduct.textContent = '-';
        return;
      }
      const Pcomputed = req.P;
      const res = computeFromPrice(Pcomputed, shippingFee, rates);
      finalPayoutEl.textContent = fmt(res.payout);
      reqPriceEl.textContent = fmt(Pcomputed);
      outCommission.textContent = fmt(res.comm);
      outCollection.textContent = fmt(res.coll);
      outClosing.textContent = '₹' + res.closing;
      outFeesBeforeGst.textContent = fmt(res.feesBeforeGst);
      outGst.textContent = fmt(res.gst);
      outTotalDeduct.textContent = fmt(res.totalDeduct);
      errEl.style.display = 'none';
      errEl.textContent = '';
      return;
    }

    // No inputs
    finalPayoutEl.textContent = '-';
    reqPriceEl.textContent = '-';
    outCommission.textContent = '-';
    outCollection.textContent = '-';
    outClosing.textContent = '-';
    outFeesBeforeGst.textContent = '-';
    outGst.textContent = '-';
    outTotalDeduct.textContent = '-';
    errEl.style.display = 'none';
    errEl.textContent = '';
  }

  // Events
  itemType.addEventListener('change', () => populateItemDefaults(itemType.value));
  [priceInput, desiredInput, actualWeightInput, lengthInput, widthInput, heightInput,
   zoneSelect, includeShippingCheckbox, commissionRateInput, collectionRateInput, gstRateInput].forEach(el => el.addEventListener('input', refresh));

  calcBtn.addEventListener('click', refresh);

  resetBtn.addEventListener('click', () => {
    itemType.value = 'Jar';
    populateItemDefaults('Jar');
    priceInput.value = '';
    desiredInput.value = '';
    zoneSelect.value = 'zonal';
    includeShippingCheckbox.checked = false;
    commissionRateInput.value = '12';
    collectionRateInput.value = '2';
    gstRateInput.value = '18';
    refresh();
  });

  copyBtn.addEventListener('click', () => {
    const text = `Final payout: ${finalPayoutEl.textContent} | Required price: ${reqPriceEl.textContent}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => alert('Copied: ' + text)).catch(() => alert('Copy failed'));
    } else alert(text);
  });

  // Init
  populateItemDefaults('Jar');
  refresh();
});
