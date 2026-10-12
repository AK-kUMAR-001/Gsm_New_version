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

Without those environment variables, the app will display a configuration warning and the offline demo contains no customer or transaction records.

## Deploy to Vercel

Import this repository into the separate Vercel account and set the same two `VITE_` variables in the project's Environment Variables. Set the Vercel project root directory to `app`, then deploy.

Create the new Supabase project and review/apply the SQL migrations in `app/supabase/migrations` to that project before using the app with business data. Configure appropriate authentication and row-level security policies in Supabase; client-side environment variables are not a substitute for database access policies.

## PDF sharing

The app keeps the separate **Download PDF** action. The bill share action uses the browser's native share sheet to pass the generated PDF and customer-specific message to a compatible app. This depends on device/browser support for file sharing and a secure context (HTTPS); the share sheet requires the user to choose the destination and confirm sending.
