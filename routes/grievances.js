const { randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const sharp = require("sharp");
const Grievance = require("../models/Grievance");
const GrievanceHistory = require("../models/GrievanceHistory");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");
const { canAccessGrievance, isAuthorizedDepartment, officerGrievanceScope } = require("../middleware/grievanceAccess");
const { createRateLimit } = require("../middleware/rateLimit");
const { suggestDescription } = require("../services/descriptionSuggestion");

const router = express.Router();
const complaintIdPattern = /^GRV-[A-F0-9]{16}$/;
const statuses = new Set(["Pending", "Assigned", "In Progress", "Resolved", "Rejected"]);
const officerTransitions = new Map([
  ["Pending", new Set(["Assigned", "In Progress"])],
  ["Assigned", new Set(["In Progress", "Resolved"])],
  ["In Progress", new Set(["Resolved"])]
]);
const assignableDepartments = new Set([
  "Roads Department",
  "Water Department",
  "Drainage Department",
  "Sanitation Department",
  "Electricity Department",
  "Forestry Department",
  "General Grievance Queue",
  "Roads and Public Works",
  "Water Supply",
  "Electricity",
  "Public Safety",
  "General Administration"
]);
const submissionLimit = createRateLimit({
  limit: 10,
  windowMs: 15 * 60 * 1000,
  message: "Too many submissions from this connection. Please try again later."
});
const suggestionLimit = createRateLimit({
  limit: 10,
  windowMs: 15 * 60 * 1000,
  message: "Too many description requests. Please try again later."
});
const reverseGeocodeLimit = createRateLimit({
  limit: 15,
  windowMs: 15 * 60 * 1000,
  message: "Too many location lookups. Please try again later."
});
const uploadsDirectory = path.resolve(__dirname, "..", "uploads");
const grievanceImagesDirectory = path.join(uploadsDirectory, "grievances");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 20, parts: 24 }
});

const categoryDepartments = new Map([
  ["Pothole or damaged road", "Roads Department"],
  ["Water leakage or water supply problem", "Water Department"],
  ["Drainage blockage or overflow", "Drainage Department"],
  ["Garbage overflow or sanitation issue", "Sanitation Department"],
  ["Electricity pole, streetlight or power-related issue", "Electricity Department"],
  ["Fallen tree or dangerous branches", "Forestry Department"],
  ["Other civic issue", "General Grievance Queue"],
  ["Roads and Potholes", "Roads Department"],
  ["Garbage and Sanitation", "Sanitation Department"],
  ["Water Supply", "Water Department"],
  ["Electricity and Streetlights", "Electricity Department"],
  ["Drainage", "Drainage Department"],
  ["Public Safety", "General Grievance Queue"],
  ["Other", "General Grievance Queue"]
]);

function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function identifyImage(buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return { extension: ".png", mimetype: "image/png", format: "png" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: ".jpg", mimetype: "image/jpeg", format: "jpeg" };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) return { extension: ".webp", mimetype: "image/webp", format: "webp" };
  return null;
}

async function sanitizeImage(buffer, format) {
  let image = sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 }).rotate();
  if (format === "jpeg") image = image.jpeg({ quality: 85 });
  else if (format === "png") image = image.png({ compressionLevel: 8 });
  else image = image.webp({ quality: 85 });
  return image.toBuffer();
}

async function assignOfficer(department) {
  const candidates = await User.find({ role: "officer", department, isActive: true })
    .select("_id name")
    .sort({ _id: 1 })
    .lean();
  let selected = null;
  let smallestQueue = Number.POSITIVE_INFINITY;
  for (const officer of candidates) {
    const activeCount = await Grievance.countDocuments({
      assignedOfficerId: officer._id,
      status: { $in: ["Assigned", "In Progress"] }
    });
    if (activeCount < smallestQueue) {
      selected = officer;
      smallestQueue = activeCount;
    }
  }
  return selected;
}

async function historyFor(grievances) {
  if (!grievances.length) return new Map();
  const rows = await GrievanceHistory.find({
    grievanceId: { $in: grievances.map((item) => item._id) }
  }).sort({ createdAt: 1 }).lean();
  const result = new Map();
  for (const row of rows) {
    const key = row.grievanceId.toString();
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
}

function serializeGrievance(item, history = []) {
  const grievance = typeof item.toObject === "function" ? item.toObject() : item;
  return {
    ...grievance,
    images: (grievance.images || []).map(({ imageId, mimetype, size, uploadedAt }) => ({
      imageId,
      mimetype,
      size,
      uploadedAt,
      url: `/api/grievances/${encodeURIComponent(grievance.complaintId)}/images/${encodeURIComponent(imageId)}`
    })),
    history
  };
}

async function findGrievanceForSession(req) {
  const identifier = cleanString(req.params.id || req.params.complaintId || req.query.complaintId).toUpperCase();
  if (complaintIdPattern.test(identifier)) return Grievance.findOne({ complaintId: identifier });
  if (mongoose.isValidObjectId(identifier)) return Grievance.findById(identifier);
  return null;
}

async function trackGrievance(req, res, next) {
  const complaintId = cleanString(req.params.complaintId || req.query.complaintId).toUpperCase();
  if (!complaintIdPattern.test(complaintId)) return sendError(res, 400, "A valid complaint ID is required.");
  try {
    const grievance = await Grievance.findOne({ complaintId }).select(
      "complaintId title category location department status createdAt updatedAt"
    );
    if (!grievance) return sendError(res, 404, "No grievance was found for that complaint ID.");
    return res.json({ success: true, data: grievance });
  } catch (error) {
    return next(error);
  }
}

router.post("/", requireRole("citizen"), submissionLimit, upload.array("images", 3), async (req, res, next) => {
  const body = req.body || {};
  const name = cleanString(body.title);
  const description = cleanString(body.description);
  const category = cleanString(body.category);
  const generatedDescription = cleanString(body.generatedDescription);
  const department = categoryDepartments.get(category);
  const address = {
    street: cleanString(body.street),
    locality: cleanString(body.locality),
    city: cleanString(body.city),
    state: cleanString(body.state),
    postalCode: cleanString(body.postalCode).toUpperCase(),
    landmark: cleanString(body.landmark)
  };
  const addressText = [address.street, address.locality, address.city, address.state, address.postalCode]
    .filter(Boolean).join(", ");
  const location = addressText.length <= 300 ? addressText : "";
  const errors = {};

  if (!department) errors.category = "Select a valid grievance category.";
  if (name.length < 5 || name.length > 120) errors.title = "Title must be between 5 and 120 characters.";
  if (description.length < 10 || description.length > 5000) errors.description = "Description must be between 10 and 5000 characters.";
  if (
    generatedDescription &&
    (!req.session.generatedDescription ||
      req.session.generatedDescription.text !== generatedDescription ||
      req.session.generatedDescription.category !== category ||
      Date.now() - req.session.generatedDescription.createdAt > 30 * 60 * 1000)
  ) {
    errors.generatedDescription = "Generate the suggestion again before submitting.";
  }
  if (!address.street || address.street.length > 160) errors.street = "Enter the street or road name (up to 160 characters).";
  if (!address.locality || address.locality.length > 120) errors.locality = "Enter the area or locality (up to 120 characters).";
  if (!address.city || address.city.length > 100) errors.city = "Enter a valid city.";
  if (!address.state || address.state.length > 100) errors.state = "Enter a valid state.";
  if (!/^\d{6}$/.test(address.postalCode)) errors.postalCode = "Enter a six-digit PIN code.";
  if (!address.landmark || address.landmark.length > 160) {
    errors.landmark = "Enter a nearby landmark (up to 160 characters).";
  }
  if (!location) errors.location = "The address is too long; shorten its fields and try again.";

  const rawLatitude = cleanString(body.latitude);
  const rawLongitude = cleanString(body.longitude);
  let coordinates;
  if (rawLatitude || rawLongitude) {
    const latitude = Number(rawLatitude);
    const longitude = Number(rawLongitude);
    if (
      !rawLatitude || !rawLongitude ||
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) {
      errors.location = "Location coordinates must include valid latitude and longitude values.";
    } else {
      coordinates = { latitude, longitude };
    }
  }
  const safeUploads = [];
  for (const file of req.files || []) {
    const detected = identifyImage(file.buffer);
    if (!detected) errors.images = "Each upload must contain a valid JPG, PNG, or WEBP image.";
    else {
      try {
        const sanitizedBuffer = await sanitizeImage(file.buffer, detected.format);
        if (sanitizedBuffer.length > 5 * 1024 * 1024) {
          errors.images = "Each processed image must be 5 MB or smaller.";
        } else {
          safeUploads.push({
            buffer: sanitizedBuffer,
            ...detected,
            imageId: randomBytes(12).toString("hex")
          });
        }
      } catch {
        errors.images = "Each upload must be a decodable JPG, PNG, or WEBP image.";
      }
    }
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ success: false, error: "Please correct the highlighted fields.", errors });
  }

  let createdGrievance;
  const storedPaths = [];
  try {
    const citizen = await User.findById(req.auth.userId)
      .select("name email phoneCountryCode phoneNumber isActive role");
    if (!citizen || citizen.role !== "citizen" || !citizen.isActive) {
      return sendError(res, 401, "Your citizen account is no longer available. Please sign in again.");
    }

    const assignedOfficer = await assignOfficer(department);
    const status = assignedOfficer ? "Assigned" : "Pending";
    await fs.mkdir(grievanceImagesDirectory, { recursive: true });
    const imageMetadata = [];
    for (const item of safeUploads) {
      const filename = `${randomBytes(24).toString("hex")}${item.extension}`;
      const absolutePath = path.join(grievanceImagesDirectory, filename);
      await fs.writeFile(absolutePath, item.buffer, { flag: "wx" });
      const storagePath = path.relative(uploadsDirectory, absolutePath);
      storedPaths.push(absolutePath);
      imageMetadata.push({
        imageId: item.imageId,
        storagePath,
        mimetype: item.mimetype,
        size: item.buffer.length
      });
    }

    createdGrievance = await Grievance.create({
      complaintId: `GRV-${randomBytes(8).toString("hex").toUpperCase()}`,
      citizenId: citizen._id,
      citizenName: citizen.name,
      email: citizen.email,
      phone: `${citizen.phoneCountryCode} ${citizen.phoneNumber}`,
      category,
      title: name,
      description,
      ...(generatedDescription ? { generatedDescription } : {}),
      location,
      address,
      ...(coordinates ? { coordinates } : {}),
      images: imageMetadata,
      department,
      ...(assignedOfficer ? {
        assignedOfficerId: assignedOfficer._id,
        assignedOfficerName: assignedOfficer.name
      } : {}),
      status
    });
    await GrievanceHistory.create({
      grievanceId: createdGrievance._id,
      complaintId: createdGrievance.complaintId,
      previousStatus: null,
      newStatus: status,
      updatedBy: citizen._id,
      updaterName: citizen.name,
      remarks: "Grievance submitted."
    });
    delete req.session.generatedDescription;
    return res.status(201).json({
      success: true,
      message: "Your grievance was submitted.",
      data: serializeGrievance(createdGrievance)
    });
  } catch (error) {
    await Promise.all(storedPaths.map((filePath) => fs.unlink(filePath).catch(() => {})));
    if (createdGrievance) {
      await GrievanceHistory.deleteMany({ grievanceId: createdGrievance._id }).catch(() => {});
      await Grievance.deleteOne({ _id: createdGrievance._id }).catch(() => {});
    }
    if (error.code === 11000) return sendError(res, 409, "Could not create a unique complaint ID. Please retry.");
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, error: "The grievance data is invalid." });
    }
    return next(error);
  }
});

router.post("/description-suggestion", requireRole("citizen"), suggestionLimit, async (req, res, next) => {
  const notes = cleanString(req.body && req.body.notes);
  const category = cleanString(req.body && req.body.category);
  if (!categoryDepartments.has(category)) return sendError(res, 400, "Select a valid grievance category.");
  if (notes.length < 3 || notes.length > 1000) return sendError(res, 400, "Enter 3–1000 characters of issue keywords.");
  try {
    const result = await suggestDescription({ category, notes });
    req.session.generatedDescription = {
      text: result.description,
      category,
      createdAt: Date.now()
    };
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post("/reverse-geocode", requireRole("citizen"), reverseGeocodeLimit, async (req, res, next) => {
  const latitude = Number(req.body && req.body.latitude);
  const longitude = Number(req.body && req.body.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return sendError(res, 400, "Valid latitude and longitude coordinates are required.");
  }
  if (!process.env.REVERSE_GEOCODE_URL) {
    return res.json({ success: true, data: { configured: false, address: null } });
  }
  try {
    const endpoint = new URL(process.env.REVERSE_GEOCODE_URL);
    endpoint.searchParams.set("lat", String(latitude));
    endpoint.searchParams.set("lon", String(longitude));
    endpoint.searchParams.set("format", "jsonv2");
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Reverse-geocoding provider returned HTTP ${response.status}.`);
    const result = await response.json();
    const parts = result.address || {};
    return res.json({
      success: true,
      data: {
        configured: true,
        address: {
          street: parts.road || parts.pedestrian || "",
          locality: parts.suburb || parts.neighbourhood || parts.village || "",
          city: parts.city || parts.town || parts.village || "",
          state: parts.state || "",
          postalCode: parts.postcode || "",
          landmark: ""
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/track", trackGrievance);
router.get("/track/:complaintId", trackGrievance);

router.get("/my", requireRole("citizen"), async (req, res, next) => {
  try {
    const records = await Grievance.find({ citizenId: req.auth.userId }).sort({ createdAt: -1 }).limit(100).lean();
    const history = await historyFor(records);
    return res.json({ success: true, data: records.map((record) =>
      serializeGrievance(record, history.get(record._id.toString()) || [])
    ) });
  } catch (error) {
    return next(error);
  }
});

router.get("/", requireRole("officer"), async (req, res, next) => {
  try {
    const records = await Grievance.find(officerGrievanceScope(req.auth)).sort({ createdAt: -1 }).limit(500).lean();
    const history = await historyFor(records);
    return res.json({ success: true, data: records.map((record) =>
      serializeGrievance(record, history.get(record._id.toString()) || [])
    ) });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const grievance = await findGrievanceForSession(req);
    if (!grievance || !canAccessGrievance(req.auth, grievance)) {
      return sendError(res, 404, "Grievance was not found.");
    }
    const history = await GrievanceHistory.find({ grievanceId: grievance._id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, data: serializeGrievance(grievance, history) });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/images/:imageId", requireAuth, async (req, res, next) => {
  try {
    const grievance = await findGrievanceForSession(req);
    if (!grievance || !canAccessGrievance(req.auth, grievance)) return sendError(res, 404, "Image was not found.");
    const image = grievance.images.find((item) => item.imageId === req.params.imageId);
    if (!image) return sendError(res, 404, "Image was not found.");
    const absolutePath = path.resolve(uploadsDirectory, image.storagePath);
    if (!absolutePath.startsWith(`${uploadsDirectory}${path.sep}`)) {
      return sendError(res, 404, "Image was not found.");
    }
    return res.sendFile(absolutePath, { headers: { "Content-Type": image.mimetype, "X-Content-Type-Options": "nosniff" } }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id/status", requireRole("officer"), async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 400, "A valid grievance record ID is required.");
  const status = cleanString(req.body && req.body.status);
  const remarks = cleanString(req.body && req.body.remarks);
  if (!statuses.has(status)) return sendError(res, 400, "Select a valid grievance status.");
  if (remarks.length > 2000) return sendError(res, 400, "Remarks must be no more than 2000 characters.");
  try {
    const grievance = await Grievance.findOne({
      _id: req.params.id,
      ...officerGrievanceScope(req.auth)
    });
    if (!grievance) return sendError(res, 404, "Grievance was not found in your authorized department.");
    const previousStatus = grievance.status;
    if (previousStatus === status) return res.json({ success: true, data: serializeGrievance(grievance) });
    if (previousStatus === status) return res.json({ success: true, data: serializeGrievance(grievance) });
    if (previousStatus === "Resolved" || previousStatus === "Rejected") {
      return sendError(res, 409, "A closed grievance cannot be reopened through this action.");
    }
    if (!officerTransitions.get(previousStatus)?.has(status)) {
      return sendError(res, 409, `Status cannot change from ${previousStatus} to ${status}.`);
    }
    if (status === "Resolved" && !remarks) {
      return sendError(res, 400, "Add resolution remarks before marking this grievance resolved.");
    }
    grievance.status = status;
    grievance.officerRemarks = remarks || grievance.officerRemarks;
    grievance.assignedOfficerId = req.auth.userId || grievance.assignedOfficerId;
    grievance.assignedOfficerName = req.auth.name || grievance.assignedOfficerName;
    await grievance.save();
    await GrievanceHistory.create({
      grievanceId: grievance._id,
      complaintId: grievance.complaintId,
      previousStatus,
      newStatus: status,
      updatedBy: mongoose.isValidObjectId(req.auth.userId) ? req.auth.userId : null,
      updaterName: req.auth.name || req.auth.email,
      remarks
    });
    return res.json({ success: true, data: serializeGrievance(grievance) });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id/assign", requireRole("officer"), async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 400, "A valid grievance record ID is required.");
  const department = cleanString(req.body && req.body.department);
  if (!assignableDepartments.has(department)) return sendError(res, 400, "Select a valid department.");
  if (!isAuthorizedDepartment(req.auth, department)) {
    return sendError(res, 403, "Officers cannot move grievances to another department.");
  }
  try {
    const grievance = await Grievance.findOne({ _id: req.params.id, ...officerGrievanceScope(req.auth) });
    if (!grievance) return sendError(res, 404, "Grievance was not found in your authorized department.");
    const previousStatus = grievance.status;
    grievance.department = department;
    if (grievance.status === "Pending") grievance.status = "Assigned";
    await grievance.save();
    if (previousStatus !== grievance.status) {
      await GrievanceHistory.create({
        grievanceId: grievance._id,
        complaintId: grievance.complaintId,
        previousStatus,
        newStatus: grievance.status,
        updatedBy: mongoose.isValidObjectId(req.auth.userId) ? req.auth.userId : null,
        updaterName: req.auth.name || req.auth.email,
        remarks: `Department assigned to ${department}.`
      });
    }
    return res.json({ success: true, data: grievance });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
