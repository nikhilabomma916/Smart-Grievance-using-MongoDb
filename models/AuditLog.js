const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: String, required: true, maxlength: 254 },
    actorName: { type: String, required: true, maxlength: 100 },
    actorEmail: { type: String, required: true, maxlength: 254 },
    action: { type: String, required: true, maxlength: 80, index: true },
    targetType: { type: String, required: true, enum: ["department", "officer", "grievance", "account"] },
    targetId: { type: String, required: true, maxlength: 100, index: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
