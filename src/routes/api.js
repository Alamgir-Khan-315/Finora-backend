import { Router } from "express";
import { Sale } from "../models/index.js";

const router = Router();
const STATUSES = ["Paid", "Pending", "Overdue", "Cancelled"];
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = value => String(value ?? "").trim();
const toDate = value => {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// Next invoice number: INV-1001, INV-1002, ...
async function nextInvoiceNumber() {
  const last = await Sale.findOne({ reference: /^INV-\d{4,6}$/ }).sort({ reference: -1 }).select("reference").lean();
  const n = last ? Number(last.reference.slice(4)) + 1 : 1001;
  return `INV-${n}`;
}

// Builds a clean sale document from request data. Returns { doc } or { error }.
function buildSale(input, { partial = false } = {}) {
  const doc = {};
  const has = key => input[key] !== undefined;

  if (!partial || has("customer")) doc.customer = clean(input.customer ?? input.customerName);
  if (!partial || has("service")) doc.service = clean(input.service ?? input.itemName);
  if (!partial || has("amount")) doc.amount = Number(input.amount ?? input.total);
  if (has("customerEmail")) doc.customerEmail = clean(input.customerEmail);
  if (has("date")) doc.date = toDate(input.date) || new Date();
  if (has("dueDate")) doc.dueDate = toDate(input.dueDate) || null;
  if (has("status")) {
    if (!STATUSES.includes(input.status)) return { error: "Status must be Paid, Pending, Overdue or Cancelled." };
    doc.status = input.status;
  }
  if (has("method") || has("paymentMethod")) doc.method = clean(input.method ?? input.paymentMethod) || "Not recorded";
  if (has("currency")) doc.currency = clean(input.currency) || "PKR";
  if (has("notes")) doc.notes = clean(input.notes);

  if (!partial || has("customer") || has("customerName")) {
    if (!doc.customer) return { error: "Customer name is required." };
  }
  if (!partial || has("service") || has("itemName")) {
    if (!doc.service) return { error: "Service is required." };
  }
  if (!partial || has("amount") || has("total")) {
    if (!Number.isFinite(doc.amount) || doc.amount < 0) return { error: "Amount must be a number, zero or more." };
  }
  return { doc };
}

router.get("/health", (req, res) =>
  res.json({ ok: true, database: req.app.locals.dbReady ? "connected" : "disconnected", service: "Finora API" })
);

// List all sales (newest first)
router.get("/sales", asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 1000, 5000);
  const docs = await Sale.find().sort({ date: -1, createdAt: -1 }).limit(limit);
  res.json(docs.map(d => d.toJSON()));
}));

// Create a sale / invoice
router.post("/sales", asyncRoute(async (req, res) => {
  const { doc, error } = buildSale(req.body || {});
  if (error) return res.status(400).json({ message: error });
  if (!doc.date) doc.date = new Date();

  // Retry once if two invoices are created at the same moment and get the same number.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const sale = await Sale.create({ ...doc, reference: clean(req.body.reference) || (await nextInvoiceNumber()) });
      return res.status(201).json(sale.toJSON());
    } catch (err) {
      if (err.code !== 11000 || req.body.reference) throw err;
    }
  }
  res.status(409).json({ message: "Could not generate a unique invoice number. Please try again." });
}));

// Update a sale (e.g. mark as paid) — :id is the invoice number
router.patch("/sales/:id", asyncRoute(async (req, res) => {
  const { doc, error } = buildSale(req.body || {}, { partial: true });
  if (error) return res.status(400).json({ message: error });
  const sale = await Sale.findOneAndUpdate({ reference: req.params.id }, { $set: doc }, { new: true, runValidators: true });
  if (!sale) return res.status(404).json({ message: "Invoice not found." });
  res.json(sale.toJSON());
}));

router.delete("/sales/:id", asyncRoute(async (req, res) => {
  const sale = await Sale.findOneAndDelete({ reference: req.params.id });
  if (!sale) return res.status(404).json({ message: "Invoice not found." });
  res.json({ deleted: req.params.id });
}));

// Service-provider webhook: POST /api/integrations/sales with the x-sync-key header.
router.post("/integrations/sales", asyncRoute(async (req, res) => {
  const expected = process.env.SYNC_API_KEY;
  if (!expected || req.get("x-sync-key") !== expected) return res.status(401).json({ message: "Invalid sync key." });
  const incoming = Array.isArray(req.body) ? req.body : [req.body];
  const saved = [];
  for (const item of incoming) {
    const { doc, error } = buildSale(item || {});
    if (error) return res.status(400).json({ message: error, received: saved.length });
    const reference = clean(item.reference) || (await nextInvoiceNumber());
    saved.push(await Sale.create({ ...doc, reference }));
  }
  res.status(201).json({ received: saved.length, records: saved.map(x => x.toJSON()) });
}));

export default router;
