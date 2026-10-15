# Smart Grievance Management System

A local grievance portal using HTML, CSS, JavaScript, Bootstrap 5, Express, Mongoose, and MongoDB Community Server. Citizens register and submit real grievances; authenticated department officers receive automatically routed reports, private evidence images, and status history.

## Prerequisites and setup

Install Node.js and MongoDB Community Server. Start the MongoDB Windows service and verify the local listener from PowerShell:

```powershell
$mongoService = Get-Service -Name MongoDB -ErrorAction SilentlyContinue
if ($mongoService -and $mongoService.Status -ne 'Running') {
  Start-Service -Name MongoDB
}
Test-NetConnection -ComputerName 127.0.0.1 -Port 27017
```

If the service is not installed, start MongoDB Community Server using the `mongod.cfg` created by its installer. Then prepare the application:

```powershell
Set-Location 'D:\SIMPLE SMART GRIVEANCES'
npm install
if (-not (Test-Path '.env')) { Copy-Item .env.example .env }
```

Edit `.env` and set `MONGODB_URI=mongodb://127.0.0.1:27017/grievance_db`. Replace the sample `ADMIN_PASSWORD_HASH` with a bcrypt hash and set a private session secret; for example, generate a session secret with `node -e "console.log(require('node:crypto').randomBytes(64).toString('hex'))"`. Keep `.env` local; it is excluded by `.gitignore`. The server waits for MongoDB and required indexes before accepting requests.

To generate a bcrypt hash for a private configured administrator password, run:

```powershell
node -e "const bcrypt=require('bcryptjs'); const readline=require('node:readline/promises'); const rl=readline.createInterface({input:process.stdin,output:process.stdout}); rl.question('Administrator password: ').then(async password=>{console.log(await bcrypt.hash(password,12)); rl.close();});"
```

Seed the six department demo accounts and start the server:

```powershell
npm run seed:officers
npm start
```

Open `http://127.0.0.1:5000`. Check the live database connection in a second PowerShell window:

```powershell
Invoke-RestMethod 'http://127.0.0.1:5000/api/health/db'
```

The response should include `database: connected` and `name: grievance_db`.

## Demo officer accounts

Use the shared `/login.html` page. Run `npm run seed:officers` again safely: existing accounts are left unchanged and not duplicated. Passwords are bcrypt-hashed before insertion; plaintext is not stored in MongoDB.

For a local development convenience, set `ENABLE_DEMO_OFFICER_AUTOFILL=true` in `.env` to show an officer account picker on the shared sign-in page. It fills the selected demo account's credentials but does not submit the form. This endpoint is disabled whenever `NODE_ENV=production`; leave the flag unset or false outside local development.

| Department | Email | Development password |
| --- | --- | --- |
| Roads | `roads.officer@example.com` | `Roads@123` |
| Water | `water.officer@example.com` | `Water@123` |
| Drainage | `drainage.officer@example.com` | `Drainage@123` |
| Sanitation | `sanitation.officer@example.com` | `Sanitation@123` |
| Electricity | `electricity.officer@example.com` | `Electricity@123` |
| Forestry | `forestry.officer@example.com` | `Forestry@123` |

These credentials are for local development only. Replace them with unique credentials and require password changes before any real deployment. Officers are created only by the seed script; public registration cannot assign an officer role.

## Features and pages

- `/` — public portal and database-backed statistics.
- `/register.html` — citizen registration with age and contact validation.
- `/login.html` — shared login; the server determines the citizen, officer, or configured Super Admin role and redirects accordingly.
- `/submit-grievance.html` — available only to a signed-in citizen; server-bound account contact details, grievance form, location consent, and private evidence uploads.
- `/citizen-dashboard.html` — citizen-only records, totals, photos, location, status, and timeline.
- `/officer-dashboard.html` — department-scoped records, filters, evidence, and officer status/remarks actions.
- `/admin-dashboard.html` — Super Admin-only cross-department overview, grievance assignment and workflow management, departments, officers, reports, escalations, and read-only audit logs.
- `/track-grievance.html` — public limited tracking by grievance ID.

The Super Admin account is provisioned only through `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` in the server's private `.env` configuration. It is not a MongoDB officer account and cannot be granted through public registration or an admin API. Admin APIs re-check this role on the server; ordinary sessions cannot obtain cross-department access by changing client data. Deactivated citizen/officer accounts are revalidated against MongoDB on protected requests.

Admin management discovers existing department names from grievance and officer records, then stores department descriptions and activation settings in the `departments` collection. It extends the existing grievance records with priority, SLA deadline, escalation flag, and private admin notes; notes are excluded from citizen/officer queries. Important admin changes are appended to `auditlogs` and there are no audit-log update or delete endpoints.

Grievance departments are selected by the server from the category, never from citizen-provided department or officer values:

| Category | Routed department |
| --- | --- |
| Pothole or damaged road | Roads Department |
| Water leakage or water supply problem | Water Department |
| Drainage blockage or overflow | Drainage Department |
| Garbage overflow or sanitation issue | Sanitation Department |
| Electricity pole, streetlight or power-related issue | Electricity Department |
| Fallen tree or dangerous branches | Forestry Department |
| Other civic issue | General Grievance Queue |

The server assigns the active department officer with the fewest active (`Assigned` or `In Progress`) grievances. If no officer is available, the report remains `Pending` in its department queue. Officers can only access their assigned records or records in their authorized department. Status changes and remarks are recorded as history in MongoDB.

## Image uploads and location privacy

Images must be JPG/JPEG, PNG, or WEBP; the server allows at most three images and 5 MB per image. It verifies file signatures, decodes and re-encodes the raster image (discarding embedded metadata), generates random filenames, and stores files under the ignored local `uploads` directory. Uploaded files are not exposed by static file hosting: image requests are checked against the signed-in citizen's ownership, an officer's department, or the configured Super Admin role.

Browser location permission is requested only when the citizen clicks **Use My Current Location**. Denial or unavailable GPS leaves manual address entry available. Coordinates do not prove an exact address; the citizen must review and confirm all address fields.

Reverse geocoding is optional. To enable it, set `REVERSE_GEOCODE_URL` in `.env` to a Nominatim-compatible reverse endpoint; the server requests JSON using `lat`, `lon`, and `format=jsonv2` parameters and uses returned address fields only as editable suggestions. If unset, coordinates are retained but the address must be entered manually.

## Description assistance

The **Generate Description** control uses the entered category and observed keywords. Without a provider, the clearly labelled template does not analyze images and does not invent causes, severity, or consequences. Citizens can edit the suggestion and must submit the form themselves.

An optional text provider can be configured with `DESCRIPTION_AI_URL` and, if required, `DESCRIPTION_AI_API_KEY`. The endpoint receives a JSON object containing `category`, `notes`, and an instruction; it must return JSON shaped as `{"description":"..."}`. Only citizen-entered notes are sent. External providers are not configured by default. A provider error is reported rather than silently replaced with a template.

## Authentication and data

Express sessions are stored in the MongoDB `sessions` collection; the browser holds only an HTTP-only, SameSite=Strict session cookie. Passwords are bcrypt-hashed. Citizen registration cannot set roles or officer departments. Citizen APIs scope records to the current account, and officer APIs scope records to the session's department/assignment. Login, registration, grievance submission, description assistance, and reverse geocoding are rate-limited.

`CITIZEN_MIN_AGE` sets the registration minimum and defaults to 18. Forgot-password and Remember Me are not offered because no reset or persistent-login workflow is implemented.

## APIs

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health/db` | Public | Ping MongoDB and report connection health |
| POST | `/api/auth/register` | Public, rate-limited | Create a citizen account |
| POST | `/api/auth/login` | Public, rate-limited | Authenticate citizen/officer/configured Super Admin and start server-side session |
| POST | `/api/auth/logout` | Session | Destroy the session |
| GET | `/api/auth/me` | Authenticated | Read current server-side account and role |
| GET | `/api/admin/overview` | Super Admin | Database-backed counts and department, status, monthly, and resolution charts |
| GET/PATCH | `/api/admin/grievances` and `/api/admin/grievances/:id` | Super Admin | Paginated cross-department records, filters, details, assignment, workflow, priority, escalation, and internal notes |
| GET/POST/PATCH | `/api/admin/departments` | Super Admin | Discover, create, edit, activate, and inspect department workload |
| POST | `/api/admin/departments/recommended` | Super Admin | Add recommended civic departments while reusing matching existing names |
| GET/POST/PATCH | `/api/admin/officers` | Super Admin | Paginated officer management, department assignment, activation, and workload |
| GET | `/api/admin/reports` | Super Admin | Department/officer performance, resolution time, monthly/yearly trends, overdue and escalation records |
| GET | `/api/admin/audit-logs` | Super Admin | Paginated administrative audit history |
| POST | `/api/grievances` | Citizen, rate-limited | Create a routed grievance with up to three images |
| GET | `/api/grievances/my` | Citizen | List the signed-in citizen's grievance records |
| GET | `/api/grievances/:id` | Authorized citizen/officer/Super Admin | Read one grievance and its status history |
| GET | `/api/grievances/:id/images/:imageId` | Authorized citizen/officer/Super Admin | Retrieve private evidence image |
| POST | `/api/grievances/description-suggestion` | Citizen, rate-limited | Produce a template/provider description suggestion |
| POST | `/api/grievances/reverse-geocode` | Citizen, rate-limited | Optional reverse-geocoding address suggestion |
| GET | `/api/officer/grievances` | Officer | List only authorized department records |
| GET | `/api/officer/grievances/stats` | Officer | Department-specific counts |
| POST | `/api/officer/grievances/:id/accept` | Officer | Accept a pending grievance in the officer's department |
| PATCH | `/api/officer/grievances/:id/status` | Officer | Update status and remarks, recording history |
| GET | `/api/citizen/dashboard` | Citizen | Dashboard, totals, private images, and timelines |
| GET | `/api/grievances/track/:complaintId` | Public | Limited tracking result |

## Browser and Postman verification

1. Visit `/register.html` and register a citizen account.
2. Sign in at `/login.html`, then submit a grievance. Try each category and verify the destination department and initial assignment in MongoDB or the officer dashboard.
3. Upload valid images and confirm previews, removal, and dashboard visibility. Try a renamed non-image, a file over 5 MB, or more than three files; the server should reject the request.
4. Use **Use My Current Location** to test browser permission, or decline permission and enter the address manually. Without a reverse-geocoder configuration, GPS only captures coordinates.
5. Sign in with the officer credentials above. Confirm that officers from other departments cannot see the grievance, then use the relevant officer to accept/start work, update status, and add resolution remarks.
6. Refresh the citizen dashboard and verify the current status and complete history.

To test protected request authorization in Postman, use its cookie jar: sign in with `POST /api/auth/login`, submit the grievance as multipart form data to `POST /api/grievances` with repeated `images` fields, and retain the session cookie for subsequent requests. Attempting the submit endpoint without a citizen session returns `401`; a citizen cannot access the officer dashboard or officer APIs.

## Changed application files

Backend changes are in `server.js`, the models under `models/`, `middleware/auth.js`, `middleware/grievanceAccess.js`, `routes/auth.js`, and `routes/admin.js`. Run-once officer account creation is implemented by `scripts/seed-officers.js`. The admin dashboard is in `public/admin-dashboard.html`, `public/js/admin.js`, and `public/css/admin.css`; citizen and officer interfaces remain in place. Configuration is documented in `.env.example`; uploaded files and secrets are excluded through `.gitignore`.
