# WA SANTA: WhatsApp-native text & image-carousel campaigns

## What is implemented
Open **Campaigns → New campaign → Message composer** and first choose **Free-form message** or **Approved Meta template**. Free-form supports:
- **Formatted text**: bold (`*bold*`), italic (`_italic_`), strike (`~strike~`), monospace (three backticks), inline code, numbered/bulleted lists, quotes, and line breaks.
- **Image carousel**: two to ten image cards with JPG/PNG upload and drag-and-drop (up to 5 MB each), a caption (up to 160 characters), and one CTA URL button (label up to 20 characters). The required introductory body allows up to 1024 characters. Carousel and template sending are separate options.
- **Approved Meta template**: select a synced, APPROVED marketing/utility text template from its connected Meta profile and fill each required positional BODY parameter. `{{name}}`, `{{phone}}`, and `{{email}}` are personalised on send. Auth/OTP templates remain in a separate workflow.

A responsive WhatsApp-style preview sits next to the editor. Message `{{name}}`, `{{phone}}`, and `{{email}}` placeholders are rendered independently for each opted-in recipient, including inside card captions. You can choose a contact list or specific contacts, schedule, and review per-recipient delivery statuses using existing campaign features. Multiple message types share the same campaign audit and scheduler.

## Rules enforced by the backend
- A free-form text/carousel message is submitted to Meta **only** if an inbound WhatsApp message from that recipient was received through the **same connected business phone number within 24 hours**. An earlier opt-in alone does not open a session.
- Recipients must be saved opted-in, unsuppressed contacts.
- The selected Meta profile is bound to the authenticated workspace and must be enabled. Carousels **cannot use the demo sender**.
- Carousel payloads follow `interactive.type: "carousel"` and `action.cards[].type: "cta_url"`, with card indexes 0–9, image headers, optional bodies, and a URL CTA.
- URLs must be public HTTPS domain names (not localhost, IP-address hosts, local TLDs, or URLs containing credentials).
- **Uploaded carousel images** are stored in MongoDB, independent of Render's ephemeral disk. The upload API returns unguessable tokenized public HTTPS media links so Meta can fetch them; creating or editing a campaign validates that each link belongs to the same workspace. Uploads accept JPEG/PNG, max 5 MB and 20 images/minute/workspace. Uploaded image URLs are **not user-entered**. The only URL field in the carousel editor is the optional destination website for each card's CTA.
- The public image URL is intentionally accessible to anyone possessing its unguessable secret, including Meta. Do not upload sensitive or private images.
- The campaign form displays a read-only estimate of opted-in contacts with active conversations for the selected profile. This is **workspace-wide**, not the final filtered audience count. Eligibility is checked again at each actual send; scheduled campaigns can lose eligibility before dispatch.
- **Template campaigns** use the approved Meta template text and required body variables. They can initiate conversations outside the 24-hour customer window, only to opted-in contacts and subject to Meta's limits. The upload-based carousel is currently a **session-only free-form interactive carousel**, not a Meta-approved carousel template.

## Not supported
Custom font family, custom font size, text colour, HTML, CSS, unrestricted rich formatting, mixing Meta-approved templates with a free-form carousel, and outbound session carousels outside the 24-hour window. These are intentionally absent from the campaign composer.

## Relevant files
- `client/src/CampaignComposer.jsx`, `client/src/campaignComposer.css`, `client/src/MediaDropzone.jsx`, `client/src/DropFileInput.jsx`
- `server/src/services/carousel.js` (payload validator)
- `server/src/routes/media.js`, `server/src/mediaModel.js` (persistent image upload and public delivery)
- `server/src/services/whatsapp.js` (Meta session-window enforcement)
- `server/src/services/scheduler.js` (personalized campaign send)
- `server/src/routes/campaigns.js` (`GET /api/campaigns/eligibility`, validation)
- `server/test/carousel.test.js`, `server/test/media.test.js` (unit tests)

## Validation
Run `cd server && npm install && npm test` and `cd client && npm install && npm run build`. Pushes to main also run the `WA SANTA checks` GitHub Actions workflow.

Meta may reject interactive carousels for ineligible accounts, unsupported asset types, or images that are not reachable by Meta. A Render deployment succeeding does not constitute an end-to-end test delivery.
