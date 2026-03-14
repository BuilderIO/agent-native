# Calendar

Google Calendar integration with a Calendly-style public booking page.

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Google OAuth Setup (optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable the Google Calendar API
3. Create OAuth 2.0 credentials (Web application type)
4. Set the authorized redirect URI to `http://localhost:5173/api/google/callback`
5. Add credentials in the app's Settings page, or set in `.env`:
   ```
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

### 3. Run

```bash
pnpm dev
```

Open http://localhost:5173

## Features

- Monthly/weekly/daily calendar views
- Google Calendar sync (pull-based)
- Event CRUD (local + Google)
- Configurable availability schedule
- Public booking page at `/book/meeting`
- Real-time updates via SSE when agent modifies data files
