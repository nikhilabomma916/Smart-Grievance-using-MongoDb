const mongoose = require("mongoose");

const grievanceHistorySchema = new mongoose.Schema(
  {
    grievanceId: { type: mongoose.Schema.Types.ObjectId, ref: "Grievance", required: true, index: true },
    complaintId: { type: String, required: true, index: true },
    previousStatus: { type: String, default: null },
    newStatus: {
      type: String,
      enum: ["Pending", "Assigned", "In Progress", "Resolved", "Rejected"],
      required: true
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updaterName: { type: String, required: true, maxlength: 100 },
    remarks: { type: String, trim: true, maxlength: 2000 }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

grievanceHistorySchema.index({ grievanceId:  1, createdAt: 1 });

module.exports =
  mongoose.models.GrievanceHistory ||
  mongoose.model("GrievanceHistory", grievanceHistorySchema);
