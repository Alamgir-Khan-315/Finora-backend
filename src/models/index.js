import mongoose from "mongoose";

// Sales == invoices. Every sale has an invoice number stored in `reference`.
const saleSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    customer: { type: String, required: true, trim: true },
    customerEmail: { type: String, default: "", trim: true },
    service: { type: String, required: true, trim: true },
    date: { type: Date, default: Date.now },
    dueDate: { type: Date },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["Paid", "Pending", "Overdue", "Cancelled"], default: "Pending", index: true },
    method: { type: String, default: "Not recorded" },
    currency: { type: String, default: "PKR" },
    notes: { type: String, default: "" }
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret.reference || String(ret._id);
        delete ret._id;
        delete ret.reference;
      }
    }
  }
);

export const Sale = mongoose.model("Sale", saleSchema);
