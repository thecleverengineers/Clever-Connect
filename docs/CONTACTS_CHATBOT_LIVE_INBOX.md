# WA SANTA — Contacts, Live Inbox, Chatbot Flows and Campaign Reports

## What's included
- **Contacts:** Download `Contacts → Excel template`. The resulting XLSX includes Contacts and Instructions worksheets with `name`, international `phone`, `email`, `consent`, `opt_in_source`, `opt_in_date`, `tags`, `notes`. Excel, XLS and CSV imports remain available. Imported rows are matched to workspace-scoped E.164 phone numbers. Import cap: 5 MB and **5,000 rows per file** — this is an application batch-safety limit, **not a Meta messaging tier**.
- **Dynamic Meta limits:** WhatsApp requires opt-in and approved templates for outbound messages outside the 24-hour customer window. Business-initiated messaging limits apply to the connected Meta business portfolio and are not bypassed by importing data. WA SANTA currently paces requests at approximately **4 messages/second per Meta phone number, per backend process**, below common Meta throughput thresholds; Meta independently enforces its real rates, quality policies and dynamic messaging tiers. No "unlimited bulk" claims.
- **Delivery reports:** `Delivery reports → Campaign-wise reports → select campaign` opens contact-level submitted/sent/delivered/read/failed records. `Open chat` navigates to the live inbox. Incoming WhatsApp quoted replies with a `context.id` referencing the exact sent campaign message are tied to the specific campaign record, setting `repliedAt`. Unquoted replies remain visible in the same contact conversation but cannot safely be attributed to a specific campaign.
- **Live chat:** Incoming signed Meta message webhooks are stored by workspace + Meta profile + contact number with deduplication using Meta message IDs, conversation unread counts, near-real-time browser polling (every 4–5 seconds), and text/media-type placeholders. Agent replies use Meta Cloud API and require a valid 24-hour window. Taking over a conversation pauses its chatbot; resuming re-enables automatic matching.
- **Chatbot and Flow builder:** Create/modify/delete workspace-specific flows; enable/disable; scope to Meta profile; trigger by keyword contains, exact match, or any inbound message; priority ordering; graph steps `message`, `buttons` (up to 3 Meta reply buttons), `handoff`, `end`; buttons branch to next step. Message-step next targets progress **on the next inbound customer response**, not immediately. Flow definitions and node targets are validated on the server. Inbound STOP/unsubscribe suppresses the contact and stops automation.
- **Security:** Authentication + subscription enforcement on the new routes; workspace-scoped lookups; Meta webhook HMAC signature verification; encrypted Meta sender tokens; controlled button payloads; deduped inbound Meta message IDs.

## Setup checklist
1. Link an active Meta WhatsApp Cloud API phone in `Meta WhatsApp API`.
2. Ensure the WhatsApp Business Account is subscribed to `messages` webhooks, with a matching `META_APP_SECRET` at the WA SANTA server.
3. Upload a contacts workbook, with genuine opt-in data. Import does not send messages.
4. Send a compliant template campaign or respond within a 24-hour customer-service window.
5. Reply from a WhatsApp customer phone. The conversation appears in `Live chat`; an existing campaign quoted reply can be linked to its delivery.
6. Create an enabled `Chatbot & Flows` workflow on the correct Meta profile. Try keyword and quick-reply branching with a test customer.
7. Inspect `Delivery reports` for campaign and contact-wise records.

## New API routes
- `GET /api/contacts/template.xlsx`
- `GET /api/inbox/conversations`, `GET /api/inbox/conversations/:id/messages`
- `POST /api/inbox/conversations/:id/read`, `POST /api/inbox/conversations/:id/reply`, `PUT /api/inbox/conversations/:id/agent`
- `GET /api/flows`, `POST /api/flows`, `PUT /api/flows/:id`, `DELETE /api/flows/:id`

## Known limitations
- This is a **rule-based chatbot flow editor**, not a generative AI chatbot or Meta's separately hosted **WhatsApp Flows** screen designer.
- Browser live updates use short polling, not persistent WebSocket presence/typing events.
- Historical chats from before webhook activation are not automatically imported.
- For inbound media, the chat shows type and any caption rather than downloading protected image/video/document attachments.
- Agents cannot send free-form replies after 24 hours; start with an approved Meta template.
- Delivery `repliedAt` attribution requires an actual Meta message reply context. Plain subsequent messages are shown in the chat but are not falsely linked to one campaign.
- Cross-instance globally consistent sender rate limiting would need a shared queue (e.g., Redis); the current limiter is in process.
- The system will not change a customer's consent to opted-in merely because they send an inbound message.

## Validation
`cd server && npm install && npm test` covers flow configuration, button limits, inbound parsing, payment and carousel validation.
`cd client && npm install && npm run build` checks the UI build.
Tests do not replace an end-to-end Meta WhatsApp delivery/receipt test with a real connected merchant account.
