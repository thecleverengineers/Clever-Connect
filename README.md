# Clever Connect

Full-stack MERN WhatsApp workspace for secure contact management, Excel/CSV imports, reusable templates, bulk campaigns, individual messages, scheduling, delivery reporting and Meta WhatsApp Cloud API connectivity.

## Stack
- React + Vite
- Node.js + Express
- MongoDB Atlas + Mongoose
- HttpOnly JWT sessions + bcrypt
- Meta WhatsApp Cloud API + webhook delivery/read receipts
- Render web service + static site + cron scheduler

## WhatsApp modes
New workspaces start in **Demo provider** mode. In Settings, switch to **Meta WhatsApp Cloud API** and save the phone-number ID, WABA ID and access token.

## Security
Secrets are never committed. Provider access tokens are encrypted at rest. Application data is workspace-scoped.
