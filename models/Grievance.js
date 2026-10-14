const mongoose = require("mongoose");

const grievanceSchema = new mongoose.Schema(
  {
    complaintId: {
      type: String,
      required: true,
      unique: true,
      immutable: true
    },
    citizenId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    citizenName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    category: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    location: { type: String, required: true, trim: true, maxlength: 300 },
    generatedDescription: { type: String, trim: true, maxlength: 5000 },
    address: {
      street: { type: String, trim: true, maxlength: 160 },
      locality: { type: String, trim: true, maxlength: 120 },
      city: { type: String, trim: true, maxlength: 100 },
      state: { type: String, trim: true, maxlength: 100 },
      postalCode: { type: String, trim: true, maxlength: 12 },
      landmark: { type: String, trim: true, maxlength: 160 }
    },
    coordinates: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 }
    },
    images: [{
      imageId: { type: String, required: true },
      storagePath: { type: String, required: true },
      mimetype: { type: String, enum: ["image/jpeg", "image/png", "image/webp"], required: true },
      size: { type: Number, required: true, max: 5 * 1024 * 1024 },
      uploadedAt: { type: Date, default: Date.now }
    }],
    department: { type: String, default: "Unassigned", trim: true },
    assignedOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    assignedOfficerName: { type: String, trim: true, maxlength: 100 },
    officerRemarks: { type: String, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ["Pending", "Assigned", "In Progress", "Resolved", "Rejected"],
      default: "Pending"
    }
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Grievance || mongoose.model("Grievance", grievanceSchema);
