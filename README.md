# Christmas Clip Party

A mobile-first, password-only party app for watching a curated set of YouTube clips, rating each clip on three parameters, and displaying a live leaderboard.

## Architecture

- **Frontend:** React + Vite, deployed as static files to GitHub Pages.
- **Backend:** Supabase Postgres functions. The browser never receives password hashes and cannot directly query party tables.
- **Identity:** Supabase anonymous auth gives each browser a random participant ID; guests only enter the shared party password.
- **Video:** privacy-enhanced `youtube-nocookie.com` embeds.

## One-time setup

### 1. Supabase

Open **Authentication → Providers** in the Supabase dashboard and enable **Anonymous sign-ins**.

The GitHub integration applies files under `supabase/migrations` to connected preview branches. Apply the existing migration to production through the Supabase migration/SQL workflow, then initialize the party from the SQL Editor:

```sql
select public.initialize_party(
  'trymmens',
  'Trymmens Christmas Party',
  'replace-with-party-password',
  'replace-with-a-long-organizer-password'
);
```

Re-running this function updates the party name and both passwords. The function is not available to browser roles.

In **Project Settings → API**, copy the project’s **publishable key** (or legacy anon key). It is safe for this public frontend. Never put the service-role key in this repository or GitHub Actions.

### 2. Local development

The repository includes this project's public/publishable Supabase key, so local setup works immediately. To override it, create `.env.local` with:

```text
VITE_SUPABASE_URL=https://wjdtqgfrqyrwctmrbzhr.supabase.co
VITE_SUPABASE_ANON_KEY=replace-with-another-public-project-key
VITE_PARTY_SLUG=trymmens
```

Then:

```bash
npm install
npm run dev
```

### 3. GitHub Pages

In **Settings → Pages**, choose **GitHub Actions** as the source. Every push to `main` runs tests, builds the app, and deploys it. The checked-in Supabase publishable key is intentionally public; never substitute the service-role key.

Open the deployed site, choose **Organizer? Open controls**, and add the selected YouTube videos.

## Party behavior

- Guests watch and rate asynchronously in any order.
- Every guest can submit one rating per clip and change it while voting is open.
- Overall score is the average of Funny, Creative, and Christmas Spirit.
- Leaderboard order is overall score, then vote count.
- Closing voting in the organizer room freezes participant ratings.

## Commands

```bash
npm run dev
npm run test
npm run build
```