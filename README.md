# GSM Traders

A private GSM Traders business-management app clone. This repository is separate from the original hosted application and its Supabase project.

## Local development

```powershell
cd app
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `app/.env.local` to the credentials from the **new** Supabase project. Do not use the original application's project credentials. The anon key is intended for client-side use; never put a Supabase service-role key in this app.

Without those environment variables, the app will display a configuration warning and sign-in will remain unavailable. No sample customer data is included.

## Deploy to Vercel

Import this repository into the separate Vercel account and set the same two `VITE_` variables in the project's Environment Variables. Set the Vercel project root directory to `app`, then deploy.

Create the new Supabase project, then follow [the Supabase setup guide](app/supabase/README.md) to create the core tables, set the single owner account, and apply the ordered migrations. Import and verify the business records before using the app. The public GitHub repository intentionally excludes those records.

## PDF sharing

The app keeps the separate **Download PDF** action. The bill share action uses the browser's native share sheet to pass the generated PDF and customer-specific message to a compatible app. This depends on device/browser support for file sharing and a secure context (HTTPS); the share sheet requires the user to choose the destination and confirm sending.
