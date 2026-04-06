# SyncDev — Real-Time Collaborative Code Editor

## Overview
SyncDev is a dark-themed real-time collaborative code editor built as a production-style SaaS UI. It combines a VS Code-inspired coding workspace with meeting-style participant controls, live collaboration, and modern developer UI polish.

## Current Status
- Frontend: React + Vite with a brutalist developer aesthetic and neon green accents.
- Backend: Express + MongoDB for authentication, JWT, and room handling.
- Real-time collaboration: Socket.IO powers room join, code sync, and live user presence updates.
- Latest UI work: refined the editor layout, sticky participant panel, scrollable participant list, responsive participant cards, and polished toolbar structure.

## Project Structure
- `Client/`
  - React app powered by Vite
  - `src/App.jsx` routes auth, dashboard, and editor screens
  - `src/pages/Editor.jsx` contains the workspace, participant panel, and toolbar interactions
  - `src/index.css` manages the dark SaaS theme, editor layout, participant grid, and responsive behavior
- `Server/`
  - Express backend with auth routes
  - `models/User.js` MongoDB user model
  - `server.js` app entry point
  - `config.js` environment configuration

## Key Features
- Live collaborative editor using Monaco Editor
- Room-based sharing with room IDs and copy link action
- Sticky top participants and scrollable participant list
- Responsive 2-column participant grid with equal card sizing
- Neon green active speaker and hover states
- Bottom control bar with mic, camera, emoji, caption, hand, and end call actions
- Sticky header with room and language controls

## Development Notes
### Recent improvements
- Implemented `participants-pinned` section for the first two participants
- Ensured only the participant list scrolls, not the entire page
- Added modern thin scrollbar styling and background separation for sticky users
- Standardized participant cards with equal padding, border radius, and hover animations
- Refined header and toolbar flex layout for better alignment and spacing
- Verified frontend build successfully after updates

### Goals
- Continue improving the real-time UX for multi-user collaboration
- Add optional participant search and panel expand/collapse controls
- Enhance mobile responsiveness with drawer-style participant layout
- Add copy link success toast and connection status badges
- Finalize backend realtime room cleanup and auth protections

## Getting Started
1. Install dependencies
   - `cd Client && npm install`
   - `cd Server && npm install`
2. Run backend server
   - `cd Server && npm start`
3. Run frontend app
   - `cd Client && npm run dev`
4. Open the app in the browser and join a room via the dashboard

## Notes
This workspace is actively being developed and currently focuses on UI refinement and live participant UX. The current build output has been validated successfully.

---

## Contact
For follow-up or further UI improvements, continue working in the `Client/src/pages/Editor.jsx` and `Client/src/index.css` files.
