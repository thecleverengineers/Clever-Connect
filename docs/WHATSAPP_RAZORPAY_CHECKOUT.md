# WA SANTA — Razorpay checkout inside WhatsApp (India)

## What this integration does
WA SANTA can send Meta Cloud API `order_details` messages with a native Review & Pay action. Payment is processed by the merchant's Razorpay account linked directly to their WhatsApp Business Account (WABA), not by WA SANTA.

Each connected Meta WhatsApp profile has its own stored payment configuration name. No Razorpay merchant API secret is collected by WA SANTA for native checkout.

## One-time setup per merchant WhatsApp profile

1. Connect and activate a Meta WhatsApp profile under **Meta WhatsApp API** in WA SANTA.
2. Open [WhatsApp Manager](https://business.facebook.com/wa/manage) and select that WABA. Navigate to **Account tools → Payment configurations → India** (the Meta navigation may change).
3. Add a payment configuration, select **Razorpay**, sign in to the merchant's Razorpay account and authorize Meta.
4. Copy the payment **configuration name** exactly, then open **WhatsApp Payments** in WA SANTA, choose the same Meta profile, and save the configuration name. Saving the name does not itself link or validate the merchant account.
5. Verify that Meta webhook subscriptions are active and **META_APP_SECRET** is configured in Super Admin → Meta setup or the server environment. Signed POST requests to `/api/webhooks/meta` are required.
6. Obtain genuine customer consent and have the customer message the connected business phone number, opening a 24-hour service window.
7. Create a digital goods/services payment request under **WhatsApp Payments**. Recipients are restricted to saved, opted-in, unsuppressed contacts who have an open 24-hour window on that *specific* connected phone number.
8. Confirm receipt of the Review & Pay card in the customer's chat; after checkout, use **Verify status** to query Meta before treating the order as paid.

## API routes (authenticated; subscribed workspaces only)

- `GET /api/payments/configs` — list profile-scoped configurations (never returns WhatsApp tokens)
- `PUT /api/payments/configs/:id` — owner/admin sets Razorpay payment configuration for the profile
- `GET /api/payments/window?integrationId=<id>` — recipient window eligibility for selected profile
- `GET /api/payments/orders` — workspace payment history
- `POST /api/payments/orders/send` — idempotent Meta `order_details` send
- `POST /api/payments/orders/:id/verify` — verify Meta payment lookup result against amount, INR, and reference ID

## Compliance & reliability

- The native `order_details` message is free-form: only customers who sent an inbound message during the past 24 hours are eligible. Outside this window, Meta requires an *approved order-details template*. That outbound template workflow is **not yet implemented** in this feature.
- Payment status webhooks alone are not trusted. WA SANTA validates the `X-Hub-Signature-256` HMAC using the Meta app secret, then independently calls Meta's payment lookup API.
- No checkout is recorded as `captured` unless Meta returns a matching reference, INR currency, amount in paise, and captured status.
- Meta API timeouts are not automatically retried, to avoid duplicate customer payment requests. The user must check an uncertain send first.
- Each order is tied to one workspace, contact and Meta profile. Checkout is currently for one digital good/service line item at a time.
- The feature does not manage Razorpay refunds, e-commerce inventory, recurring mandates, WA SANTA subscription billing, or external Razorpay payment links.
- This implementation uses payment configuration names authorized in Meta's own WhatsApp Manager; users must complete that external merchant onboarding before checkout can work.

## Technical notes

The backend needs `META_APP_SECRET`, Graph API access tokens per connected Meta profile, and a valid `CREDENTIAL_ENCRYPTION_KEY` (as already configured for WA SANTA). It does not need a Razorpay Key ID/Secret for Meta-native gateway checkout. The WABA must be eligible for Payments API in India.

Manual checks: create a connected test merchant account; send to a real opted-in customer with a recent inbound message; capture a low-value test payment; verify webhook signature handling and Meta payment lookup; confirm a second workspace cannot query or send another tenant's orders.

To run unit checks: `cd server && npm test`; frontend build: `cd client && npm run build`.
