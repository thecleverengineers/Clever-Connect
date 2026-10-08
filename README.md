# WA SANTA

Full-stack MERN WhatsApp SaaS workspace for secure contact management, Excel/CSV imports, templates, campaigns, scheduling, delivery reporting, team access, Meta WhatsApp Cloud API connectivity, WhatsApp OTP 2FA, and subscription-controlled access.

## Access model
- Every new workspace receives **7 days of trial access**.
- After the trial expires, business/messaging APIs are locked until a subscription is approved.
- WA SANTA Super Admin creates plans, controls price/limits, and approves or rejects subscription requests.

## Stack
- React + Vite
- Node.js + Express
- MongoDB Atlas + Mongoose
- HttpOnly JWT sessions + bcrypt
- Meta WhatsApp Cloud API + webhook delivery/read receipts
- Render web service + static site

## Security
Secrets are never committed. Provider access tokens are encrypted at rest. Application data is workspace-scoped.
