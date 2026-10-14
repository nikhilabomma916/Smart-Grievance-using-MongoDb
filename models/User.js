const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    dateOfBirth: { type: Date, required: function citizenDateOfBirthRequired() { return this.role === "citizen"; } },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      unique: true,
      immutable: true
    },
    phoneCountryCode: { type: String, match: /^\+[1-9]\d{0,2}$/ },
    phoneNumber: { type: String, match: /^\d{4,14}$/ },
    country: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 100 },
    city: { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 12 },
    gender: { type: String, enum: ["Female", "Male", "Non-binary", "Prefer not to say"], default: undefined },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["citizen", "officer"], default: "citizen", immutable: true },
    department: { type: String, trim: true, maxlength: 100 },
    specialization: { type: String, trim: true, maxlength: 100 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

userSchema.virtual("age").get(function getAge() {
  if (!this.dateOfBirth) return undefined;
  const today = new Date();
  let age = today.getUTCFullYear() - this.dateOfBirth.getUTCFullYear();
  const hasHadBirthday =
    today.getUTCMonth() > this.dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === this.dateOfBirth.getUTCMonth() &&
      today.getUTCDate() >= this.dateOfBirth.getUTCDate());
  if (!hasHadBirthday) age -= 1;
  return age;
});

userSchema.pre("validate", async function validateOfficerFields() {
  if (
    this.role === "citizen" &&
    (!this.phoneCountryCode || !this.phoneNumber || !this.country || !this.state || !this.city || !this.postalCode)
  ) {
    throw new Error("Citizen accounts must include complete contact and address information.");
  }
  if (this.role === "citizen" && (this.department || this.specialization)) {
    throw new Error("Department and specialization are only permitted for officer accounts.");
  }
  if (this.role === "officer" && !this.department) {
    throw new Error("Officer accounts must have a department.");
  }
});

userSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
