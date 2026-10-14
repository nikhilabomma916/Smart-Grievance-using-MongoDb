const registerForm = document.getElementById("register-form");
const registerMessage = document.getElementById("register-message");
const registerButton = document.getElementById("register-button");
const dateOfBirthInput = document.getElementById("dateOfBirth");
const ageInput = document.getElementById("age");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");
let minimumAge = 18;

function showRegisterMessage(message, kind = "danger") {
  registerMessage.className = `alert alert-${kind}`;
  registerMessage.textContent = message;
}

function hideRegisterMessage() {
  registerMessage.className = "alert d-none";
  registerMessage.textContent = "";
}

function setFieldFeedback(fieldName, text) {
  const field = registerForm.elements.namedItem(fieldName);
  const feedback = registerForm.querySelector(`[data-error="${fieldName}"]`);
  if (field instanceof HTMLElement) field.classList.add("is-invalid");
  if (feedback) {
    feedback.textContent = text;
    feedback.classList.add("d-block");
  }
}

function calculateAge(dateValue) {
  if (!dateValue) return "";
  const [year, month, day] = dateValue.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) {
    age -= 1;
  }
  return age >= 0 ? String(age) : "";
}

function updateAgeLimit() {
  const today = new Date();
  const maximumDate = new Date(today.getFullYear() - minimumAge, today.getMonth(), today.getDate());
  dateOfBirthInput.max = [
    maximumDate.getFullYear(),
    String(maximumDate.getMonth() + 1).padStart(2, "0"),
    String(maximumDate.getDate()).padStart(2, "0")
  ].join("-");
  document.getElementById("age-hint").textContent = `Minimum registration age: ${minimumAge}`;
}

async function loadRegistrationConfig() {
  const response = await fetch("/api/auth/registration-config");
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error || "Registration requirements could not be loaded.");
  }
  minimumAge = result.data.minimumAge;
  updateAgeLimit();
}

dateOfBirthInput.addEventListener("input", () => {
  ageInput.value = calculateAge(dateOfBirthInput.value);
  dateOfBirthInput.setCustomValidity(
    dateOfBirthInput.value && Number(ageInput.value) < minimumAge
      ? `You must be at least ${minimumAge} years old to register.`
      : ""
  );
});

for (const toggle of document.querySelectorAll("[data-toggle-password]")) {
  toggle.addEventListener("click", () => {
    const input = document.getElementById(toggle.dataset.togglePassword);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? "Hide" : "Show";
    toggle.setAttribute("aria-label", `${show ? "Hide" : "Show"} ${input.id === "password" ? "password" : "confirmation password"}`);
    toggle.setAttribute("aria-pressed", String(show));
  });
}

registerForm.addEventListener("input", (event) => {
  if (event.target.name) {
    event.target.setCustomValidity("");
    event.target.classList.remove("is-invalid");
    registerForm.querySelector(`[data-error="${event.target.name}"]`)?.classList.remove("d-block");
  }
  if (event.target === passwordInput || event.target === confirmPasswordInput) {
    passwordInput.setCustomValidity(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,128}$/.test(passwordInput.value)
        ? ""
        : "Use 10–128 characters with an uppercase letter, lowercase letter, number, and symbol."
    );
    confirmPasswordInput.setCustomValidity(
      confirmPasswordInput.value && confirmPasswordInput.value !== passwordInput.value
        ? "Passwords do not match."
        : ""
    );
    if (!passwordInput.validity.valid && event.target === confirmPasswordInput) {
      setFieldFeedback("password", passwordInput.validationMessage);
    }
    if (!confirmPasswordInput.validity.valid) {
      setFieldFeedback("confirmPassword", confirmPasswordInput.validationMessage);
    }
    if (confirmPasswordInput.validity.valid) {
      confirmPasswordInput.classList.remove("is-invalid");
      registerForm.querySelector('[data-error="confirmPassword"]')?.classList.remove("d-block");
    }
  }
});

registerForm.elements.acceptTerms.addEventListener("change", () => {
  registerForm.querySelector('[data-error="acceptTerms"]')?.classList.remove("d-block");
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideRegisterMessage();
  for (const field of registerForm.elements) {
    if (field.name && typeof field.value === "string" && field.type !== "password") {
      field.value = field.value.trim();
    }
  }

  const phoneDigits = registerForm.elements.phoneNumber.value.replace(/\D/g, "").replace(/^0+/, "");
  const countryCode = registerForm.elements.phoneCountryCode.value.trim();
  const totalDigits = countryCode.replace(/\D/g, "").length + phoneDigits.length;
  if (!/^\+[1-9]\d{0,2}$/.test(countryCode)) {
    registerForm.elements.phoneCountryCode.setCustomValidity("Enter a valid international calling code.");
  }
  if (!/^\d{6,14}$/.test(phoneDigits) || totalDigits > 15) {
    registerForm.elements.phoneNumber.setCustomValidity("Enter a valid national phone number.");
  }

  const country = registerForm.elements.country.value.trim();
  const postalCode = registerForm.elements.postalCode.value.trim().toUpperCase();
  registerForm.elements.postalCode.value = postalCode;
  if (!/^[A-Z0-9][A-Z0-9 -]{1,10}[A-Z0-9]$/.test(postalCode)) {
    registerForm.elements.postalCode.setCustomValidity("Enter a valid PIN or postal code.");
  } else if (country.toLowerCase() === "india" && !/^\d{6}$/.test(postalCode)) {
    registerForm.elements.postalCode.setCustomValidity("An Indian PIN code must contain 6 digits.");
  }
  if (confirmPasswordInput.value !== passwordInput.value) {
    confirmPasswordInput.setCustomValidity("Passwords do not match.");
  }

  registerForm.classList.add("was-validated");
  if (!registerForm.checkValidity()) {
    const invalidFields = [...registerForm.elements].filter((field) => field.name && !field.validity.valid);
    for (const field of invalidFields) {
      const feedback = registerForm.querySelector(`[data-error="${field.name}"]`);
      setFieldFeedback(field.name, field.validationMessage || (feedback && feedback.textContent));
    }
    invalidFields[0]?.focus();
    return;
  }

  const payload = {
    name: registerForm.elements.name.value,
    dateOfBirth: dateOfBirthInput.value,
    gender: registerForm.elements.gender.value,
    email: registerForm.elements.email.value.toLowerCase(),
    phoneCountryCode: countryCode,
    phoneNumber: phoneDigits,
    country,
    state: registerForm.elements.state.value,
    city: registerForm.elements.city.value,
    postalCode,
    password: passwordInput.value,
    confirmPassword: confirmPasswordInput.value,
    acceptTerms: registerForm.elements.acceptTerms.checked
  };

  registerButton.disabled = true;
  registerButton.textContent = "Creating account…";
  try {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      if (result.errors && typeof result.errors === "object") {
        for (const [fieldName, message] of Object.entries(result.errors)) {
          const input = registerForm.elements.namedItem(fieldName);
          if (input) {
            input.setCustomValidity(message);
            setFieldFeedback(fieldName, message);
          }
        }
        registerForm.classList.add("was-validated");
      }
      throw new Error(result.error || "Registration failed.");
    }
    showRegisterMessage(result.message, "success");
    registerForm.classList.add("d-none");
    window.setTimeout(() => {
      window.location.replace(`/login.html?registered=1&email=${encodeURIComponent(payload.email)}`);
    }, 1600);
  } catch (error) {
    showRegisterMessage(error.message || "Unable to create your account. Please try again.");
  } finally {
    registerButton.disabled = false;
    registerButton.textContent = "Create citizen account";
  }
});

loadRegistrationConfig().catch((error) => {
  showRegisterMessage(error.message || "Registration is temporarily unavailable.");
  registerButton.disabled = true;
});
