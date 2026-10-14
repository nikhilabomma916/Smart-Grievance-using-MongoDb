const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");
const loginButton = document.getElementById("login-button");
const demoOfficerTools = document.getElementById("demo-officer-tools");
const demoOfficerSelect = document.getElementById("demo-officer");

for (const toggle of document.querySelectorAll("[data-toggle-password]")) {
  toggle.addEventListener("click", () => {
    const input = document.getElementById(toggle.dataset.togglePassword);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? "Hide" : "Show";
    toggle.setAttribute("aria-label", `${show ? "Hide" : "Show"} password`);
    toggle.setAttribute("aria-pressed", String(show));
  });
}

const query = new URLSearchParams(window.location.search);
if (query.get("registered") === "1") {
  loginMessage.className = "alert alert-success";
  loginMessage.textContent = "Your account was created successfully. Sign in to continue.";
}
const emailFromRegistration = query.get("email");
if (emailFromRegistration && !loginForm.elements.email.value) {
  loginForm.elements.email.value = emailFromRegistration;
}

if (demoOfficerTools && demoOfficerSelect) {
  fetch("/api/auth/demo-officers")
    .then(async (response) => {
      if (!response.ok) return;
      const result = await response.json();
      if (!result.success || !Array.isArray(result.data) || result.data.length === 0) return;

      for (const officer of result.data) {
        const option = document.createElement("option");
        option.value = officer.email;
        option.textContent = `${officer.department} — ${officer.name}`;
        demoOfficerSelect.append(option);
      }
      demoOfficerTools.classList.remove("d-none");
    })
    .catch((error) => {
      console.warn("Demo officer sign-in options could not be loaded:", error);
    });

  demoOfficerSelect.addEventListener("change", async () => {
    if (!demoOfficerSelect.value) return;
    try {
      const response = await fetch("/api/auth/demo-officers");
      if (!response.ok) throw new Error("Demo officer accounts are unavailable.");
      const result = await response.json();
      const officer = result.data.find((account) => account.email === demoOfficerSelect.value);
      if (!officer) throw new Error("The selected demo officer account is unavailable.");
      loginForm.elements.email.value = officer.email;
      loginForm.elements.password.value = officer.password;
      loginForm.classList.remove("was-validated");
      loginMessage.className = "alert alert-info";
      loginMessage.textContent = `${officer.department} demo credentials filled in. Click Sign in to continue.`;
    } catch (error) {
      loginMessage.className = "alert alert-danger";
      loginMessage.textContent = error.message || "Unable to load demo officer credentials.";
    }
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginForm.classList.add("was-validated");
  if (!loginForm.checkValidity()) {
    loginForm.querySelector(":invalid")?.focus();
    loginForm.querySelectorAll(":invalid").forEach((field) => {
      const feedback = field.closest(".mb-3, .mb-4")?.querySelector(".invalid-feedback");
      if (feedback) feedback.classList.add("d-block");
    });
    return;
  }
  loginMessage.className = "alert d-none";
  loginButton.disabled = true;
  loginButton.textContent = "Signing in…";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: loginForm.elements.email.value.trim(),
        password: loginForm.elements.password.value
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "Sign in failed.");
    const destination = result.data.role === "citizen"
      ? "/citizen-dashboard.html"
      : result.data.role === "officer"
        ? "/officer-dashboard.html"
        : null;
    if (!destination) throw new Error("The account has an unsupported role.");
    window.location.replace(destination);
  } catch (error) {
    loginMessage.className = "alert alert-danger";
    loginMessage.textContent = error.message || "Unable to sign in. Try again.";
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Sign in";
  }
});
