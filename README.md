# VitaGuard AI — Deterministic Personal Health & Environmental Safety Monitor

VitaGuard AI is a personal physiological and environmental safety monitoring platform that pairs an **authoritative deterministic risk engine** with **contextual AI explainability**, **per-user Firebase isolation**, **durable server-side alert escalation**, **validated multi-source observation ingestion**, and an authenticated **Model Context Protocol (MCP) server**.

---

## 1. Core Safety Architecture & Boundaries

- **Deterministic Risk Classification**: All risk scores (`0–100`), sub-scores, heat-index calculations, and risk levels (`low`, `moderate`, `high`, `critical`) are computed deterministically by `src/engine/riskEngine.ts` using inspectable, versioned rules (`vitaguard-deterministic-v1.2`).
- **AI Explainability Boundary**: AI models (`GeminiExplanationOrchestrator` in `src/services/geminiExplanationEngine.ts`) receive the completed deterministic assessment as immutable input and generate schema-validated, plain-language explanations. AI **cannot** override risk classifications, mutate alert states, diagnose medical conditions, or claim that emergency services have been contacted.
- **Simulation Mode by Default**: All synthetic presets, sliders, and client-side telemetry carry `dataMode: 'SIMULATED'`. Outbound escalations default to `SimulationNotificationProvider`, guaranteeing zero external SMS or calls during demonstrations unless live gateway credentials and explicit contact verification/consent are configured on the server.
- **Stale & Missing Data Guardrails**: Stale physiological observations (`> 5 min`) or environmental readings (`> 30 min`) are surfaced as `DATA UNCERTAINTY` (`STALE` / `MISSING`) and never trigger automatic false medical emergencies.
- **Clinical Disclaimer**: VitaGuard AI is an informational personal safety monitoring demonstration and is **not** an FDA-cleared medical device, clinical diagnostic instrument, or 911 emergency dispatch replacement.

---

## 2. Release Readiness Verification Matrix

| Verification Requirement | Implementation Module | Automated Verification Suite | Status |
| :--- | :--- | :--- | :--- |
| **1. Complete alert workflow passes an end-to-end test** | `src/engine/riskEngine.ts`, `src/engine/alertManager.ts`, `src/services/dataIngestionEngine.ts`, `src/services/geminiExplanationEngine.ts`, `src/services/notificationEngine.ts` | `src/services/__tests__/endToEndAndAudit.test.ts` (13-step E2E workflow) | VERIFIED |
| **2. Acknowledgement and escalation remain consistent after refresh** | `DurableEscalationCoordinator` (`exportSnapshot` / `hydrateFromSnapshot`), `.vitaguard-escalation-state.json`, `SecureSafetyRepositorySimulator` | `src/services/__tests__/endToEndAndAudit.test.ts`, `src/services/__tests__/notificationEscalation.test.ts` | VERIFIED |
| **3. Security and ownership tests pass** | `firestore.rules`, `src/repositories/safetyRepository.ts`, `server.ts` | `src/repositories/__tests__/firestoreSecurityAndRepo.test.ts`, `src/services/__tests__/mcpIntegration.test.ts` | VERIFIED |
| **4. No secrets are exposed in frontend bundles** | Server-only `GEMINI_API_KEY`, `SMS_GATEWAY_API_KEY`, `WEARABLE_OAUTH_CLIENT_SECRET` in `server.ts` & `functions/src/index.ts` | `src/services/__tests__/endToEndAndAudit.test.ts` (static bundle & source secret scan) | VERIFIED |
| **5. AI cannot change the deterministic risk result** | `src/services/geminiExplanationEngine.ts` (immutable assessment verification & schema validation) | `src/services/__tests__/geminiExplanation.test.ts`, `src/services/__tests__/endToEndAndAudit.test.ts` | VERIFIED |
| **6. Simulation mode sends no external notifications** | `SimulationNotificationProvider` in `src/services/notificationEngine.ts` | `src/services/__tests__/notificationEscalation.test.ts`, `src/services/__tests__/endToEndAndAudit.test.ts` | VERIFIED |
| **7. Scheduler coordination and duplicate prevention are verified** | Single authoritative task lock (`inFlightTaskLocks`, `executionCount`, `idempotencyKey`) in `src/services/notificationEngine.ts` & `functions/src/index.ts` | `src/services/__tests__/notificationEscalation.test.ts`, `src/services/__tests__/endToEndAndAudit.test.ts` | VERIFIED |
| **8. Production build and dependency scans pass** | `vite.config.ts`, `tsconfig.json`, `package.json` | `npm run lint`, `npm run build`, `npm audit` | VERIFIED |
| **9. Deployment configuration is documented** | `README.md`, `.env.example`, `firebase.json`, `firestore.rules`, `firestore.indexes.json` | `src/services/__tests__/endToEndAndAudit.test.ts` | VERIFIED |
| **10. Amazon track compatibility is verified against official requirements** | `WearableDataProvider`, `EnvironmentalDataProvider`, `GeminiExplanationOrchestrator` (`GenerateTextFn`), `VitaGuardMcpServer` | `src/services/__tests__/endToEndAndAudit.test.ts`, `src/services/__tests__/mcpIntegration.test.ts` | VERIFIED |

---

## 3. Production Deployment Configuration

### 3.1 Environment Variables
Copy `.env.example` to `.env` for local development or configure the following variables in your production secret manager (Google Cloud Run / Firebase Secret Manager / AWS App Runner):

#### Server-Only Secrets (Never prefix with `VITE_`)
| Variable | Purpose | Default / Required |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Server-side API key for `@google/genai` contextual explanations | Required for live AI explanations |
| `VITAGUARD_ENABLE_LIVE_SMS` | Enables live SMS gateway adapter when set to `"true"` | `"false"` (Simulation Mode default) |
| `SMS_GATEWAY_API_KEY` / `TWILIO_AUTH_TOKEN` | Server-side SMS gateway credential | Optional (Simulation Mode if omitted) |
| `SMS_GATEWAY_ENDPOINT` | Outbound SMS gateway HTTPS endpoint | Optional |
| `WEATHER_API_BASE_URL` | Upstream weather endpoint used by `/api/ingestion/weather` | `https://api.open-meteo.com/v1/forecast` |
| `WEARABLE_OAUTH_CLIENT_ID` | Server-side wearable OAuth client ID | Optional |
| `WEARABLE_OAUTH_CLIENT_SECRET` | Server-side wearable OAuth client secret | Optional |
| `APP_URL` | Canonical production origin enforced by `/api/*` CORS middleware | Optional (`*.run.app` and `localhost` allowed) |

#### Client-Side Public Firebase Identifiers (`VITE_*`)
| Variable | Purpose |
| :--- | :--- |
| `VITE_FIREBASE_API_KEY` | Public Firebase Web SDK API key (enforced by Firebase Auth & `firestore.rules`) |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain (`<project-id>.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | Firebase / GCP Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging Sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase Web App ID |

### 3.2 Build, Test, and Run Commands
```bash
# 1. Install dependencies
npm install

# 2. Type-check and lint
npm run lint

# 3. Run full automated test suite (7 test files)
npm test -- --isolate=false

# 4. Build optimized production frontend bundle into dist/
npm run build

# 5. Start production Express + static asset server on port 3000
NODE_ENV=production npm start
```

### 3.3 Firebase Firestore Rules & Cloud Functions Deployment
```bash
# Deploy Firestore security rules and composite indexes
firebase deploy --only firestore:rules,firestore:indexes

# Build and deploy callable Cloud Functions (with GEMINI_API_KEY in Secret Manager)
cd functions && npm install && npm run build && cd ..
firebase functions:secrets:set GEMINI_API_KEY
firebase deploy --only functions
```

### 3.4 Model Context Protocol (MCP) Server Deployment
VitaGuard AI exposes 6 authenticated MCP tools (`vitaguard_get_risk_status`, `vitaguard_explain_assessment`, `vitaguard_list_alert_history`, `vitaguard_acknowledge_alert`, `vitaguard_trigger_escalation_check`, `vitaguard_reset_demo_workspace`) over two transports:
- **HTTP JSON-RPC 2.0 & REST**: Mounted at `GET /api/mcp/tools`, `POST /api/mcp/rpc`, and `POST /api/mcp/call` in `server.ts`.
- **Standalone Stdio Transport**: Run `npm run mcp` (`tsx mcp-stdio-server.ts`) to connect desktop or cloud MCP hosts over standard input/output.
- **Sensitive Action Confirmation**: Mutating tools (`vitaguard_acknowledge_alert`, `vitaguard_trigger_escalation_check`, `vitaguard_reset_demo_workspace`) require `confirmationToken: "CONFIRM_VITAGUARD_ACTION"`.

---

## 4. Official Amazon Hackathon Track Compatibility Verification

### 4.1 Honest Hardware & SDK Disclosure
- **Discontinued / Restricted Consumer Hardware**: Amazon Halo health bands/service were discontinued in 2023. Consumer Ring, Fire TV, and proprietary Alexa+ hardware streams do not expose general-purpose real-time heart-rate, SpO2, or core body temperature webhooks for third-party web apps.
- **Zero Fake Hardware Claims**: VitaGuard AI strictly forbids misrepresenting synthetic telemetry as live Amazon hardware streams (`firestore.rules` and `validateAndNormalizeObservation` reject unverified `REAL` mode claims).

### 4.2 Verified Amazon Track Integration Paths
VitaGuard AI implements three clean, production-verified integration surfaces compatible with Amazon / AWS hackathon track requirements:
1. **Model-Agnostic AI Explanation Adapter (`GenerateTextFn`)**:
   - `GeminiExplanationOrchestrator` in `src/services/geminiExplanationEngine.ts` accepts a pluggable `generator: GenerateTextFn` interface (`({ model, systemInstruction, promptPayload }) => Promise<string>`).
   - This allows swapping or dual-routing between Google Gemini and **Amazon Bedrock (`amazon.nova-lite-v1:0` / `amazon.nova-pro-v1:0`)** while preserving identical prompt-injection defenses, per-user rate limiting, and strict JSON schema validation.
2. **Model Context Protocol (MCP) Server for Agentic Workflows**:
   - `VitaGuardMcpServer` (`src/services/mcpServer.ts` and `mcp-stdio-server.ts`) implements standard JSON-RPC 2.0 MCP tool discovery (`tools/list`) and invocation (`tools/call`), enabling Amazon Bedrock Agents, Amazon Q Developer, or Alexa Skill backend handlers to query risk status, explain assessments, and acknowledge alerts with mandatory human-in-the-loop confirmation tokens.
3. **Provider-Independent Telemetry & Weather Ingestion (`/api/ingestion/ingest` & `/api/ingestion/weather`)**:
   - `WearableDataProvider` and `EnvironmentalDataProvider` normalize imperial/metric units (`°F` to `°C`, `mph`/`m/s` to `km/h`) and enforce provenance metadata, ready for deployment on AWS App Runner, AWS ECS/Fargate, or AWS Lambda behind API Gateway.

---

## 5. Reproducible 5-Step Hackathon Demonstration Script

Use the **Reproducible Hackathon Demo & Verification Runner** bar at the top of the dashboard:
1. **Step 1 — Nominal Baseline**: Applies normal resting vitals (`72 BPM`, `98% SpO2`, `36.8°C`) and clear `22°C` ambient weather (`LOW` risk).
2. **Step 2 — High-Risk & Ingestion**: Applies the Critical Thermal Emergency preset, ingests and normalizes synthetic observations (`°F` to `°C`), triggers a `CRITICAL` alert, and schedules a durable server-side escalation deadline.
3. **Step 3 — AI Risk Explanation**: Generates a schema-validated AI explanation linked to the assessment fingerprint without altering the deterministic score.
4. **Step 4 — Acknowledge "I am safe"**: Confirms user safety idempotently, transitions the alert to `ACKNOWLEDGED`, and cancels the pending escalation task.
5. **Step 5 — Simulated Escalation**: Demonstrates unacknowledged deadline expiry dispatching a simulated notification to verified contacts via `SimulationNotificationProvider` (`0` real SMS sent).
- **Safe Demo Reset**: Clicking **Safe Demo Reset (Simulated Only)** (`POST /api/demo/reset`) purges only `SIMULATED` demo records for the current user while preserving any `REAL` observations and all other user accounts.
