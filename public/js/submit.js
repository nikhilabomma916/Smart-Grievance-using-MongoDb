const form = document.getElementById("grievance-form");
const formMessage = document.getElementById("form-message");
const submitButton = document.getElementById("submit-button");
const successPanel = document.getElementById("success-panel");
const imageInput = document.getElementById("images");
const previewContainer = document.getElementById("image-previews");
const selectedImages = [];
let previewUrls = [];

function showMessage(message, kind = "danger") {
  formMessage.className = `alert alert-${kind}`;
  formMessage.textContent = message;
}

function clearMessage() {
  formMessage.className = "alert d-none";
  formMessage.textContent = "";
}

function clearPreviews() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  previewContainer.replaceChildren();
}

function renderPreviews() {
  clearPreviews();
  selectedImages.forEach((file, index) => {
    const column = document.createElement("div");
    column.className = "col-6 col-md-4";
    const card = document.createElement("div");
    card.className = "image-preview-card";
    const image = document.createElement("img");
    image.alt = `Selected grievance image ${index + 1}: ${file.name}`;
    const previewUrl = URL.createObjectURL(file);
    previewUrls.push(previewUrl);
    image.src = previewUrl;
    const name = document.createElement("span");
    name.className = "d-block small text-truncate";
    name.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-sm btn-outline-danger mt-2";
    remove.textContent = "Remove image";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.addEventListener("click", () => {
      selectedImages.splice(index, 1);
      const remainingFiles = new DataTransfer();
      selectedImages.forEach((selectedFile) => remainingFiles.items.add(selectedFile));
      imageInput.files = remainingFiles.files;
      validateSelectedImages();
      renderPreviews();
    });
    card.append(image, name, remove);
    column.append(card);
    previewContainer.append(column);
  });
}

function validateSelectedImages() {
  imageInput.setCustomValidity("");
  if (selectedImages.length > 3) imageInput.setCustomValidity("Choose no more than three images.");
  else if (selectedImages.some((file) => file.size > 5 * 1024 * 1024)) {
    imageInput.setCustomValidity("Each image must be 5 MB or smaller.");
  } else if (selectedImages.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
    imageInput.setCustomValidity("Choose JPG, PNG, or WEBP images.");
  }
}

function setFieldErrors(errors = {}) {
  for (const [fieldName, message] of Object.entries(errors)) {
    const field = form.elements.namedItem(fieldName);
    if (field && "setCustomValidity" in field) field.setCustomValidity(message);
  }
}

form.addEventListener("input", (event) => {
  if (event.target && typeof event.target.setCustomValidity === "function") {
    event.target.setCustomValidity("");
  }
});

document.getElementById("category").addEventListener("change", () => {
  const generated = document.getElementById("generated-description-value");
  const description = document.getElementById("description");
  if (generated.value && generated.value === description.value) description.value = "";
  generated.value = "";
  document.getElementById("description-helper-message").textContent =
    "Category changed. Generate a new suggestion if you still want assistance.";
});

imageInput.addEventListener("change", () => {
  selectedImages.splice(0, selectedImages.length, ...Array.from(imageInput.files || []));
  validateSelectedImages();
  renderPreviews();
});

document.getElementById("generate-description").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const notesField = document.getElementById("description-notes");
  const notes = notesField.value.trim() || document.getElementById("description").value.trim();
  const category = document.getElementById("category").value;
  const helperMessage = document.getElementById("description-helper-message");
  if (!category) {
    helperMessage.textContent = "Choose a category before generating a suggestion.";
    return;
  }
  if (notes.length < 3) {
    helperMessage.textContent = "Enter a few observed facts. The template helper does not inspect uploaded images.";
    notesField.focus();
    return;
  }
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    const response = await fetch("/api/grievances/description-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, notes })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "Could not prepare a suggestion.");
    document.getElementById("description").value = result.data.description;
    document.getElementById("description").setCustomValidity("");
    document.getElementById("generated-description-value").value = result.data.description;
    helperMessage.textContent = result.data.provider === "configured"
      ? "Suggestion from the configured text provider. Review and edit it before submitting."
      : "Template suggestion (no AI image analysis). Review and edit it before submitting.";
  } catch (error) {
    helperMessage.textContent = error.message || "Could not prepare a suggestion.";
  } finally {
    button.disabled = false;
    button.textContent = "Generate Description";
  }
});

document.getElementById("use-location").addEventListener("click", () => {
  const button = document.getElementById("use-location");
  const message = document.getElementById("location-message");
  if (!navigator.geolocation) {
    message.textContent = "This browser does not provide location access. Enter the address manually.";
    return;
  }
  button.disabled = true;
  message.textContent = "Waiting for your location permission…";
  navigator.geolocation.getCurrentPosition(async (position) => {
    const { latitude, longitude } = position.coords;
    document.getElementById("latitude").value = String(latitude);
    document.getElementById("longitude").value = String(longitude);
    message.textContent = "Coordinates captured with your permission. Looking for an optional address suggestion…";
    try {
      const response = await fetch("/api/grievances/reverse-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Address lookup failed.");
      if (result.data.configured && result.data.address) {
        for (const [key, value] of Object.entries(result.data.address)) {
          const field = form.elements.namedItem(key);
          if (field && !field.value.trim() && value) field.value = value;
        }
        message.textContent = "Address suggestions added where fields were blank. Review and correct them before submitting.";
      } else {
        message.textContent = "Coordinates captured. No reverse-geocoding provider is configured; enter the address manually.";
      }
    } catch (error) {
      message.textContent = `${error.message} Enter or review the address manually.`;
    } finally {
      button.disabled = false;
    }
  }, (error) => {
    const reason = error.code === error.PERMISSION_DENIED
      ? "Location permission was denied."
      : error.code === error.POSITION_UNAVAILABLE
        ? "Your current location is unavailable."
        : "Location request timed out.";
    message.textContent = `${reason} Enter the address manually.`;
    button.disabled = false;
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();
  for (const field of form.elements) {
    if (field.name && field.type !== "file" && typeof field.value === "string") {
      field.value = field.value.trim();
    }
  }
  if (!form.checkValidity()) {
    form.classList.add("was-validated");
    form.querySelector(":invalid")?.focus();
    return;
  }

  const payload = new FormData(form);
  payload.delete("images");
  selectedImages.forEach((file) => payload.append("images", file, file.name));
  submitButton.disabled = true;
  submitButton.textContent = "Submitting…";
  try {
    const response = await fetch("/api/grievances", { method: "POST", body: payload });
    const result = await response.json();
    if (!response.ok || !result.success) {
      setFieldErrors(result.errors);
      throw new Error(result.error || "Submission failed.");
    }
    const complaintId = result.data.complaintId;
    document.getElementById("new-complaint-id").textContent = complaintId;
    document.getElementById("track-new-link").href = "/citizen-dashboard.html";
    form.classList.add("d-none");
    successPanel.classList.remove("d-none");
  } catch (error) {
    showMessage(error.message || "Unable to submit your grievance. Please try again.");
    form.querySelector(":invalid")?.focus();
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit grievance";
  }
});

document.getElementById("submit-another").addEventListener("click", () => {
  form.reset();
  selectedImages.length = 0;
  clearPreviews();
  form.classList.remove("d-none", "was-validated");
  successPanel.classList.add("d-none");
  clearMessage();
  document.getElementById("description-helper-message").textContent =
    "The template helper uses only the words you provide and does not inspect uploaded images. A configured text provider is optional.";
  document.getElementById("generated-description-value").value = "";
  document.getElementById("location-message").textContent = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
});

fetch("/api/auth/me")
  .then(async (response) => {
    const result = await response.json();
    if (!response.ok || !result.success || result.data.role !== "citizen") {
      window.location.replace("/login.html");
      return;
    }
    document.getElementById("signed-in-name").textContent = result.data.name;
  })
  .catch(() => window.location.replace("/login.html"));
